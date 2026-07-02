import Foundation
import GRDB
import LariatModel

/// Port of the POST /api/kitchen-assistant handler
/// (`app/api/kitchen-assistant/route.js kitchenAssistantPostHandler`).
///
/// Flow parity: message clip → conversation normalize → TTL sweep + history →
/// deterministic Q-vs-C classification → **PIN gate BEFORE the LLM (#248)** →
/// grounded context (#247 tiering) → prompt → ollamaChat → extractAction →
/// read-action branches → question-path JSON strip (defense-in-depth) →
/// command-path action dispatch → `⚡ ACTION EXECUTED:` prefix → conversation
/// store → response envelope.
///
/// Deferrals (Phase B plan, documented): `db_query` + `code_search` respond
/// with a soft "not available on this device" message (read-only surfaces;
/// no catalog is injected into the prompt so the model rarely emits them).
/// No idempotency layer (native convention — divergence asserted).
public struct KitchenAssistantEngine {
    /// Typed port of the route's error responses (`status` = web HTTP code).
    public struct EngineError: Error, Equatable, LocalizedError {
        public let status: Int
        public let message: String

        public init(status: Int, message: String) {
            self.status = status
            self.message = message
        }

        public var errorDescription: String? { message }
    }

    private let ollama: OllamaClient
    private let context: AssistantContextRepository
    private let conversation: AssistantConversationRepository
    private let actions: AssistantActionRepository
    private let semanticSearch: KitchenSemanticSearchRepository
    private let undoRepository: AssistantUndoRepository

    public init(
        ollama: OllamaClient,
        context: AssistantContextRepository,
        conversation: AssistantConversationRepository,
        actions: AssistantActionRepository,
        semanticSearch: KitchenSemanticSearchRepository,
        undoRepository: AssistantUndoRepository
    ) {
        self.ollama = ollama
        self.context = context
        self.conversation = conversation
        self.actions = actions
        self.semanticSearch = semanticSearch
        self.undoRepository = undoRepository
    }

