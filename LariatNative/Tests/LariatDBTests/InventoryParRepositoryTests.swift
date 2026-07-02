import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

// Behavior-parity port of `app/api/inventory/par/route.js` against an in-memory
// (on-disk temp) GRDB fixture seeded with the REAL inventory_par +
// inventory_count_lines + audit_events schemas. Pins:
//   upsert  → insert vs update by (location, ingredient, sku); empty-string sku
//             is one slot; audit insert/update (actor_source native_cook)
//   missing ingredient → .ingredientRequired, nothing written
//   GET     → location scope + category filter + category,ingredient ordering
//   delete  → removes + audits; wrong-location → .notFound, row stays
//   on-hand → LEFT JOIN to latest count line flags below-par; never-counted = not low
final class InventoryParRepositoryTests: XCTestCase {

    private func ctx(location: String = "default", cook: String? = "alice") -> RegulatedWriteContext {
        RegulatedWriteContext(
            actorCookId: cook,
            actorSource: RegulatedWriteContext.nativeCookActorSource,
            locationId: location,
            shiftDate: "2026-07-02"
        )
    }

    // ── upsert ──────────────────────────────────────────────────────────

    func testUpsertInsertsAndAudits() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryParRepository(readDB: readDB, writeDB: writeDB)
        let r = try repo.upsert(
            input: InventoryParUpsertInput(ingredient: "TOMATO, ROMA", sku: "TOM01", vendor: "Shamrock", parQty: 30, parUnit: "lb", category: "Produce"),
            context: ctx()
        )
        XCTAssertTrue(r.isInsert)
        XCTAssertGreaterThan(r.id, 0)
        try writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM inventory_par WHERE id = ?", arguments: [r.id])!
            XCTAssertEqual(row["ingredient"], "TOMATO, ROMA")
            XCTAssertEqual(row["sku"], "TOM01")
            XCTAssertEqual(row["par_qty"], 30.0)
            XCTAssertEqual(row["category"], "Produce")
            let audit = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='inventory_par' AND entity_id=? AND action='insert'", arguments: [r.id]) ?? 0
            XCTAssertEqual(audit, 1)
            XCTAssertEqual(try String.fetchOne(db, sql: "SELECT actor_source FROM audit_events WHERE entity_id=? LIMIT 1", arguments: [r.id]), "native_cook")
        }
    }

    func testUpsertUpdatesSameSlot() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryParRepository(readDB: readDB, writeDB: writeDB)
        let first = try repo.upsert(input: InventoryParUpsertInput(ingredient: "AVOCADO", sku: "AVO", parQty: 12, parUnit: "ea"), context: ctx())
        let second = try repo.upsert(input: InventoryParUpsertInput(ingredient: "AVOCADO", sku: "AVO", parQty: 18, parUnit: "ea"), context: ctx())
        XCTAssertEqual(second.id, first.id)
        XCTAssertFalse(second.isInsert)
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM inventory_par WHERE ingredient='AVOCADO'") ?? 0, 1)
            XCTAssertEqual(try Double.fetchOne(db, sql: "SELECT par_qty FROM inventory_par WHERE id=?", arguments: [first.id]), 18.0)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity_id=? AND action='update'", arguments: [first.id]) ?? 0, 1)
        }
    }

    func testNullAndEmptySkuAreOneSlot() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryParRepository(readDB: readDB, writeDB: writeDB)
        let a = try repo.upsert(input: InventoryParUpsertInput(ingredient: "PARSLEY", parQty: 2), context: ctx())   // sku nil → ''
        let b = try repo.upsert(input: InventoryParUpsertInput(ingredient: "PARSLEY", sku: "", parQty: 4), context: ctx())
        XCTAssertEqual(b.id, a.id)
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM inventory_par WHERE ingredient='PARSLEY'") ?? 0, 1)
        }
    }

    func testUpsertRejectsMissingIngredient() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryParRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.upsert(input: InventoryParUpsertInput(ingredient: "  ", parQty: 1), context: ctx())) {
            XCTAssertEqual($0 as? InventoryParWriteError, .ingredientRequired)
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM inventory_par") ?? -1, 0)
        }
    }

    // ── GET ─────────────────────────────────────────────────────────────

    func testLoadScopesByLocationAndOrders() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryParRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.upsert(input: InventoryParUpsertInput(ingredient: "ZUCCHINI", parQty: 6, category: "Produce"), context: ctx(location: "kitchen-a"))
        _ = try repo.upsert(input: InventoryParUpsertInput(ingredient: "BUTTER", parQty: 4, category: "Dairy"), context: ctx(location: "kitchen-a"))
        _ = try repo.upsert(input: InventoryParUpsertInput(ingredient: "PORK CHOP", parQty: 10, category: "Protein"), context: ctx(location: "kitchen-b"))

        let a = try await repo.load(locationId: "kitchen-a")
        XCTAssertEqual(a.map(\.ingredient), ["BUTTER", "ZUCCHINI"])   // Dairy < Produce, then ingredient
        let b = try await repo.load(locationId: "kitchen-b")
        XCTAssertEqual(b.map(\.ingredient), ["PORK CHOP"])
    }

    func testLoadFiltersByCategory() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryParRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.upsert(input: InventoryParUpsertInput(ingredient: "BUTTER", category: "Dairy"), context: ctx())
        _ = try repo.upsert(input: InventoryParUpsertInput(ingredient: "CHEESE", category: "Dairy"), context: ctx())
        _ = try repo.upsert(input: InventoryParUpsertInput(ingredient: "KALE", category: "Produce"), context: ctx())
        let dairy = try await repo.load(category: "Dairy")
        XCTAssertEqual(dairy.count, 2)
        XCTAssertTrue(dairy.allSatisfy { $0.category == "Dairy" })
    }

    // ── delete ───────────────────────────────────────────────────────────

    func testDeleteRemovesAndAudits() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryParRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.upsert(input: InventoryParUpsertInput(ingredient: "CILANTRO", parQty: 3), context: ctx()).id
        try repo.delete(id: id, context: ctx())
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM inventory_par WHERE id=?", arguments: [id]) ?? -1, 0)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity_id=? AND action='delete'", arguments: [id]) ?? 0, 1)
        }
    }

    func testDeleteWrongLocationThrowsNotFoundAndKeepsRow() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryParRepository(readDB: readDB, writeDB: writeDB)
        let id = try repo.upsert(input: InventoryParUpsertInput(ingredient: "GINGER", parQty: 1), context: ctx(location: "kitchen-a")).id
        XCTAssertThrowsError(try repo.delete(id: id, context: ctx(location: "kitchen-b"))) {
            XCTAssertEqual($0 as? InventoryParWriteError, .notFound)
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM inventory_par WHERE id=?", arguments: [id]) ?? 0, 1)
        }
    }

    // ── on-hand LEFT JOIN + below-par flag ──────────────────────────────

    func testLoadWithLatestOnHandFlagsLow() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryParRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.upsert(input: InventoryParUpsertInput(ingredient: "ONION", sku: "ON1", parQty: 10, parUnit: "lb", category: "Produce"), context: ctx())
        _ = try repo.upsert(input: InventoryParUpsertInput(ingredient: "GARLIC", sku: "GAR", parQty: 5, category: "Produce"), context: ctx())  // never counted
        // Seed a count + a below-par count line for ONION (on_hand 4 < par 10).
        try await writeDB.pool.write { db in
            try db.execute(sql: "INSERT INTO inventory_counts (id, count_date, location_id) VALUES (1, '2026-07-02', 'default')")
            try db.execute(sql: "INSERT INTO inventory_count_lines (count_id, ingredient, sku, on_hand_qty, unit, location_id, counted_at) VALUES (1, 'ONION', 'ON1', 4, 'lb', 'default', '2026-07-02 09:00:00')")
        }
        let rows = try await repo.loadWithLatestOnHand(locationId: "default")
        let onion = rows.first { $0.par.ingredient == "ONION" }!
        XCTAssertEqual(onion.onHandQty, 4)
        XCTAssertTrue(onion.isLow)
        let garlic = rows.first { $0.par.ingredient == "GARLIC" }!
        XCTAssertNil(garlic.onHandQty)
        XCTAssertFalse(garlic.isLow)                                   // never counted → not low
        let low = try await repo.loadWithLatestOnHand(onlyLow: true, locationId: "default")
        XCTAssertEqual(low.map(\.par.ingredient), ["ONION"])
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private func makeRepos() throws -> (LariatDatabase, LariatWriteDatabase, String) {
        let path = try seedInventoryDatabase()
        return (try LariatDatabase(path: path), try LariatWriteDatabase(path: path), path)
    }
    private func cleanup(path: String) {
        try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent)
    }
}

private func seedInventoryDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-inv-par-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path
    let dbQueue = try DatabaseQueue(path: path)
    try dbQueue.write { db in
        // Mirror the REAL web schema (lib/db.ts ~L1064 / ~L1087).
        try db.execute(sql: """
            CREATE TABLE inventory_par (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              vendor TEXT, ingredient TEXT NOT NULL, sku TEXT NOT NULL DEFAULT '',
              par_qty REAL, par_unit TEXT, pack_size TEXT, pack_unit TEXT,
              category TEXT, note TEXT, location_id TEXT NOT NULL DEFAULT 'default',
              updated_at TEXT DEFAULT (datetime('now')),
              UNIQUE(location_id, ingredient, sku)
            );
            CREATE TABLE inventory_counts (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              count_date TEXT NOT NULL, label TEXT, opened_at TEXT DEFAULT (datetime('now')),
              closed_at TEXT, cook_id TEXT, location_id TEXT NOT NULL DEFAULT 'default'
            );
            CREATE TABLE inventory_count_lines (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              count_id INTEGER NOT NULL, vendor TEXT, ingredient TEXT NOT NULL,
              sku TEXT NOT NULL DEFAULT '', on_hand_qty REAL, unit TEXT, par_qty REAL, par_unit TEXT,
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
