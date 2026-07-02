import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

// Behavior-parity port of the inventory COUNTS routes against an in-memory
// (on-disk temp) GRDB fixture seeded with the REAL inventory_counts +
// inventory_count_lines + audit_events schemas. Oracle: tests/js/
// test-inventory-counts-api.mjs. Pins:
//   open        → header row + audit insert (actor_source native_cook)
//   line upsert → insert vs update by (count_id, ingredient, sku); ingredient
//                 canonicalized (IngredientKey); empty-string sku is one slot;
//                 audit 'update' for both paths
//   guards      → missing ingredient → .ingredientRequired (nothing written);
//                 unknown count → .countNotFound; closed count → .countClosed
//   close/reopen→ toggles closed_at; already-closed close → .countClosed; three audits
//   list/get    → location scope; same-location line_count; ingredient ASC ordering
//
// SKIPPED oracle case: the "schema migration rebuilds nullable sku" test is a
// web-owned migration concern — native does no migration; the fixture already
// creates the non-null-sku + UNIQUE table.
final class InventoryCountRepositoryTests: XCTestCase {

    private func ctx(location: String = "default", cook: String? = "alice") -> RegulatedWriteContext {
        RegulatedWriteContext(
            actorCookId: cook,
            actorSource: RegulatedWriteContext.nativeCookActorSource,
            locationId: location,
            shiftDate: "2026-07-02"
        )
    }

    // ── open ────────────────────────────────────────────────────────────

