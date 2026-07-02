import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Manager receiving-match tier — `loadUnmatched` / `masterOptions` /
/// `resolveMatch` parity with `app/management/receiving-matches/page.jsx` and
/// `PATCH /api/receiving/matches/[id]`.
///
/// Oracle note: no dedicated JS test covers the manager PATCH route
/// (tests/js/test-receiving-api.mjs stops at "queued without a credit"), so
/// the web route CODE is the oracle here — every status branch and both
/// closed-loop credit paths (insert-fresh vs re-point-existing) are asserted
/// from the route source. The web route's `sync_feed` appendOp is deliberately
/// NOT ported (edge-blocker: cross-host sync transport stays on the edge).
final class ReceivingMatchesTests: XCTestCase {
    private let ctx = RegulatedWriteContext.nativeMac(pinUser: nil)

    // ── loadUnmatched ───────────────────────────────────────────────────

    func testLoadUnmatchedFiltersToTheManagerQueue() async throws {
        let (readDB, writeDB, path) = try makeMatchRepos(); defer { cleanupMatchFixture(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)

        // IN the queue:
        let unmatchedId = try seedReceivingRow(writeDB, item: "heirloom tomato", matchStatus: "unmatched", createdAt: "2026-07-01 10:00:00")
        let ambiguousId = try seedReceivingRow(writeDB, item: "milk 2%", status: "accepted_with_note", matchStatus: "ambiguous", createdAt: "2026-07-01 11:00:00")
        // OUT of the queue:
        _ = try seedReceivingRow(writeDB, item: "chicken", matchStatus: "matched")                       // already matched
        _ = try seedReceivingRow(writeDB, item: "bad milk", status: "rejected", matchStatus: "unmatched") // rejected
        _ = try seedReceivingRow(writeDB, item: "no qty", matchStatus: "unmatched", receivedQty: nil)     // no stock count
        _ = try seedReceivingRow(writeDB, item: "zero qty", matchStatus: "unmatched", receivedQty: 0)     // qty must be > 0
        _ = try seedReceivingRow(writeDB, item: "blank unit", matchStatus: "unmatched", receivedUnit: "  ") // blank unit
        _ = try seedReceivingRow(writeDB, item: "not attempted", matchStatus: nil)                        // NULL match_status
        _ = try seedReceivingRow(writeDB, item: "other loc", matchStatus: "unmatched", locationId: "downtown")

        let queue = try await repo.loadUnmatched(locationId: "default")
        // created_at DESC, id DESC — the later ambiguous row first.
        XCTAssertEqual(queue.map(\.id), [ambiguousId, unmatchedId])
    }

    func testLoadUnmatchedCapsAt100() async throws {
        let (readDB, writeDB, path) = try makeMatchRepos(); defer { cleanupMatchFixture(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        for i in 0..<105 {
            _ = try seedReceivingRow(writeDB, item: "case \(i)", matchStatus: "unmatched")
        }
        let queue = try await repo.loadUnmatched(locationId: "default")
        XCTAssertEqual(queue.count, 100, "page query LIMIT 100")
    }

    // ── masterOptions ───────────────────────────────────────────────────

    func testMasterOptionsSortedByCanonicalNameCaseInsensitive() async throws {
        let (readDB, writeDB, path) = try makeMatchRepos(); defer { cleanupMatchFixture(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        try seedMaster(writeDB, "zeta_sauce", name: "zeta sauce")
        try seedMaster(writeDB, "alpha_butter", name: "Alpha Butter")
        let options = try await repo.masterOptions()
        XCTAssertEqual(options.map(\.masterId), ["alpha_butter", "zeta_sauce"])
        XCTAssertEqual(options.map(\.canonicalName), ["Alpha Butter", "zeta sauce"])
    }

    // ── resolveMatch — happy paths ──────────────────────────────────────

    func testResolveInsertsFreshCreditWhenNoneExists() async throws {
        let (readDB, writeDB, path) = try makeMatchRepos(); defer { cleanupMatchFixture(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        try seedMaster(writeDB, "heirloom_tomato_case", name: "Heirloom Tomato Case")
        let rowId = try seedReceivingRow(writeDB, item: "heirloom tomato case", matchStatus: "unmatched", receivedQty: 2, receivedUnit: "case")

        let result = try repo.resolveMatch(id: rowId, masterId: "heirloom_tomato_case", cookId: "maria", context: ctx)

        // receiving_log re-pointed exactly like the web UPDATE.
        XCTAssertEqual(result.receiving.masterId, "heirloom_tomato_case")
        XCTAssertEqual(result.receiving.matchStatus, "matched")
        XCTAssertEqual(result.receiving.matchReason, "manager_selected")

        // Fresh closed-loop credit (web INSERT branch).
        XCTAssertEqual(result.inventoryUpdate.item, "heirloom tomato case")
        XCTAssertEqual(result.inventoryUpdate.masterId, "heirloom_tomato_case")
        XCTAssertEqual(result.inventoryUpdate.delta, "2 case")
        XCTAssertEqual(result.inventoryUpdate.direction, "in")
        XCTAssertEqual(result.inventoryUpdate.cookId, "maria")
        XCTAssertEqual(result.inventoryUpdate.receivingLogId, rowId)
        XCTAssertEqual(result.inventoryUpdate.note, "manager matched receiving_log #\(rowId)")

        try await writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM inventory_updates"), 1)

            // BOTH audit rows, same transaction, web payload/actor shapes.
            let recvAudit = try Row.fetchOne(
                db, sql: "SELECT action, actor_cook_id, actor_source, note, payload_json FROM audit_events WHERE entity = 'receiving_log' AND entity_id = ?",
                arguments: [rowId]
            )!
            XCTAssertEqual(recvAudit["action"] as String, "correction")
            XCTAssertEqual(recvAudit["actor_cook_id"] as String?, "maria")
            XCTAssertEqual(recvAudit["actor_source"] as String, RegulatedWriteContext.nativeMacActorSource)
            XCTAssertEqual(recvAudit["note"] as String?, "receiving_match:\(rowId)")
            let recvPayload: String = recvAudit["payload_json"]
            XCTAssertTrue(recvPayload.contains("\"before\""))
            XCTAssertTrue(recvPayload.contains("\"after\""))
            XCTAssertTrue(recvPayload.contains("\"match_status\":\"matched\""))

            let invAudit = try Row.fetchOne(
                db, sql: "SELECT action, actor_source, note FROM audit_events WHERE entity = 'inventory_updates'"
            )!
            XCTAssertEqual(invAudit["action"] as String, "insert")
            XCTAssertEqual(invAudit["actor_source"] as String, "receiving_match_resolution")
            XCTAssertEqual(invAudit["note"] as String?, "receiving_match:\(rowId)")
        }

        // The row leaves the manager queue.
        let queue = try await repo.loadUnmatched(locationId: "default")
        XCTAssertTrue(queue.isEmpty)
    }

    func testResolveRepointsExistingCreditInsteadOfDoubleCrediting() throws {
        let (readDB, writeDB, path) = try makeMatchRepos(); defer { cleanupMatchFixture(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        try seedMaster(writeDB, "right_master", name: "Right Master")
        let rowId = try seedReceivingRow(writeDB, item: "milk 2%", matchStatus: "ambiguous", receivedQty: 6, receivedUnit: "gal")
        // An inventory credit already exists for this receiving row (e.g. from
        // an earlier closed-loop attempt) — resolution must UPDATE its master,
        // never insert a second credit.
        let creditId: Int64 = try writeDB.pool.write { db in
            try db.execute(
                sql: """
                  INSERT INTO inventory_updates (shift_date, location_id, item, master_id, delta, direction, note, cook_id, receiving_log_id)
                  VALUES (date('now'), 'default', 'milk 2%', NULL, '6 gal', 'in', 'closed-loop', NULL, ?)
                  """,
                arguments: [rowId]
            )
            return db.lastInsertedRowID
        }

        let result = try repo.resolveMatch(id: rowId, masterId: "right_master", context: ctx)
        XCTAssertEqual(result.inventoryUpdate.id, creditId, "existing credit is re-pointed, not duplicated")
        XCTAssertEqual(result.inventoryUpdate.masterId, "right_master")

        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM inventory_updates"), 1)
            let invAudit = try Row.fetchOne(
                db, sql: "SELECT action, actor_source, payload_json FROM audit_events WHERE entity = 'inventory_updates' AND entity_id = ?",
                arguments: [creditId]
            )!
            XCTAssertEqual(invAudit["action"] as String, "correction", "existing-credit branch audits a correction")
            XCTAssertEqual(invAudit["actor_source"] as String, "receiving_match_resolution")
            let payload: String = invAudit["payload_json"]
            XCTAssertTrue(payload.contains("\"before\""))
            XCTAssertTrue(payload.contains("\"receiving_log_id\":\(rowId)"))
        }
    }

    func testResolveDeltaRendersFractionalQtyLikeWeb() throws {
        let (readDB, writeDB, path) = try makeMatchRepos(); defer { cleanupMatchFixture(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        try seedMaster(writeDB, "butter_case", name: "Butter Case")
        let rowId = try seedReceivingRow(writeDB, item: "butter", matchStatus: "unmatched", receivedQty: 2.5, receivedUnit: "case")
        let result = try repo.resolveMatch(id: rowId, masterId: "butter_case", context: ctx)
        XCTAssertEqual(result.inventoryUpdate.delta, "2.5 case", "JS `${qty} ${unit}` renders 2.5 without trailing zeros")
    }

    // ── resolveMatch — validation ladder (400 / 404 / 409) ──────────────

    func testResolveRejectsBadIdAndMissingMasterBeforeAnyWrite() throws {
        let (readDB, writeDB, path) = try makeMatchRepos(); defer { cleanupMatchFixture(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.resolveMatch(id: 0, masterId: "m", context: ctx)) { error in
            XCTAssertEqual(error as? ReceivingMatchError, .validation("receiving id required"))
        }
        XCTAssertThrowsError(try repo.resolveMatch(id: 1, masterId: "   ", context: ctx)) { error in
            XCTAssertEqual(error as? ReceivingMatchError, .validation("master_id required"))
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events"), 0)
        }
    }

    func testResolveUnknownRowIs404() throws {
        let (readDB, writeDB, path) = try makeMatchRepos(); defer { cleanupMatchFixture(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        try seedMaster(writeDB, "m1", name: "M1")
        XCTAssertThrowsError(try repo.resolveMatch(id: 999, masterId: "m1", context: ctx)) { error in
            XCTAssertEqual(error as? ReceivingMatchError, .notFound("receiving row not found"))
        }
    }

    func testResolveWrongLocationIs404() throws {
        let (readDB, writeDB, path) = try makeMatchRepos(); defer { cleanupMatchFixture(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        try seedMaster(writeDB, "m1", name: "M1")
        let rowId = try seedReceivingRow(writeDB, item: "x", matchStatus: "unmatched", locationId: "downtown")
        XCTAssertThrowsError(try repo.resolveMatch(id: rowId, masterId: "m1", context: ctx)) { error in
            XCTAssertEqual(error as? ReceivingMatchError, .notFound("receiving row not found"))
        }
    }

    func testResolveUnknownMasterIs404AndWritesNothing() throws {
        let (readDB, writeDB, path) = try makeMatchRepos(); defer { cleanupMatchFixture(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        let rowId = try seedReceivingRow(writeDB, item: "x", matchStatus: "unmatched")
        XCTAssertThrowsError(try repo.resolveMatch(id: rowId, masterId: "ghost_master", context: ctx)) { error in
            XCTAssertEqual(error as? ReceivingMatchError, .notFound("master not found"))
        }
        try writeDB.pool.read { db in
            let status = try String.fetchOne(db, sql: "SELECT match_status FROM receiving_log WHERE id = ?", arguments: [rowId])
            XCTAssertEqual(status, "unmatched", "row must be untouched")
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events"), 0)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM inventory_updates"), 0)
        }
    }

    func testResolveRejectedDeliveryIs409() throws {
        let (readDB, writeDB, path) = try makeMatchRepos(); defer { cleanupMatchFixture(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        try seedMaster(writeDB, "m1", name: "M1")
        let rowId = try seedReceivingRow(writeDB, item: "bad milk", status: "rejected", matchStatus: "unmatched")
        XCTAssertThrowsError(try repo.resolveMatch(id: rowId, masterId: "m1", context: ctx)) { error in
            XCTAssertEqual(error as? ReceivingMatchError, .conflict("rejected deliveries cannot add stock"))
        }
    }

    func testResolveWithoutStockCountIs409() throws {
        let (readDB, writeDB, path) = try makeMatchRepos(); defer { cleanupMatchFixture(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        try seedMaster(writeDB, "m1", name: "M1")
        // qty NULL / qty 0 / blank unit / NULL item — all 409 per route L79-81.
        let noQty = try seedReceivingRow(writeDB, item: "a", matchStatus: "unmatched", receivedQty: nil)
        let zeroQty = try seedReceivingRow(writeDB, item: "b", matchStatus: "unmatched", receivedQty: 0)
        let blankUnit = try seedReceivingRow(writeDB, item: "c", matchStatus: "unmatched", receivedUnit: " ")
        let noItem = try seedReceivingRow(writeDB, item: nil, matchStatus: "unmatched")
        for rowId in [noQty, zeroQty, blankUnit, noItem] {
            XCTAssertThrowsError(try repo.resolveMatch(id: rowId, masterId: "m1", context: ctx)) { error in
                XCTAssertEqual(error as? ReceivingMatchError, .conflict("delivery has no stock count to add"), "row \(rowId)")
            }
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events"), 0)
        }
    }

    // ── atomicity ───────────────────────────────────────────────────────

    func testForcedCreditFailureRollsBackTheWholeResolution() throws {
        let (readDB, writeDB, path) = try makeMatchRepos(); defer { cleanupMatchFixture(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        try seedMaster(writeDB, "m1", name: "M1")
        let rowId = try seedReceivingRow(writeDB, item: "forced rollback", matchStatus: "unmatched")

        try writeDB.pool.write { db in
            try db.execute(sql: """
                CREATE TEMP TRIGGER fail_match_credit
                BEFORE INSERT ON inventory_updates
                WHEN NEW.item = 'forced rollback'
                BEGIN
                  SELECT RAISE(ABORT, 'forced credit failure');
                END;
                """)
        }
        defer { try? writeDB.pool.write { db in try db.execute(sql: "DROP TRIGGER IF EXISTS fail_match_credit") } }

        XCTAssertThrowsError(try repo.resolveMatch(id: rowId, masterId: "m1", context: ctx))
        try writeDB.pool.read { db in
            let status = try String.fetchOne(db, sql: "SELECT match_status FROM receiving_log WHERE id = ?", arguments: [rowId])
            XCTAssertEqual(status, "unmatched", "the receiving UPDATE must roll back with the failed credit")
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events"), 0, "no audit rows survive the rollback")
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM inventory_updates"), 0)
        }
    }

    // ── fixture helpers ─────────────────────────────────────────────────

    @discardableResult
    private func seedReceivingRow(
        _ writeDB: LariatWriteDatabase,
        item: String?,
        status: String = "accepted",
        matchStatus: String?,
        receivedQty: Double? = 2,
        receivedUnit: String? = "case",
        locationId: String = "default",
        createdAt: String? = nil
    ) throws -> Int64 {
        try writeDB.pool.write { db in
            try db.execute(
                sql: """
                  INSERT INTO receiving_log
                    (shift_date, location_id, vendor, category, item, match_status,
                     received_qty, received_unit, status, created_at)
                  VALUES (date('now'), ?, 'Shamrock', 'produce', ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
                  """,
                arguments: [locationId, item, matchStatus, receivedQty, receivedUnit, status, createdAt]
            )
            return db.lastInsertedRowID
        }
    }

    private func seedMaster(_ writeDB: LariatWriteDatabase, _ masterId: String, name: String) throws {
        try writeDB.pool.write { db in
            try db.execute(
                sql: "INSERT INTO ingredient_masters (master_id, canonical_name, category, preferred_vendor) VALUES (?, ?, 'produce', 'shamrock')",
                arguments: [masterId, name]
            )
        }
    }
}

// ── fixture DB (the EXISTING web schema — no migrations) ────────────────────

private func seedMatchDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-matches-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path

    let dbQueue = try DatabaseQueue(path: path)
    try dbQueue.write { db in
        try db.execute(sql: """
            CREATE TABLE receiving_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              location_id TEXT DEFAULT 'default',
              vendor TEXT NOT NULL,
              invoice_ref TEXT,
              category TEXT NOT NULL,
              item TEXT,
              vendor_sku TEXT,
              master_id TEXT,
              match_status TEXT DEFAULT 'not_attempted',
              match_reason TEXT,
              reading_f REAL,
              required_max_f REAL,
              package_ok INTEGER,
              expiration_date TEXT,
              status TEXT NOT NULL
                CHECK(status IN ('accepted','rejected','accepted_with_note')),
              rejection_reason TEXT,
              shellstock_tag_ref TEXT,
              cook_id TEXT,
              received_qty REAL,
              received_unit TEXT,
              created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE inventory_updates (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              station_id TEXT,
              item TEXT NOT NULL,
              master_id TEXT,
              delta TEXT,
              direction TEXT,
              note TEXT,
              cook_id TEXT,
              created_at TEXT DEFAULT (datetime('now')),
              location_id TEXT DEFAULT 'default',
              receiving_log_id INTEGER REFERENCES receiving_log(id)
            );
            CREATE UNIQUE INDEX idx_inventory_updates_receiving_log_id
              ON inventory_updates(receiving_log_id)
              WHERE receiving_log_id IS NOT NULL;
            CREATE TABLE ingredient_masters (
              master_id TEXT PRIMARY KEY,
              canonical_name TEXT NOT NULL,
              category TEXT,
              preferred_vendor TEXT,
              quality_locked INTEGER NOT NULL DEFAULT 0,
              quality_lock_reason TEXT,
              last_reviewed TEXT
            );
            CREATE TABLE audit_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              entity TEXT NOT NULL,
              entity_id INTEGER,
              action TEXT NOT NULL,
              actor_cook_id TEXT,
              actor_source TEXT NOT NULL,
              replaces_id INTEGER,
              payload_json TEXT,
              note TEXT,
              shift_date TEXT,
              location_id TEXT,
              created_at TEXT DEFAULT (datetime('now'))
            );
            """)
    }
    return path
}

private func makeMatchRepos() throws -> (LariatDatabase, LariatWriteDatabase, String) {
    let path = try seedMatchDatabase()
    let readDB = try LariatDatabase(path: path)
    let writeDB = try LariatWriteDatabase(path: path)
    return (readDB, writeDB, path)
}

private func cleanupMatchFixture(_ path: String) {
    let dir = (path as NSString).deletingLastPathComponent
    try? FileManager.default.removeItem(atPath: dir)
}
