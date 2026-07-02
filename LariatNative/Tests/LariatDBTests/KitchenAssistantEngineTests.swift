import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Route-level parity for POST /api/kitchen-assistant, driven exactly like the
/// web suites: a stubbed Ollama transport returns a fenced JSON action and the
/// deterministic post-LLM path is the system under test.
///
/// Oracles: test-kitchen-assistant-pin-gate.mjs, -action-hardening.mjs (route
/// shapes), -conversation-memory.mjs (route half), -undo.mjs (route half),
/// -semantic-search.mjs.
final class KitchenAssistantEngineTests: XCTestCase {
    private let LOC = "default"
    private let SESSION = "33333333-3333-4333-8333-333333333333"
    private let COOK = "cook-engine-suite"

    /// Ollama transport stub — same shape as the web `installFetchStub()`.
    final class ChatStub: OllamaTransport, @unchecked Sendable {
        var stubbedAction: String?           // JSON string for the fenced block
        var prose = "OK — action emitted."
        var plainAnswer: String?             // question-path prose (no JSON)
        private(set) var chatCalls = 0
        private(set) var lastUserContent: String?

        func post(url: URL, body: Data, timeoutMs: Int) async throws -> (data: Data, statusCode: Int) {
            chatCalls += 1
            if let parsed = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
               let messages = parsed["messages"] as? [[String: Any]] {
                lastUserContent = messages.last?["content"] as? String
            }
            let content: String
            if let plainAnswer {
                content = plainAnswer
            } else if let stubbedAction {
                content = "```json\n\(stubbedAction)\n```\n\(prose)"
            } else {
                content = "Plain prose answer."
            }
            let data = try JSONSerialization.data(withJSONObject: ["message": ["content": content]])
            return (data, 200)
        }

        func get(url: URL, timeoutMs: Int) async throws -> (data: Data, statusCode: Int) {
            (Data("{}".utf8), 200)
        }
    }

    private struct Env {
        let engine: KitchenAssistantEngine
        let stub: ChatStub
        let writeDB: LariatWriteDatabase
        let path: String
    }

    private func makeEngine(calculator: RecipeCalculating? = nil) throws -> Env {
        let path = try seedAssistantDatabase()
        let readDB = try LariatDatabase(path: path)
        let writeDB = try LariatWriteDatabase(path: path)
        let stub = ChatStub()
        let engine = KitchenAssistantEngine(
            ollama: OllamaClient(transport: stub, env: [:]),
            context: AssistantContextRepository(
                readDB: readDB,
                caches: AssistantContextRepository.Caches(
                    recipes: { [] }, menu: { [] }, allergenMatrix: { [:] },
                    staff: { [] }, foodSafety: { AssistantFoodSafetyData(ccps: []) },
                    vendorSummary: { nil }, laborSummary: { nil },
                    stations: { StationCatalog(stations: [], lineCheckTemplates: [:], recipes: []) }
                )
            ),
            conversation: AssistantConversationRepository(writeDB: writeDB),
            actions: AssistantActionRepository(writeDB: writeDB, calculator: calculator),
            semanticSearch: KitchenSemanticSearchRepository(readDB: readDB, loadRecipes: { [] }),
            undoRepository: AssistantUndoRepository(writeDB: writeDB)
        )
        return Env(engine: engine, stub: stub, writeDB: writeDB, path: path)
    }

    private func inspect<T>(_ writeDB: LariatWriteDatabase, _ block: (Database) throws -> T) throws -> T {
        try writeDB.pool.read(block)
    }

    private func count(_ writeDB: LariatWriteDatabase, _ table: String) throws -> Int {
        try inspect(writeDB) { try Int.fetchOne($0, sql: "SELECT COUNT(*) FROM \(table)") ?? -1 }
    }

    // ── input validation (route 400s) ───────────────────────────────