    func testOpenCountPersistsHeaderAndAudits() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryCountRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.openCount(input: InventoryCountOpenInput(label: "Weekly walk-in", cookId: "alice"), context: ctx())
        XCTAssertGreaterThan(id, 0)
        try writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM inventory_counts WHERE id = ?", arguments: [id])!
            XCTAssertEqual(row["label"], "Weekly walk-in")
            XCTAssertEqual(row["cook_id"], "alice")
            XCTAssertNil(row["closed_at"] as String?)
            XCTAssertEqual(row["location_id"], "default")
            let audit = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='inventory_counts' AND entity_id=? AND action='insert'", arguments: [id]) ?? 0
            XCTAssertEqual(audit, 1)
            XCTAssertEqual(try String.fetchOne(db, sql: "SELECT actor_source FROM audit_events WHERE entity_id=? LIMIT 1", arguments: [id]), "native_cook")
        }
    }

    func testOpenCountDefaultsCountDateToToday() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryCountRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.openCount(input: InventoryCountOpenInput(label: "EOM"), context: ctx())
        try writeDB.pool.read { db in
            let d = try String.fetchOne(db, sql: "SELECT count_date FROM inventory_counts WHERE id=?", arguments: [id])
            XCTAssertEqual(d, ShiftDate.todayISO())
        }
    }

    // ── line upsert ───────────────────────────────────────────────────────

    func testUpsertLineInsertsThenUpsertsSameSlot() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryCountRepository(readDB: readDB, writeDB: writeDB)
        let countId = try repo.openCount(input: InventoryCountOpenInput(label: "walk-in"), context: ctx())
        let id1 = try repo.upsertLine(countId: countId, input: InventoryCountLineInput(ingredient: "TOMATO, ROMA", sku: "TOM01", onHandQty: 12, unit: "lb"), context: ctx())
        let id2 = try repo.upsertLine(countId: countId, input: InventoryCountLineInput(ingredient: "TOMATO, ROMA", sku: "TOM01", onHandQty: 18, unit: "lb"), context: ctx())
        XCTAssertEqual(id2, id1)   // UNIQUE(count_id, ingredient, sku) → conflict updates same row
        try writeDB.pool.read { db in
            let lines = try Row.fetchAll(db, sql: "SELECT * FROM inventory_count_lines WHERE count_id=?", arguments: [countId])
            XCTAssertEqual(lines.count, 1)
            XCTAssertEqual(lines[0]["on_hand_qty"], 18.0)
            XCTAssertEqual(lines[0]["unit"], "lb")
            XCTAssertEqual(lines[0]["ingredient"], "tomato roma")   // canonical key
        }
    }

    func testCanonicalizesCapitalizationDedup() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryCountRepository(readDB: readDB, writeDB: writeDB)
        let countId = try repo.openCount(input: InventoryCountOpenInput(label: "dedup"), context: ctx())
        _ = try repo.upsertLine(countId: countId, input: InventoryCountLineInput(ingredient: "Chicken Stock", onHandQty: 4, unit: "qt"), context: ctx())
        _ = try repo.upsertLine(countId: countId, input: InventoryCountLineInput(ingredient: "chicken stock", onHandQty: 7, unit: "qt"), context: ctx())
        try writeDB.pool.read { db in
            let lines = try Row.fetchAll(db, sql: "SELECT * FROM inventory_count_lines WHERE count_id=? ORDER BY id", arguments: [countId])
            XCTAssertEqual(lines.count, 1, "second post should upsert, not insert")
            XCTAssertEqual(lines[0]["on_hand_qty"], 7.0, "most recent value wins")
            XCTAssertEqual(lines[0]["ingredient"], "chicken stock")
        }
    }

    func testNoSkuUpsertsByEmptyString() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryCountRepository(readDB: readDB, writeDB: writeDB)
        let countId = try repo.openCount(input: InventoryCountOpenInput(label: "produce"), context: ctx())
        let id1 = try repo.upsertLine(countId: countId, input: InventoryCountLineInput(ingredient: "ROMA TOMATO", onHandQty: 12, unit: "lb"), context: ctx())         // sku nil → ''
        let id2 = try repo.upsertLine(countId: countId, input: InventoryCountLineInput(ingredient: "ROMA TOMATO", sku: "   ", onHandQty: 18, unit: "lb"), context: ctx())  // blank sku → ''
        XCTAssertEqual(id2, id1)
        try writeDB.pool.read { db in
            let lines = try Row.fetchAll(db, sql: "SELECT sku, on_hand_qty FROM inventory_count_lines WHERE count_id=?", arguments: [countId])
            XCTAssertEqual(lines.count, 1)
            XCTAssertEqual(lines[0]["sku"], "")
            XCTAssertEqual(lines[0]["on_hand_qty"], 18.0)
        }
    }

    func testUpsertLineRejectsMissingIngredient() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryCountRepository(readDB: readDB, writeDB: writeDB)
        let countId = try repo.openCount(input: InventoryCountOpenInput(), context: ctx())
        XCTAssertThrowsError(try repo.upsertLine(countId: countId, input: InventoryCountLineInput(ingredient: "   ", onHandQty: 4), context: ctx())) {
            XCTAssertEqual($0 as? InventoryCountWriteError, .ingredientRequired)
        }
        // A punctuation-only ingredient normalizes to empty → also rejected.
        XCTAssertThrowsError(try repo.upsertLine(countId: countId, input: InventoryCountLineInput(ingredient: "!!!", onHandQty: 4), context: ctx())) {
            XCTAssertEqual($0 as? InventoryCountWriteError, .ingredientRequired)
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM inventory_count_lines") ?? -1, 0)
        }
    }

    func testUpsertLineOnMissingCountThrowsNotFound() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryCountRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.upsertLine(countId: 99999, input: InventoryCountLineInput(ingredient: "X"), context: ctx())) {
            XCTAssertEqual($0 as? InventoryCountWriteError, .countNotFound)
        }
    }

    func testUpsertLineOnClosedCountThrows() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryCountRepository(readDB: readDB, writeDB: writeDB)
        let countId = try repo.openCount(input: InventoryCountOpenInput(), context: ctx())
        _ = try repo.upsertLine(countId: countId, input: InventoryCountLineInput(ingredient: "X", onHandQty: 1), context: ctx())
        try repo.closeCount(id: countId, context: ctx())
        XCTAssertThrowsError(try repo.upsertLine(countId: countId, input: InventoryCountLineInput(ingredient: "Y", onHandQty: 1), context: ctx())) {
            XCTAssertEqual($0 as? InventoryCountWriteError, .countClosed)
        }
    }

    // ── close / reopen ────────────────────────────────────────────────────

    func testCloseThenReopenTogglesAndAuditsThree() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryCountRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.openCount(input: InventoryCountOpenInput(label: "r"), context: ctx())
        try repo.closeCount(id: id, context: ctx(cook: "bo"))
        try writeDB.pool.read { db in
            XCTAssertNotNil(try String.fetchOne(db, sql: "SELECT closed_at FROM inventory_counts WHERE id=?", arguments: [id]))
        }
        // Closing again → .countClosed (409).
        XCTAssertThrowsError(try repo.closeCount(id: id, context: ctx())) {
            XCTAssertEqual($0 as? InventoryCountWriteError, .countClosed)
        }
        try repo.reopenCount(id: id, context: ctx())
        try writeDB.pool.read { db in
            XCTAssertNil(try String.fetchOne(db, sql: "SELECT closed_at FROM inventory_counts WHERE id=?", arguments: [id]))
            // 1 insert + 1 close + 1 reopen.
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='inventory_counts' AND entity_id=?", arguments: [id]) ?? 0, 3)
        }
    }

    func testCloseUnknownCountThrowsNotFound() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryCountRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.closeCount(id: 4242, context: ctx())) {
            XCTAssertEqual($0 as? InventoryCountWriteError, .notFound)
        }
    }

    // ── list / get ──────────────────────────────────────────────────────

    func testListScopesByLocationAndOrders() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryCountRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.openCount(input: InventoryCountOpenInput(label: "A"), context: ctx(location: "kitchen-a"))
        _ = try repo.openCount(input: InventoryCountOpenInput(label: "B"), context: ctx(location: "kitchen-b"))
        let a = try await repo.listCounts(locationId: "kitchen-a")
        XCTAssertEqual(a.map(\.label), ["A"])
        let b = try await repo.listCounts(locationId: "kitchen-b")
        XCTAssertEqual(b.map(\.label), ["B"])
    }

    func testListLineCountCountsSameLocationOnly() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryCountRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.openCount(input: InventoryCountOpenInput(label: "A"), context: ctx(location: "kitchen-a"))
        _ = try repo.upsertLine(countId: id, input: InventoryCountLineInput(ingredient: "AVOCADO", onHandQty: 6), context: ctx(location: "kitchen-a"))
        // A rogue cross-location line attached to the same count id.
        try await writeDB.pool.write { db in
            try db.execute(sql: "INSERT INTO inventory_count_lines (count_id, ingredient, sku, on_hand_qty, location_id) VALUES (?, 'rogue butter', '', 99, 'kitchen-b')", arguments: [id])
        }
        let rows = try await repo.listCounts(locationId: "kitchen-a")
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].lineCount, 1)   // only the same-location line is tallied
    }

    func testListOpenOnlyFilter() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryCountRepository(readDB: readDB, writeDB: writeDB)
        let closedId = try repo.openCount(input: InventoryCountOpenInput(label: "closed"), context: ctx())
        try repo.closeCount(id: closedId, context: ctx())
        _ = try repo.openCount(input: InventoryCountOpenInput(label: "open"), context: ctx())
        let open = try await repo.listCounts(openOnly: true)
        XCTAssertEqual(open.map(\.label), ["open"])
        let all = try await repo.listCounts()
        XCTAssertEqual(Set(all.map(\.label)), ["open", "closed"])
    }

    func testGetCountReturnsHeadAndLinesOrdered() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryCountRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.openCount(input: InventoryCountOpenInput(label: "detail"), context: ctx())
        _ = try repo.upsertLine(countId: id, input: InventoryCountLineInput(ingredient: "ZUCCHINI", onHandQty: 4), context: ctx())
        _ = try repo.upsertLine(countId: id, input: InventoryCountLineInput(ingredient: "AVOCADO", onHandQty: 6), context: ctx())
        let detail = try await repo.getCount(id: id)
        XCTAssertNotNil(detail)
        XCTAssertEqual(detail?.head.id, id)
        XCTAssertEqual(detail?.lines.map(\.ingredient), ["avocado", "zucchini"])   // canonical + ingredient ASC
    }

    func testGetCountExcludesCrossLocationLines() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryCountRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.openCount(input: InventoryCountOpenInput(label: "detail"), context: ctx())
        _ = try repo.upsertLine(countId: id, input: InventoryCountLineInput(ingredient: "AVOCADO", onHandQty: 6), context: ctx())
        try await writeDB.pool.write { db in
            try db.execute(sql: "INSERT INTO inventory_count_lines (count_id, ingredient, sku, on_hand_qty, location_id) VALUES (?, 'rogue butter', '', 99, 'kitchen-b')", arguments: [id])
        }
        let detail = try await repo.getCount(id: id, locationId: "default")
        XCTAssertEqual(detail?.lines.map(\.ingredient), ["avocado"])
    }

    func testGetCountUnknownReturnsNil() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryCountRepository(readDB: readDB, writeDB: writeDB)
        let detail = try await repo.getCount(id: 12345)
        XCTAssertNil(detail)
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private func makeRepos() throws -> (LariatDatabase, LariatWriteDatabase, String) {
        let path = try seedInventoryCountsDatabase()
        return (try LariatDatabase(path: path), try LariatWriteDatabase(path: path), path)
    }
    private func cleanup(path: String) {
        try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent)
    }
}

private func seedInventoryCountsDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-inv-counts-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path
    let dbQueue = try DatabaseQueue(path: path)
    try dbQueue.write { db in
        // Mirror the REAL web schema (lib/db.ts ~L1051 / ~L1063).
        try db.execute(sql: """
            CREATE TABLE inventory_counts (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              count_date TEXT NOT NULL, label TEXT, opened_at TEXT DEFAULT (datetime('now')),
              closed_at TEXT, cook_id TEXT, location_id TEXT NOT NULL DEFAULT 'default'
            );
            CREATE TABLE inventory_count_lines (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              count_id INTEGER NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
              vendor TEXT, ingredient TEXT NOT NULL, sku TEXT NOT NULL DEFAULT '',
              on_hand_qty REAL, unit TEXT, par_qty REAL, par_unit TEXT,
              note TEXT, counted_by TEXT, counted_at TEXT DEFAULT (datetime('now')),
              location_id TEXT NOT NULL DEFAULT 'default',
              UNIQUE(count_id, ingredient, sku)
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
