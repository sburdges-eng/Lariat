import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Behavior-parity port of `app/api/gold-stars/{route.ts,[id]/route.ts}`
/// against an on-disk temp GRDB fixture with the REAL gold_stars schema
/// (lib/db.ts ~L1750) + audit_events.
///
/// Web oracle: tests/js/test-gold-stars-api.mjs — every case ported:
///   - PIN'd award writes row + 1 audit row (the un-PIN'd 401 case is the
///     app-layer PinEntrySheet gate natively; the repository itself always
///     runs post-gate, mirroring the route body after `requirePin`)
///   - board shows today's stars only, hides yesterday's + soft-deleted
///   - leaderboard aggregates all-time, tie → name ASC, carries
///     last_awarded, soft-deleted rows leave the record
/// Plus the [id]/route.ts DELETE contracts (authored against the route —
/// no web test covers DELETE): 404 for missing/wrong-location/already-
/// deleted (NO idempotency), soft delete + deleted_by='manager_pin',
/// audit 'delete' with the row snapshot payload.
///
/// actor_source: `native_mac` (program convention for PIN-gated writes;
/// web uses 'api' on insert / 'manager_pin' on delete — documented
/// divergence, pinned here).
final class GoldStarsRepositoryTests: XCTestCase {

    private func ctx(location: String = "default") -> RegulatedWriteContext {
        RegulatedWriteContext.nativeMac(
            pinUser: ManagerPinUser(id: 7, locationId: location, name: "Pat", role: "manager")
        )
    }

    // ── POST /api/gold-stars (award) ────────────────────────────────────