    func testEmptyMessageIs400() async throws {
        let env = try makeEngine()
        defer { cleanupAssistantDatabase(env.path) }
        do {
            _ = try await env.engine.ask(
                message: "   ", locationId: LOC, cookId: COOK,
                conversationSessionId: SESSION, hasPin: false
            )
            XCTFail("expected 400")
        } catch let e as KitchenAssistantEngine.EngineError {
            XCTAssertEqual(e, .init(status: 400, message: "message is required"))
        }
    }

    func testOverlongMessageIs400() async throws {
        let env = try makeEngine()
        defer { cleanupAssistantDatabase(env.path) }
        do {
            _ = try await env.engine.ask(
                message: String(repeating: "x", count: 2001), locationId: LOC, cookId: COOK,
                conversationSessionId: SESSION, hasPin: false
            )
            XCTFail("expected 400")
        } catch let e as KitchenAssistantEngine.EngineError {
            XCTAssertEqual(e, .init(status: 400, message: "message too long (max 2000 chars)"))
        }
    }

    func testInvalidSessionIdIs400() async throws {
        let env = try makeEngine()
        defer { cleanupAssistantDatabase(env.path) }
        do {
            _ = try await env.engine.ask(
                message: "hello", locationId: LOC, cookId: COOK,
                conversationSessionId: "not-a-uuid", hasPin: false
            )
            XCTFail("expected 400")
        } catch let e as KitchenAssistantEngine.EngineError {
            XCTAssertEqual(e.status, 400)
            XCTAssertEqual(e.message, "conversation_session_id is required and must be a UUID")
        }
    }

    // ── #248 PIN gate short-circuits BEFORE the LLM ─────────────────

    func testUnpinnedWriteCommandBlocksAndSkipsOllama() async throws {
        let env = try makeEngine()
        defer { cleanupAssistantDatabase(env.path) }
        env.stub.stubbedAction = #"{"action":"eighty_six","item":"salmon","reason":"sold out"}"#

        let res = try await env.engine.ask(
            message: "eighty-six the salmon", locationId: LOC, cookId: COOK,
            conversationSessionId: SESSION, hasPin: false
        )
        XCTAssertEqual(res.model, "pin-required")
        XCTAssertFalse(res.actionExecuted)
        XCTAssertFalse(res.actionError, "the block is policy, not failure")
        XCTAssertTrue(res.answer.lowercased().contains("ask a manager"))
        XCTAssertEqual(res.latencyMs, 0)
        XCTAssertEqual(res.sources, [])
        XCTAssertEqual(try count(env.writeDB, "eighty_six"), 0)
        XCTAssertEqual(env.stub.chatCalls, 0, "#248: Ollama must not be called for un-PIN'd imperative commands")
    }

    // ── valid PIN executes end-to-end ───────────────────────────────

    func testPinnedEightySixExecutesEndToEnd() async throws {
        let env = try makeEngine()
        defer { cleanupAssistantDatabase(env.path) }
        env.stub.stubbedAction = #"{"action":"eighty_six","item":"salmon","reason":"sold out"}"#

        let res = try await env.engine.ask(
            message: "eighty-six the salmon", locationId: LOC, cookId: COOK,
            conversationSessionId: SESSION, hasPin: true
        )
        XCTAssertTrue(res.answer.contains("Marked salmon as 86'd."))
        XCTAssertTrue(res.answer.hasPrefix("⚡ ACTION EXECUTED: "))
        XCTAssertTrue(res.actionExecuted)
        XCTAssertNotNil(res.undo)
        XCTAssertEqual(res.disclaimer, "Check tags with a manager. Do not trust AI for allergies.")
        try inspect(env.writeDB) { db in
            let row = try Row.fetchOne(db, sql: "SELECT item, reason FROM eighty_six")!
            XCTAssertEqual(row["item"], "salmon")
            XCTAssertEqual(row["reason"], "sold out")
        }
    }

    // ── question path hard-blocks hallucinated action JSON ──────────

