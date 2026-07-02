import XCTest
@testable import LariatModel

/// Pure-half parity: tests/js/test-lari-conversation-memory.mjs (normalize +
/// format cases) and tests/js/test-kitchen-assistant-undo.mjs (meta cases).
final class AssistantMemoryUndoComputeTests: XCTestCase {
    private let SESSION = "11111111-1111-4111-8111-111111111111"

    // ── normalizeConversationInputs ─────────────────────────────────

    func testAcceptsUUIDSessionAndTrimsCookId() {
        let r = LariConversationMemoryCompute.normalizeConversationInputs(
            sessionId: " \(SESSION) ", cookId: "  cook-alex  "
        )
        XCTAssertEqual(r, .ok(sessionId: SESSION, cookId: "cook-alex"))
    }

    func testNormalizesMissingCookIdToAnonymous() {
        let r = LariConversationMemoryCompute.normalizeConversationInputs(sessionId: SESSION, cookId: nil)
        XCTAssertEqual(r, .ok(sessionId: SESSION, cookId: "anonymous"))
    }

    func testFailsClosedOnMissingOrInvalidSessionId() {
        let err = LariConversationMemoryCompute.NormalizedInputs.error(LariConversationMemoryCompute.sessionIdError)
        XCTAssertEqual(LariConversationMemoryCompute.normalizeConversationInputs(sessionId: nil, cookId: nil), err)
        XCTAssertEqual(LariConversationMemoryCompute.normalizeConversationInputs(sessionId: "not-a-uuid", cookId: nil), err)
        XCTAssertEqual(LariConversationMemoryCompute.normalizeConversationInputs(sessionId: "\(SESSION)extra", cookId: nil), err)
    }

    func testClipsLongCookIdToFixedCap() {
        let r = LariConversationMemoryCompute.normalizeConversationInputs(
            sessionId: SESSION, cookId: String(repeating: "x", count: 100)
        )
        guard case .ok(_, let cookId) = r else { return XCTFail("expected ok") }
        XCTAssertEqual(cookId.count, LariConversationMemoryCompute.cookIdMaxChars)
    }

    // ── formatConversationHistoryForPrompt ──────────────────────────

    func testFormatLabelsNonAuthoritativeAndClips() {
        let long = String(repeating: "x", count: LariConversationMemoryCompute.promptTurnContentMaxChars + 50)
        let text = LariConversationMemoryCompute.formatConversationHistoryForPrompt([
            StoredConversationTurn(
                id: 1, userContent: "show vendor shocks", assistantContent: long,
                managerTier: 0, createdAt: "2026-06-03T10:00:00.000Z"
            ),
        ])
        XCTAssertTrue(text.lowercased().contains("non-authoritative conversation context"))
        XCTAssertTrue(text.lowercased().contains("live grounded context and db_query remain authoritative"))
        XCTAssertLessThan(text.count, LariConversationMemoryCompute.promptTurnContentMaxChars + 500)
        XCTAssertFalse(text.contains(String(repeating: "x", count: 900)))
    }

    func testFormatEmptyTurnsIsEmptyString() {
        XCTAssertEqual(LariConversationMemoryCompute.formatConversationHistoryForPrompt([]), "")
    }

    func testAddHoursIsoEightHourTtl() {
        XCTAssertEqual(
            LariConversationMemoryCompute.addHoursIso("2026-06-03T01:00:00.000Z", hours: 8),
            "2026-06-03T09:00:00.000Z"
        )
    }

    // ── buildUndoMeta ───────────────────────────────────────────────

    func testBuildUndoMetaHappyPathExpires30sAfterCreatedAt() {
        let meta = AssistantUndoCompute.buildUndoMeta(
            auditEventId: 12, entity: "eighty_six", entityId: 4,
            label: "Marked salmon as 86'd.", createdAt: "2026-06-03T10:00:00.000Z"
        )
        XCTAssertEqual(meta?.auditEventId, 12)
        XCTAssertEqual(meta?.entity, .eightySix)
        XCTAssertEqual(meta?.entityId, 4)
        XCTAssertEqual(meta?.label, "Marked salmon as 86'd.")
        XCTAssertEqual(meta?.expiresAt, "2026-06-03T10:00:30.000Z")
    }

    func testBuildUndoMetaRejectsInvalidInputs() {
        XCTAssertNil(AssistantUndoCompute.buildUndoMeta(auditEventId: nil, entity: "eighty_six", entityId: 4, label: "x"))
        XCTAssertNil(AssistantUndoCompute.buildUndoMeta(auditEventId: 12, entity: "beo_prep_tasks", entityId: 4, label: "x"),
                     "batch entities are not undoable")
        XCTAssertNil(AssistantUndoCompute.buildUndoMeta(auditEventId: 12, entity: "eighty_six", entityId: 0, label: "x"))
        XCTAssertNil(AssistantUndoCompute.buildUndoMeta(auditEventId: 12, entity: "eighty_six", entityId: nil, label: "x"))
        XCTAssertNil(AssistantUndoCompute.buildUndoMeta(auditEventId: 12, entity: "eighty_six", entityId: 4, label: "   "))
        XCTAssertNil(AssistantUndoCompute.buildUndoMeta(auditEventId: 12, entity: "eighty_six", entityId: 4, label: "x", createdAt: "garbage"))
    }

    func testNormalizeTimestampMsSqliteAndIsoShapes() {
        // SQLite datetime('now') shape — no zone, space separator, UTC.
        let sqlite = AssistantUndoCompute.normalizeTimestampMs("2026-06-03 10:00:00")
        let iso = AssistantUndoCompute.normalizeTimestampMs("2026-06-03T10:00:00Z")
        let isoMs = AssistantUndoCompute.normalizeTimestampMs("2026-06-03T10:00:00.000Z")
        XCTAssertEqual(sqlite, iso)
        XCTAssertEqual(iso, isoMs)
        XCTAssertTrue(AssistantUndoCompute.normalizeTimestampMs("").isNaN)
        XCTAssertTrue(AssistantUndoCompute.normalizeTimestampMs("nonsense").isNaN)
    }

    func testUndoSuccessMessages() {
        XCTAssertEqual(
            AssistantUndoCompute.undoSuccessMessage(entity: .eightySix, beforeItem: "salmon", beforeIngredient: nil, beforeCookName: nil),
            "salmon is back on."
        )
        XCTAssertEqual(
            AssistantUndoCompute.undoSuccessMessage(entity: .lineCheckEntries, beforeItem: "cooler gasket", beforeIngredient: nil, beforeCookName: nil),
            "Removed cooler gasket."
        )
        XCTAssertEqual(
            AssistantUndoCompute.undoSuccessMessage(entity: .inventoryUpdates, beforeItem: nil, beforeIngredient: nil, beforeCookName: nil),
            "Removed that stock update."
        )
        XCTAssertEqual(
            AssistantUndoCompute.undoSuccessMessage(entity: .orderGuideItems, beforeItem: nil, beforeIngredient: "shallots", beforeCookName: nil),
            "Removed shallots."
        )
        XCTAssertEqual(
            AssistantUndoCompute.undoSuccessMessage(entity: .equipmentMaintenance, beforeItem: nil, beforeIngredient: nil, beforeCookName: nil),
            "Removed that maintenance ticket."
        )
        XCTAssertEqual(
            AssistantUndoCompute.undoSuccessMessage(entity: .goldStars, beforeItem: nil, beforeIngredient: nil, beforeCookName: "Alice"),
            "Removed Alice's Gold Star."
        )
    }
}