    func testAwardWritesRowAndAuditInOneTransaction() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }
        let id = try repo.award(cookName: "Alex", reason: "rush", stars: 2, context: ctx())
        XCTAssertGreaterThan(id, 0)
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM gold_stars") ?? 0, 1)
            let row = try Row.fetchOne(db, sql: "SELECT * FROM gold_stars WHERE id = ?", arguments: [id])!
            XCTAssertEqual(row["cook_name"], "Alex")
            XCTAssertEqual(row["reason"], "rush")
            XCTAssertEqual(row["stars"], 2)
            XCTAssertEqual(row["location_id"], "default")
            // test-gold-stars-api.mjs: 'accepts a PIN'd award and posts the audit row'.
            let audit = try Row.fetchOne(
                db,
                sql: "SELECT * FROM audit_events WHERE entity = 'gold_stars' AND entity_id = ?",
                arguments: [id]
            )
            XCTAssertNotNil(audit)
            XCTAssertEqual(audit?["action"], "insert")
            XCTAssertEqual(audit?["actor_source"], "native_mac")
            let payload: String? = audit?["payload_json"]
            XCTAssertTrue(payload?.contains("\"cook_name\"") == true)
            XCTAssertTrue(payload?.contains("Alex") == true)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='gold_stars'") ?? 0, 1)
        }
    }

    func testAwardRequiresCookAndReasonAndWritesNothing() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }
        XCTAssertThrowsError(try repo.award(cookName: "  ", reason: "rush", stars: 1, context: ctx())) {
            XCTAssertEqual($0 as? GoldStarWriteError, .cookAndReasonRequired)
        }
        XCTAssertThrowsError(try repo.award(cookName: "Alex", reason: "", stars: 1, context: ctx())) {
            XCTAssertEqual($0 as? GoldStarWriteError, .cookAndReasonRequired)
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM gold_stars") ?? -1, 0)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? -1, 0)
        }
    }

    func testAwardClampsStars() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }
        let big = try repo.award(cookName: "Alex", reason: "hero", stars: 9, context: ctx())
        let zero = try repo.award(cookName: "Blair", reason: "solid", stars: 0, context: ctx())
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT stars FROM gold_stars WHERE id = ?", arguments: [big]), 3)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT stars FROM gold_stars WHERE id = ?", arguments: [zero]), 1)
        }
    }

    // ── GET /api/gold-stars — daily board reset ─────────────────────────

    func testBoardShowsTodayAndHidesYesterday() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }
        // Seed in UTC exactly like the web test (column defaults are UTC;
        // the board query re-applies 'localtime').
        try seedStar(writeDB, cook: "Alex", stars: 2, daysAgo: 0)
        try seedStar(writeDB, cook: "Blair", stars: 3, daysAgo: 1)
        try seedStar(writeDB, cook: "Casey", stars: 1, daysAgo: 7)

        let rows = try await repo.board(locationId: "default")
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows.first?.cookName, "Alex")
    }

    func testBoardExcludesSoftDeletedRows() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }
        try seedStar(writeDB, cook: "Alex", stars: 2, daysAgo: 0)
        _ = try writeDB.write { db in
            try db.execute(sql: "UPDATE gold_stars SET deleted_at = datetime('now')")
        }
        let rows = try await repo.board(locationId: "default")
        XCTAssertEqual(rows.count, 0)
    }

    func testBoardOrdersByIdDescAndCaps50() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }
        for i in 1...55 {
            try seedStar(writeDB, cook: "Cook\(i)", stars: 1, daysAgo: 0)
        }
        let rows = try await repo.board(locationId: "default")
        XCTAssertEqual(rows.count, 50)                       // LIMIT 50
        XCTAssertEqual(rows.first?.cookName, "Cook55")       // ORDER BY id DESC
    }

    func testBoardIsLocationScoped() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }
        try seedStar(writeDB, cook: "Alex", stars: 2, daysAgo: 0, location: "south")
        let rows = try await repo.board(locationId: "default")
        XCTAssertEqual(rows.count, 0)
        let south = try await repo.board(locationId: "south")
        XCTAssertEqual(south.count, 1)
    }

    // ── GET ?view=leaderboard — permanent per-employee record ───────────

    func testLeaderboardAggregatesAllTimeAndBreaksTiesByName() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }
        try seedStar(writeDB, cook: "Alex", stars: 2, daysAgo: 0)    // today
        try seedStar(writeDB, cook: "Alex", stars: 1, daysAgo: 30)   // a month ago
        try seedStar(writeDB, cook: "Blair", stars: 3, daysAgo: 1)   // yesterday

        let rows = try await repo.leaderboard(locationId: "default")
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(
            rows.map { [$0.cookName, String($0.totalStars), String($0.awards)] },
            [["Alex", "3", "2"], ["Blair", "3", "1"]],       // tie broken by name ASC
            "aggregates all-time per cook, surviving the daily reset"
        )
        XCTAssertNotNil(rows.first?.lastAwarded, "leaderboard carries the last award date")
    }

    func testLeaderboardExcludesSoftDeletedStars() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }
        try seedStar(writeDB, cook: "Alex", stars: 2, daysAgo: 5)
        _ = try writeDB.write { db in
            try db.execute(sql: "UPDATE gold_stars SET deleted_at = datetime('now')")
        }
        let rows = try await repo.leaderboard(locationId: "default")
        XCTAssertEqual(rows.count, 0, "soft-deleted stars leave the record too")
    }

    // ── DELETE /api/gold-stars/[id] ─────────────────────────────────────

    func testRemoveSoftDeletesAndAudits() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }
        let id = try repo.award(cookName: "Alex", reason: "rush", stars: 2, context: ctx())
        try repo.remove(id: id, context: ctx())
        try writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM gold_stars WHERE id = ?", arguments: [id])!
            XCTAssertNotNil(row["deleted_at"] as String?, "soft delete — never a hard DELETE")
            XCTAssertEqual(row["deleted_by"], "manager_pin")      // web column literal
            let audit = try Row.fetchOne(
                db,
                sql: "SELECT * FROM audit_events WHERE entity='gold_stars' AND entity_id=? AND action='delete'",
                arguments: [id]
            )
            XCTAssertNotNil(audit)
            XCTAssertEqual(audit?["actor_source"], "native_mac")
            let payload: String? = audit?["payload_json"]
            XCTAssertTrue(payload?.contains("\"reason\"") == true)
            XCTAssertTrue(payload?.contains("\"awarded_date\"") == true)
        }
    }

    func testRemoveMissingOrWrongLocationIsNotFound() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }
        XCTAssertThrowsError(try repo.remove(id: 999, context: ctx())) {
            XCTAssertEqual($0 as? GoldStarWriteError, .notFound)
        }
        let id = try repo.award(cookName: "Alex", reason: "rush", stars: 2, context: ctx())
        XCTAssertThrowsError(try repo.remove(id: id, context: ctx(location: "south"))) {
            XCTAssertEqual($0 as? GoldStarWriteError, .notFound)
        }
        try writeDB.pool.read { db in
            XCTAssertNil(
                try String.fetchOne(db, sql: "SELECT deleted_at FROM gold_stars WHERE id = ?", arguments: [id]) ?? nil,
                "wrong-location delete must not touch the row"
            )
        }
    }

    func testRemoveInvalidIdThrowsBeforeAnyWrite() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }
        XCTAssertThrowsError(try repo.remove(id: 0, context: ctx())) {
            XCTAssertEqual($0 as? GoldStarWriteError, .invalidId)
        }
        XCTAssertThrowsError(try repo.remove(id: -5, context: ctx())) {
            XCTAssertEqual($0 as? GoldStarWriteError, .invalidId)
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? -1, 0)
        }
    }

    func testSecondRemoveIsNotFoundNoIdempotency() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }
        let id = try repo.award(cookName: "Alex", reason: "rush", stars: 2, context: ctx())
        try repo.remove(id: id, context: ctx())
        // Divergence assert: no idempotency layer — the web route 404s a
        // second delete (`if (!row || row.deleted_at) return 404`).
        XCTAssertThrowsError(try repo.remove(id: id, context: ctx())) {
            XCTAssertEqual($0 as? GoldStarWriteError, .notFound)
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(
                try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE action='delete'") ?? -1, 1,
                "second delete must not post a second audit row"
            )
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private func makeRepo() throws -> (GoldStarsRepository, LariatWriteDatabase, String) {
        let path = try seedGoldStarsDatabase()
        let readDB = try LariatDatabase(path: path)
        let writeDB = try LariatWriteDatabase(path: path)
        return (GoldStarsRepository(readDB: readDB, writeDB: writeDB), writeDB, path)
    }

    private func cleanup(path: String) {
        try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent)
    }

    /// Mirrors the web test's `seedStar`: awarded_date/created_at stored in
    /// UTC (the column defaults are UTC; the board query re-applies
    /// 'localtime', so seeding localtime here would double-convert).
    private func seedStar(
        _ writeDB: LariatWriteDatabase, cook: String, stars: Int, daysAgo: Int,
        location: String = "default"
    ) throws {
        _ = try writeDB.write { db in
            try db.execute(
                sql: """
                  INSERT INTO gold_stars (cook_name, reason, stars, location_id, awarded_date, created_at)
                  VALUES (?, 'seed', ?, ?, date('now', ?), datetime('now', ?))
                  """,
                arguments: [cook, stars, location, "-\(daysAgo) days", "-\(daysAgo) days"]
            )
        }
    }
}

/// Real web schema (lib/db.ts ~L1750) + audit_events.
private func seedGoldStarsDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-gold-stars-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path
    let dbQueue = try DatabasePool(path: path)
    try dbQueue.write { db in
        try db.execute(sql: """
            CREATE TABLE gold_stars (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              cook_name TEXT NOT NULL,
              reason TEXT NOT NULL,
              stars INTEGER DEFAULT 1,
              awarded_date TEXT DEFAULT (date('now')),
              location_id TEXT DEFAULT 'default',
              created_at TEXT DEFAULT (datetime('now')),
              deleted_at TEXT,
              deleted_by TEXT
            );
            CREATE TABLE audit_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              entity TEXT NOT NULL, entity_id INTEGER, action TEXT NOT NULL,
              actor_cook_id TEXT, actor_source TEXT NOT NULL, replaces_id INTEGER,
              payload_json TEXT, note TEXT, shift_date TEXT, location_id TEXT,
              created_at TEXT DEFAULT (datetime('now'))
            );
            """)
    }
    return path
}