    func testQuestionPathStripsHallucinatedActionJSON() async throws {
        let env = try makeEngine()
        defer { cleanupAssistantDatabase(env.path) }
        env.stub.stubbedAction = #"{"action":"eighty_six","item":"salmon"}"#
        env.stub.prose = "Marking that as 86."

        let res = try await env.engine.ask(
            message: "is the salmon 86 today?", locationId: LOC, cookId: COOK,
            conversationSessionId: SESSION, hasPin: true
        )
        XCTAssertFalse(res.actionExecuted, "question path must never execute state mutations")
        XCTAssertEqual(try count(env.writeDB, "eighty_six"), 0)
        XCTAssertEqual(res.answer, "Marking that as 86.", "JSON stripped to prose")
    }

    func testQuestionPathOnlyJSONFallsBackToApology() async throws {
        let env = try makeEngine()
        defer { cleanupAssistantDatabase(env.path) }
        env.stub.plainAnswer = #"{"action":"eighty_six","item":"salmon"}"#

        let res = try await env.engine.ask(
            message: "what's 86 today?", locationId: LOC, cookId: COOK,
            conversationSessionId: SESSION, hasPin: true
        )
        XCTAssertEqual(res.answer, "Sorry — I couldn't put that together as an answer. Could you rephrase?")
        XCTAssertFalse(res.answer.contains("{"), "raw JSON never leaks to the cook")
    }

    // ── action-engine exception → actionError, no leak ──────────────

    func testHandlerExceptionSurfacesActionErrorWithoutLeak() async throws {
        let env = try makeEngine()
        defer { cleanupAssistantDatabase(env.path) }
        env.stub.stubbedAction =
            #"{"action":"line_check","station":"grill","item":"walk-in cooler probe","status":"INVALID_STATUS"}"#

        let res = try await env.engine.ask(
            message: "log the walk-in line check", locationId: LOC, cookId: COOK,
            conversationSessionId: SESSION, hasPin: true
        )
        XCTAssertTrue(res.actionExecuted, "action attempt must be flagged")
        XCTAssertTrue(res.actionError, "actionError flag must be set")
        XCTAssertTrue(res.answer.lowercased().contains("action failed"))
        XCTAssertFalse(res.answer.contains("CHECK constraint"), "no SQL text in the cook-facing answer")
        XCTAssertFalse(res.answer.lowercased().contains("sqlite"), "no SQL text in the cook-facing answer")
        XCTAssertEqual(try count(env.writeDB, "line_check_entries"), 0, "transaction rolled back; no row")
    }

    // ── conversation memory (route half) ────────────────────────────

    func testConversationTurnStoredWithManagerTierFlag() async throws {
        let env = try makeEngine()
        defer { cleanupAssistantDatabase(env.path) }
        env.stub.plainAnswer = "We sold 40 burgers."

        _ = try await env.engine.ask(
            message: "what did we sell?", locationId: LOC, cookId: COOK,
            conversationSessionId: SESSION, hasPin: true
        )
        try inspect(env.writeDB) { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM lari_conversation_turns")!
            XCTAssertEqual(row["user_content"], "what did we sell?")
            XCTAssertEqual(row["assistant_content"], "We sold 40 burgers.")
            XCTAssertEqual(row["manager_tier"], 1)
            XCTAssertEqual(row["cook_id"], COOK)
            XCTAssertEqual(row["conversation_session_id"], SESSION)
        }
    }

    func testPriorTurnsInjectedIntoPrompt() async throws {
        let env = try makeEngine()
        defer { cleanupAssistantDatabase(env.path) }
        env.stub.plainAnswer = "First answer."
        _ = try await env.engine.ask(
            message: "first question", locationId: LOC, cookId: COOK,
            conversationSessionId: SESSION, hasPin: false
        )
        env.stub.plainAnswer = "Second answer."
        _ = try await env.engine.ask(
            message: "second question", locationId: LOC, cookId: COOK,
            conversationSessionId: SESSION, hasPin: false
        )
        let prompt = try XCTUnwrap(env.stub.lastUserContent)
        XCTAssertTrue(prompt.contains("PRIOR TURNS (non-authoritative conversation context):"))
        XCTAssertTrue(prompt.contains("Turn 1 user: first question"))
        XCTAssertTrue(prompt.contains("Turn 1 assistant: First answer."))
    }