    public func ask(
        message rawMessage: String,
        locationId: String,
        cookId: String?,
        conversationSessionId: String?,
        language: String? = nil,
        hasPin: Bool
    ) async throws -> AssistantResponse {
        let message = rawMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else {
            throw EngineError(status: 400, message: "message is required")
        }
        guard message.count <= AssistantLimits.maxMessage else {
            throw EngineError(status: 400, message: "message too long (max \(AssistantLimits.maxMessage) chars)")
        }

        let normalized = LariConversationMemoryCompute.normalizeConversationInputs(
            sessionId: conversationSessionId, cookId: cookId
        )
        guard case .ok(let sessionId, let normalizedCookId) = normalized else {
            if case .error(let error) = normalized {
                throw EngineError(status: 400, message: error)
            }
            throw EngineError(status: 400, message: LariConversationMemoryCompute.sessionIdError)
        }

        try? conversation.sweepExpired()
        let priorTurns = (try? conversation.loadRecent(
            locationId: locationId, cookId: normalizedCookId, sessionId: sessionId, hasPin: hasPin
        )) ?? []
        let conversationHistory = LariConversationMemoryCompute.formatConversationHistoryForPrompt(priorTurns)

        // Q-vs-C routing in deterministic code, never in-prompt (#248 rationale).
        let isCommand = AssistantMessageClassifier.isImperativeCommand(message)
        if !hasPin && AssistantMessageClassifier.requiresPinBeforeLlm(message) {
            // #248: un-PIN'd imperative commands never reach Ollama at all.
            return AssistantResponse(
                answer: "Action blocked — manager PIN required. Ask a manager to confirm.",
                model: "pin-required",
                locationId: locationId,
                sources: [],
                latencyMs: 0,
                actionExecuted: false,
                actionError: false,
                undo: nil
            )
        }

        let started = Date()
        let grounded: AssistantGroundedContext
        do {
            grounded = try context.buildGroundedContext(
                locationId: locationId, userQuestion: message, hasPin: hasPin
            )
        } catch {
            throw EngineError(status: 500, message: "Failed to load kitchen context")
        }
        var sources = grounded.sources

        let userContent = AssistantPrompts.userContent(
            contextText: grounded.contextText,
            conversationHistory: conversationHistory,
            message: message,
            language: language,
            isCommand: isCommand
        )

        let chatResult: OllamaChatResult
        do {
            chatResult = try await ollama.chat(messages: [
                OllamaChatMessage(role: "system", content: AssistantPrompts.groundedSystem),
                OllamaChatMessage(role: "user", content: userContent),
            ])
        } catch let e as OllamaClientError {
            // AbortError → friendly timeout copy; everything else surfaces its
            // message. Web returns 502 for both.
            throw EngineError(status: 502, message: e.errorDescription ?? "Ollama request failed")
        }

        var actionExecuted = false
        var actionError = false
        var actionMsg = ""
        var undo: KitchenAssistantUndoMeta? = nil

        let extraction = AssistantActionExtractor.extractAction(chatResult.content)
        let stripped = extraction.stripped
        var finalAnswer = stripped.isEmpty ? chatResult.content : stripped

        if let payload = extraction.payload, payload.action == "semantic_search",
           payload["query"]?.stringValue != nil {
            // Read action — allowed on BOTH paths (the classifier isn't
            // reliable enough to gate analytical reads; route parity).
            let searchQuery = payload.clip("query", AssistantLimits.maxMessage) ?? message
            let rawLimit = payload.jsNumber("limit")
            // JS Math.trunc + downstream clamp; a raw Int(Double) conversion
            // traps on an LLM-supplied limit like 1e30 (uncatchable crash).
            let safeLimit: Int = {
                guard rawLimit.isFinite else { return 6 }
                let t = rawLimit.rounded(.towardZero)
                if t >= Double(Int.max) { return Int.max }
                if t <= Double(Int.min) { return Int.min }
                return Int(t)
            }()
            let outcome = (try? semanticSearch.run(
                locationId: locationId,
                query: searchQuery,
                limit: safeLimit
            )) ?? KitchenSemanticSearchCompute.SearchResult(query: searchQuery, hits: [])
            actionMsg = KitchenSemanticSearchCompute.formatForPrompt(outcome)
            actionExecuted = true
            sources.append(AssistantContextSource(
                type: "semantic_search",
                detail: "\(outcome.hits.count) hit(s) for \"\(outcome.query.isEmpty ? "blank query" : outcome.query)\""
            ))
            finalAnswer = stripped
        } else if let payload = extraction.payload, payload.action == "code_search" {
            // DEFERRED (Phase B plan): lib/devCodeSearch.ts is dev-only and not
            // ported. Mirror the web's disabled-code posture: handled, NOT an
            // error (web treats 'disabled' as expected).
            actionMsg = "code_search isn't available on this device yet — use the web cockpit."
            actionExecuted = true
            finalAnswer = stripped
        } else if let payload = extraction.payload, payload.action == "db_query" {
            // DEFERRED (Phase B plan): lib/dbQueryTool.ts catalog not ported;
            // the prompt omits the catalog so the model rarely emits this.
            // Soft response, not an error (read-only surface).
            actionMsg = "db_query isn't available on this device yet — ask on the web cockpit."
            actionExecuted = true
            finalAnswer = stripped
        } else if extraction.payload != nil, !isCommand {
            // Hard-block action execution on the question path — hallucinated
            // JSON must never write regulated state. Only-JSON responses fall
            // back to a neutral apology rather than leaking the raw JSON.
            finalAnswer = stripped.isEmpty
                ? "Sorry — I couldn't put that together as an answer. Could you rephrase?"
                : stripped
        } else if let payload = extraction.payload, isCommand {
            do {
                let outcome = try await actions.execute(
                    payload: payload, hasPin: hasPin, locationId: locationId
                )
                actionExecuted = outcome.actionExecuted
                actionMsg = outcome.actionMsg
                undo = outcome.undo
            } catch {
                // Surface the failure WITHOUT the underlying exception text —
                // e.message can leak column names / schema / payload PII.
                actionError = true
                actionMsg = "Action failed unexpectedly. Show a manager — they may need to check logs."
                actionExecuted = true
            }
        }

        if actionExecuted {
            finalAnswer = "⚡ ACTION EXECUTED: \(actionMsg)\n\n\(finalAnswer)"
        }

        // Conversation store failures never fail the request (route parity).
        try? conversation.store(
            locationId: locationId,
            cookId: normalizedCookId,
            sessionId: sessionId,
            userContent: message,
            assistantContent: finalAnswer,
            managerTier: hasPin
        )

        return AssistantResponse(
            answer: finalAnswer,
            model: chatResult.model,
            locationId: locationId,
            sources: sources,
            latencyMs: Int(Date().timeIntervalSince(started) * 1000),
            actionExecuted: actionExecuted,
            actionError: actionError,
            undo: undo
        )
    }

    /// POST /api/kitchen-assistant/undo port — PIN gate first (403), then the
    /// repository's eligibility ladder.
    public func undoAction(
        undoAuditId: Int64,
        locationId: String,
        cookId: String?,
        hasPin: Bool
    ) throws -> AssistantUndoSuccess {
        guard hasPin else {
            throw EngineError(status: 403, message: "Manager PIN required.")
        }
        let clippedCook = cookId.flatMap { AssistantJSONValue.string($0).clip(64) }
        return try undoRepository.undo(
            auditEventId: undoAuditId, locationId: locationId, cookId: clippedCook
        )
    }
}
