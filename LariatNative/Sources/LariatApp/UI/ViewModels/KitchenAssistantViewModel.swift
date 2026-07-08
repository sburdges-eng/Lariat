import Foundation
import LariatDB
import LariatModel
import Observation

/// Backs `cook.assistant` — parity with `app/kitchen-assistant/
/// KitchenAssistantClient.jsx` + POST /api/kitchen-assistant.
///
/// Cook-tier by default; a manager PIN session widens the context tier and
/// unlocks the mutating LLM actions — same `hasPin` split the web threads
/// through `hasPinCookie(req)`. Undo affordance mirrors the 30-second window
/// (button disappears at `expires_at`).
@Observable @MainActor
final class KitchenAssistantViewModel {
    struct ChatTurn: Identifiable {
        enum Role { case cook, assistant }

        let id = UUID()
        let role: Role
        var text: String
        var sources: [AssistantContextSource] = []
        var actionExecuted = false
        var actionError = false
        var isBlocked = false          // model == 'pin-required'
        var undo: KitchenAssistantUndoMeta?
        var undoMessage: String?
        var latencyMs: Int = 0
        var model: String = ""
    }

    private(set) var turns: [ChatTurn] = []
    private(set) var isThinking = false
    private(set) var ollamaReachable: Bool?
    private(set) var modelName: String
    var input = ""
    var errorMessage: String?
    var showPinSheet = false

    /// route.js disclaimer — verbatim.
    let disclaimer = AssistantResponse.disclaimerText

    let pinStore: PinSessionStore
    let writeDatabase: LariatWriteDatabase
    private let engine: KitchenAssistantEngine
    private let ollama: OllamaClient
    private let locationId: String
    private let cookIdentity: CookIdentityStore
    /// One conversation session per screen visit (web: crypto.randomUUID()).
    private let conversationSessionId = UUID().uuidString.lowercased()
    private var nowTick: Task<Void, Never>?
    private var reachabilityTick: Task<Void, Never>?
    private(set) var now = Date()

    init(
        readDB: LariatDatabase,
        writeDB: LariatWriteDatabase,
        pinStore: PinSessionStore? = nil,
        cookIdentity: CookIdentityStore? = nil,
        locationId: String = LocationScope.resolve()
    ) {
        self.pinStore = pinStore ?? PinSessionStore.shared
        self.cookIdentity = cookIdentity ?? CookIdentityStore.shared
        self.locationId = locationId
        self.writeDatabase = writeDB
        let client = OllamaClient(transport: URLSessionOllamaTransport())
        self.ollama = client
        self.modelName = client.config().model
        #if os(macOS)
        let calculator: RecipeCalculating? = PythonBomCalculator()
        #else
        let calculator: RecipeCalculating? = nil
        #endif
        self.engine = KitchenAssistantEngine(
            ollama: client,
            context: AssistantContextRepository(
                readDB: readDB,
                datapack: DatapackRepository(),
                compliance: ComplianceSearchRepository()
            ),
            conversation: AssistantConversationRepository(writeDB: writeDB),
            actions: AssistantActionRepository(writeDB: writeDB, calculator: calculator),
            semanticSearch: KitchenSemanticSearchRepository(readDB: readDB),
            undoRepository: AssistantUndoRepository(writeDB: writeDB)
        )
    }

    var hasPin: Bool { pinStore.activeUser != nil }

    func start() {
        Task { await refreshReachability() }
        nowTick?.cancel()
        nowTick = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                self?.now = Date()
            }
        }
        // Keep the online/offline badge live while the screen is visible —
        // a single onAppear ping goes stale the moment Ollama starts/stops.
        reachabilityTick?.cancel()
        reachabilityTick = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15))
                await self?.refreshReachability()
            }
        }
    }

    func stop() {
        nowTick?.cancel()
        reachabilityTick?.cancel()
    }

    func refreshReachability() async {
        ollamaReachable = await ollama.ping()
    }

    /// Whether a turn's undo button is still inside the 30s window.
    func undoAvailable(_ turn: ChatTurn) -> Bool {
        guard let undo = turn.undo, turn.undoMessage == nil else { return false }
        guard let expires = LariConversationMemoryCompute.parseIsoDate(undo.expiresAt) else { return false }
        return now < expires
    }

    func undoSecondsLeft(_ turn: ChatTurn) -> Int {
        guard let undo = turn.undo,
              let expires = LariConversationMemoryCompute.parseIsoDate(undo.expiresAt)
        else { return 0 }
        return max(0, Int(expires.timeIntervalSince(now).rounded(.down)))
    }

    func send() {
        let message = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty, !isThinking else { return }
        input = ""
        errorMessage = nil
        turns.append(ChatTurn(role: .cook, text: message))
        isThinking = true

        Task { [weak self] in
            guard let self else { return }
            defer { self.isThinking = false }
            do {
                let res = try await self.engine.ask(
                    message: message,
                    locationId: self.locationId,
                    cookId: self.cookIdentity.cookId,
                    conversationSessionId: self.conversationSessionId,
                    hasPin: self.hasPin
                )
                self.turns.append(ChatTurn(
                    role: .assistant,
                    text: res.answer,
                    sources: res.sources,
                    actionExecuted: res.actionExecuted,
                    actionError: res.actionError,
                    isBlocked: res.model == "pin-required",
                    undo: res.undo,
                    latencyMs: res.latencyMs,
                    model: res.model
                ))
            } catch let e as KitchenAssistantEngine.EngineError {
                self.turns.append(ChatTurn(
                    role: .assistant, text: e.message, actionError: true
                ))
                await self.refreshReachability()
            } catch {
                self.turns.append(ChatTurn(
                    role: .assistant,
                    text: "Something went wrong talking to the assistant.",
                    actionError: true
                ))
                await self.refreshReachability()
            }
        }
    }

    /// 30-second undo — PIN-gated like POST /api/kitchen-assistant/undo.
    func undo(turnId: UUID) {
        guard let index = turns.firstIndex(where: { $0.id == turnId }),
              let meta = turns[index].undo
        else { return }
        guard hasPin else {
            showPinSheet = true
            return
        }
        do {
            let success = try engine.undoAction(
                undoAuditId: meta.auditEventId,
                locationId: locationId,
                cookId: cookIdentity.cookId,
                hasPin: true
            )
            turns[index].undoMessage = success.message
        } catch let e as AssistantUndoError {
            turns[index].undoMessage = e.message
        } catch let e as KitchenAssistantEngine.EngineError {
            turns[index].undoMessage = e.message
        } catch {
            turns[index].undoMessage = "Could not undo that action."
        }
    }

    func pinVerified(_ user: ManagerPinUser) {
        pinStore.save(user: user)
        showPinSheet = false
    }
}