    func testManagerTierTurnHiddenFromCookTierPrompt() async throws {
        let env = try makeEngine()
        defer { cleanupAssistantDatabase(env.path) }
        env.stub.plainAnswer = "Manager-only sales answer."
        _ = try await env.engine.ask(
            message: "what did we sell", locationId: LOC, cookId: COOK,
            conversationSessionId: SESSION, hasPin: true
        )
        env.stub.plainAnswer = "Cook answer."
        _ = try await env.engine.ask(
            message: "and the specials?", locationId: LOC, cookId: COOK,
            conversationSessionId: SESSION, hasPin: false
        )
        let prompt = try XCTUnwrap(env.stub.lastUserContent)
        XCTAssertFalse(prompt.contains("Manager-only sales answer."),
                       "manager-tier turns never leak into a cook-tier prompt")
    }

    // ── #247 context tiering rides through the engine ───────────────

    func testCookTierPromptCarriesRedactionSentinels() async throws {
        let env = try makeEngine()
        defer { cleanupAssistantDatabase(env.path) }
        env.stub.plainAnswer = "Ask a manager."
        _ = try await env.engine.ask(
            message: "show me labor cost and overtime hours", locationId: LOC, cookId: COOK,
            conversationSessionId: SESSION, hasPin: false
        )
        let prompt = try XCTUnwrap(env.stub.lastUserContent)
        XCTAssertTrue(prompt.contains("LABOR SUMMARY: not available at this auth tier"))
        XCTAssertTrue(prompt.contains("NOT IN THIS CONTEXT:"))
        XCTAssertTrue(prompt.contains("labor figures"))
    }

    // ── semantic_search read action ─────────────────────────────────

    func testSemanticSearchActionRunsOnQuestionPath() async throws {
        let env = try makeEngine()
        defer { cleanupAssistantDatabase(env.path) }
        // Seed a BEO line item so the local corpus can hit.
        _ = try env.writeDB.write { db in
            try db.execute(
                sql: "INSERT INTO beo_events (title, event_date, contact_name, guest_count, location_id) VALUES ('Parker Wedding', '2026-06-20', 'Avery', 140, ?)",
                arguments: [LOC]
            )
            let eventId = db.lastInsertedRowID
            try db.execute(
                sql: "INSERT INTO beo_line_items (event_id, sort_order, item_name, category, quantity, prep_notes) VALUES (?, 1, 'Tiered almond cake with cherry filling', 'Dessert', 140, 'Keep filling cold.')",
                arguments: [eventId]
            )
        }
        env.stub.stubbedAction = #"{"action":"semantic_search","query":"wedding cake cherry filling","limit":6}"#
        env.stub.prose = "Here's what I found."

        let res = try await env.engine.ask(
            message: "what's that wedding cake recipe with the cherry filling", locationId: LOC, cookId: COOK,
            conversationSessionId: SESSION, hasPin: false
        )
        XCTAssertTrue(res.actionExecuted)
        XCTAssertFalse(res.actionError)
        XCTAssertTrue(res.answer.contains("⚡ ACTION EXECUTED: Semantic search for \"wedding cake cherry filling\""))
        XCTAssertTrue(res.answer.contains("Tiered almond cake with cherry filling"))
        XCTAssertTrue(res.sources.contains { $0.type == "semantic_search" })
    }

    // ── deferred read actions (documented Phase B deferral) ─────────

