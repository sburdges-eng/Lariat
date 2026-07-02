import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Parity port of tests/js/test-kitchen-assistant-undo.mjs (the undo route
/// half) — web HTTP statuses pinned as `AssistantUndoError.status`.
final class AssistantUndoRepositoryTests: XCTestCase {
    private let LOC = "default"
    private let COOK = "cook-undo-suite"

    private func makeRepos() throws -> (
        actions: AssistantActionRepository,
        undo: AssistantUndoRepository,
        writeDB: LariatWriteDatabase,
        path: String
    ) {
        let path = try seedAssistantDatabase()
        let writeDB = try LariatWriteDatabase(path: path)
        return (
            AssistantActionRepository(writeDB: writeDB),
            AssistantUndoRepository(writeDB: writeDB),
            writeDB,
            path
        )
    }

    private func inspect<T>(_ writeDB: LariatWriteDatabase, _ block: (Database) throws -> T) throws -> T {
        try writeDB.pool.read(block)
    }

    private func run86(_ actions: AssistantActionRepository, item: String = "salmon") async throws -> KitchenAssistantUndoMeta {
        let out = try await actions.execute(
            payload: AssistantActionPayload(action: "eighty_six", fields: [
                "item": .string(item), "reason": .string("out"),
            ]),
            hasPin: true, locationId: LOC
        )
        return try XCTUnwrap(out.undo)
    }

    private func runLineCheck(_ actions: AssistantActionRepository, item: String = "cooler gasket") async throws -> KitchenAssistantUndoMeta {
        let out = try await actions.execute(
            payload: AssistantActionPayload(action: "line_check", fields: [
                "station": .string("grill"), "item": .string(item), "status": .string("pass"),
            ]),
            hasPin: true, locationId: LOC
        )
        return try XCTUnwrap(out.undo)
    }

    private func corrections(_ writeDB: LariatWriteDatabase, replacing id: Int64) throws -> [Row] {
        try inspect(writeDB) { db in
            try Row.fetchAll(
                db,
                sql: "SELECT * FROM audit_events WHERE action = 'correction' AND replaces_id = ?",
                arguments: [id]
            )
        }
    }

    private func backdateAudit(_ writeDB: LariatWriteDatabase, id: Int64, seconds: Int) throws {
        _ = try writeDB.write { db in
            try db.execute(
                sql: "UPDATE audit_events SET created_at = datetime('now', ?) WHERE id = ?",
                arguments: ["-\(seconds) seconds", id]
            )
        }
    }

    // ── 2. 86 undo: resolve + correction row ────────────────────────

    func testEightySixUndoResolvesRowAndWritesLinkedCorrection() async throws {
        let (actions, undo, writeDB, path) = try makeRepos()
        defer { cleanupAssistantDatabase(path) }
        let meta = try await run86(actions)

        let result = try undo.undo(auditEventId: meta.auditEventId, locationId: LOC, cookId: COOK)
        XCTAssertTrue(result.message.lowercased().contains("back on"), "kitchen-native success copy")

        try inspect(writeDB) { db in
            // Source row is resolved, not deleted — the 86 board history stays.
            let row = try Row.fetchOne(db, sql: "SELECT * FROM eighty_six WHERE id = ?", arguments: [meta.entityId])
            XCTAssertNotNil(row, "86 row still exists")
            XCTAssertNotNil(row?["resolved_at"] as String?, "86 row is marked resolved")
            XCTAssertEqual(row?["resolved_by"], COOK)
        }

        let correctionRows = try corrections(writeDB, replacing: meta.auditEventId)
        XCTAssertEqual(correctionRows.count, 1, "exactly one correction row")
        let correction = correctionRows[0]
        XCTAssertEqual(correction["entity"], "eighty_six")
        XCTAssertEqual(correction["entity_id"] as Int64?, meta.entityId)
        XCTAssertEqual(correction["replaces_id"] as Int64?, meta.auditEventId)
        XCTAssertEqual(correction["actor_source"], "kitchen_assistant_undo")
        XCTAssertEqual(correction["note"], "undo_30s")
        XCTAssertEqual(result.correctedAuditId, correction["id"] as Int64?)

        // Append-only: the original audit row is never mutated.
        try inspect(writeDB) { db in
            let original = try Row.fetchOne(db, sql: "SELECT action FROM audit_events WHERE id = ?", arguments: [meta.auditEventId])
            XCTAssertEqual(original?["action"], "insert")
        }
    }

    // ── 3. line check undo: delete + correction with before/after ───

    func testLineCheckUndoDeletesRowAndPreservesBeforeSnapshot() async throws {
        let (actions, undo, writeDB, path) = try makeRepos()
        defer { cleanupAssistantDatabase(path) }
        let meta = try await runLineCheck(actions)

        let result = try undo.undo(auditEventId: meta.auditEventId, locationId: LOC, cookId: COOK)
        XCTAssertTrue(result.message.contains("Removed cooler gasket."))

        try inspect(writeDB) { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM line_check_entries WHERE id = ?", arguments: [meta.entityId])
            XCTAssertNil(row, "line check row is removed")
        }
        let correctionRows = try corrections(writeDB, replacing: meta.auditEventId)
        XCTAssertEqual(correctionRows.count, 1)
        XCTAssertEqual(correctionRows[0]["entity"], "line_check_entries")
        // Correction payload preserves what was removed — inspector-reconstructable.
        let payloadJSON = try XCTUnwrap(correctionRows[0]["payload_json"] as String?)
        let parsed = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(payloadJSON.utf8)) as? [String: Any]
        )
        let before = try XCTUnwrap(parsed["before"] as? [String: Any])
        XCTAssertEqual(before["item"] as? String, "cooler gasket")
        XCTAssertTrue(parsed["after"] is NSNull, "after == null for deletes")
        XCTAssertEqual(parsed["undo_window_ms"] as? Int, 30_000)
    }

    // ── 4. 30s expiry ───────────────────────────────────────────────

    func testUndoAfterWindowRejects409WithNoStateChange() async throws {
        let (actions, undo, writeDB, path) = try makeRepos()
        defer { cleanupAssistantDatabase(path) }
        let meta = try await run86(actions, item: "brisket")
        try backdateAudit(writeDB, id: meta.auditEventId, seconds: 61)

        do {
            _ = try undo.undo(auditEventId: meta.auditEventId, locationId: LOC, cookId: COOK)
            XCTFail("expected 409")
        } catch let e as AssistantUndoError {
            XCTAssertEqual(e.status, 409)
            XCTAssertTrue(e.message.lowercased().contains("time ran out"))
        }
        try inspect(writeDB) { db in
            let row = try Row.fetchOne(db, sql: "SELECT resolved_at FROM eighty_six WHERE id = ?", arguments: [meta.entityId])
            XCTAssertNil(row?["resolved_at"] as String?, "86 row stays unresolved")
        }
        XCTAssertEqual(try corrections(writeDB, replacing: meta.auditEventId).count, 0, "no correction row written")
    }

    // ── 5. double undo ──────────────────────────────────────────────

    func testSecondUndoRejects409AndKeepsSingleCorrection() async throws {
        let (actions, undo, writeDB, path) = try makeRepos()
        defer { cleanupAssistantDatabase(path) }
        let meta = try await runLineCheck(actions, item: "gasket")

        _ = try undo.undo(auditEventId: meta.auditEventId, locationId: LOC, cookId: COOK)
        do {
            _ = try undo.undo(auditEventId: meta.auditEventId, locationId: LOC, cookId: COOK)
            XCTFail("expected 409")
        } catch let e as AssistantUndoError {
            XCTAssertEqual(e.status, 409)
            XCTAssertTrue(e.message.lowercased().contains("already"))
        }
        XCTAssertEqual(try corrections(writeDB, replacing: meta.auditEventId).count, 1, "still exactly one correction row")
    }

    // ── eligibility ladder ──────────────────────────────────────────

    func testInvalidIdIs400() throws {
        let (_, undo, _, path) = try makeRepos()
        defer { cleanupAssistantDatabase(path) }
        do {
            _ = try undo.undo(auditEventId: 0, locationId: LOC, cookId: COOK)
            XCTFail("expected 400")
        } catch let e as AssistantUndoError {
            XCTAssertEqual(e, AssistantUndoError(status: 400, message: "Undo id is missing."))
        }
    }

    func testMissingAuditRowIs404() throws {
        let (_, undo, _, path) = try makeRepos()
        defer { cleanupAssistantDatabase(path) }
        do {
            _ = try undo.undo(auditEventId: 999_999, locationId: LOC, cookId: COOK)
            XCTFail("expected 404")
        } catch let e as AssistantUndoError {
            XCTAssertEqual(e, AssistantUndoError(status: 404, message: "That action is gone."))
        }
    }

    func testForeignLocationIs404NotALeak() async throws {
        let (actions, undo, writeDB, path) = try makeRepos()
        defer { cleanupAssistantDatabase(path) }
        let meta = try await run86(actions)
        do {
            _ = try undo.undo(auditEventId: meta.auditEventId, locationId: "site-b", cookId: COOK)
            XCTFail("expected 404")
        } catch let e as AssistantUndoError {
            XCTAssertEqual(e.status, 404, "cross-location undo reads as 'gone', not 403 — no existence leak")
        }
        try inspect(writeDB) { db in
            let row = try Row.fetchOne(db, sql: "SELECT resolved_at FROM eighty_six WHERE id = ?", arguments: [meta.entityId])
            XCTAssertNil(row?["resolved_at"] as String?)
        }
    }

    func testNonKitchenAssistantActorIs409() throws {
        let (_, undo, writeDB, path) = try makeRepos()
        defer { cleanupAssistantDatabase(path) }
        let auditId: Int64 = try writeDB.write { db in
            try db.execute(sql: "INSERT INTO eighty_six (location_id, item, shift_date) VALUES (?, 'x', date('now'))", arguments: [LOC])
            let rowId = db.lastInsertedRowID
            try db.execute(
                sql: """
                  INSERT INTO audit_events (shift_date, location_id, actor_source, entity, entity_id, action)
                  VALUES (date('now'), ?, 'native_cook', 'eighty_six', ?, 'insert')
                  """,
                arguments: [LOC, rowId]
            )
            return db.lastInsertedRowID
        }
        do {
            _ = try undo.undo(auditEventId: auditId, locationId: LOC, cookId: COOK)
            XCTFail("expected 409")
        } catch let e as AssistantUndoError {
            XCTAssertEqual(e, AssistantUndoError(status: 409, message: "That action cannot be undone."))
        }
    }

    func testNonUndoableEntityIs409() throws {
        let (_, undo, writeDB, path) = try makeRepos()
        defer { cleanupAssistantDatabase(path) }
        let auditId: Int64 = try writeDB.write { db in
            try db.execute(
                sql: """
                  INSERT INTO audit_events (shift_date, location_id, actor_source, entity, entity_id, action)
                  VALUES (date('now'), ?, 'kitchen_assistant', 'beo_prep_tasks', 5, 'insert')
                  """,
                arguments: [LOC]
            )
            return db.lastInsertedRowID
        }
        do {
            _ = try undo.undo(auditEventId: auditId, locationId: LOC, cookId: COOK)
            XCTFail("expected 409")
        } catch let e as AssistantUndoError {
            XCTAssertEqual(e, AssistantUndoError(status: 409, message: "That action cannot be undone."))
        }
    }

    func testSourceRowAlreadyGoneIs409() async throws {
        let (actions, undo, writeDB, path) = try makeRepos()
        defer { cleanupAssistantDatabase(path) }
        let meta = try await runLineCheck(actions)
        _ = try writeDB.write { db in
            try db.execute(sql: "DELETE FROM line_check_entries WHERE id = ?", arguments: [meta.entityId])
        }
        do {
            _ = try undo.undo(auditEventId: meta.auditEventId, locationId: LOC, cookId: COOK)
            XCTFail("expected 409")
        } catch let e as AssistantUndoError {
            XCTAssertEqual(e, AssistantUndoError(status: 409, message: "That action was already changed."))
        }
    }

    func testEightySixAlreadyResolvedIs409() async throws {
        let (actions, undo, writeDB, path) = try makeRepos()
        defer { cleanupAssistantDatabase(path) }
        let meta = try await run86(actions)
        _ = try writeDB.write { db in
            try db.execute(
                sql: "UPDATE eighty_six SET resolved_at = datetime('now') WHERE id = ?",
                arguments: [meta.entityId]
            )
        }
        do {
            _ = try undo.undo(auditEventId: meta.auditEventId, locationId: LOC, cookId: COOK)
            XCTFail("expected 409")
        } catch let e as AssistantUndoError {
            XCTAssertEqual(e, AssistantUndoError(status: 409, message: "That 86 was already cleared."))
        }
        XCTAssertEqual(try corrections(writeDB, replacing: meta.auditEventId).count, 0,
                       "failed resolve writes no correction row (transaction discipline)")
    }
}