    func testDbQueryActionSoftRespondsAsDeferred() async throws {
        let env = try makeEngine()
        defer { cleanupAssistantDatabase(env.path) }
        env.stub.stubbedAction = #"{"action":"db_query","query":"sales_yesterday","params":{}}"#

        let res = try await env.engine.ask(
            message: "what did we sell yesterday?", locationId: LOC, cookId: COOK,
            conversationSessionId: SESSION, hasPin: true
        )
        XCTAssertTrue(res.actionExecuted)
        XCTAssertFalse(res.actionError, "deferral is expected behavior, not an error")
        XCTAssertTrue(res.answer.contains("db_query isn't available on this device yet"))
    }

    // ── undo route half ─────────────────────────────────────────────

    func testUndoRouteRequiresPin403() throws {
        let env = try makeEngine()
        defer { cleanupAssistantDatabase(env.path) }
        do {
            _ = try env.engine.undoAction(undoAuditId: 1, locationId: LOC, cookId: COOK, hasPin: false)
            XCTFail("expected 403")
        } catch let e as KitchenAssistantEngine.EngineError {
            XCTAssertEqual(e, .init(status: 403, message: "Manager PIN required."))
        }
    }

    func testUndoRouteEndToEnd() async throws {
        let env = try makeEngine()
        defer { cleanupAssistantDatabase(env.path) }
        env.stub.stubbedAction = #"{"action":"eighty_six","item":"salmon","reason":"out"}"#
        let res = try await env.engine.ask(
            message: "86 the salmon", locationId: LOC, cookId: COOK,
            conversationSessionId: SESSION, hasPin: true
        )
        let undoMeta = try XCTUnwrap(res.undo)
        let success = try env.engine.undoAction(
            undoAuditId: undoMeta.auditEventId, locationId: LOC, cookId: COOK, hasPin: true
        )
        XCTAssertTrue(success.message.contains("back on"))
        try inspect(env.writeDB) { db in
            XCTAssertNotNil(
                try String.fetchOne(db, sql: "SELECT resolved_at FROM eighty_six WHERE id = ?", arguments: [undoMeta.entityId]) ?? nil
            )
        }
    }

    // ── 502 mapping ─────────────────────────────────────────────────

    func testOllamaTimeoutMapsTo502WithFriendlyCopy() async throws {
        final class TimeoutStub: OllamaTransport, @unchecked Sendable {
            func post(url: URL, body: Data, timeoutMs: Int) async throws -> (data: Data, statusCode: Int) {
                throw OllamaClientError.timedOut
            }
            func get(url: URL, timeoutMs: Int) async throws -> (data: Data, statusCode: Int) {
                (Data(), 200)
            }
        }
        let path = try seedAssistantDatabase()
        defer { cleanupAssistantDatabase(path) }
        let readDB = try LariatDatabase(path: path)
        let writeDB = try LariatWriteDatabase(path: path)
        let engine = KitchenAssistantEngine(
            ollama: OllamaClient(transport: TimeoutStub(), env: [:]),
            context: AssistantContextRepository(
                readDB: readDB,
                caches: AssistantContextRepository.Caches(
                    recipes: { [] }, menu: { [] }, allergenMatrix: { [:] },
                    staff: { [] }, foodSafety: { AssistantFoodSafetyData(ccps: []) },
                    vendorSummary: { nil }, laborSummary: { nil },
                    stations: { StationCatalog(stations: [], lineCheckTemplates: [:], recipes: []) }
                )
            ),
            conversation: AssistantConversationRepository(writeDB: writeDB),
            actions: AssistantActionRepository(writeDB: writeDB),
            semanticSearch: KitchenSemanticSearchRepository(readDB: readDB, loadRecipes: { [] }),
            undoRepository: AssistantUndoRepository(writeDB: writeDB)
        )
        do {
            _ = try await engine.ask(
                message: "hello there", locationId: LOC, cookId: COOK,
                conversationSessionId: SESSION, hasPin: false
            )
            XCTFail("expected 502")
        } catch let e as KitchenAssistantEngine.EngineError {
            XCTAssertEqual(e.status, 502)
            XCTAssertEqual(e.message, "Inference timed out — try a shorter question or a smaller model.")
        }
    }
}
