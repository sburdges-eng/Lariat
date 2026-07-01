import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

// Behavior-parity port of tests/js/test-prep-par-api.mjs against an on-disk temp
// GRDB fixture seeded with the real prep_par (UNIQUE + CHECK) + audit_events
// schema. Covers:
//   - POST upsert: insert vs. update by UNIQUE(location, station, recipe, ingredient)
//   - POST 400 when both recipe_slug and ingredient are empty
//   - POST ingredient-target row (ingredient set, recipe_slug '')
//   - GET list: location scoping + station_id filter + ordering
//   - DELETE: removes the row, writes audit, 404 across locations, 400 bad id
final class PrepParRepositoryTests: XCTestCase {

    // ── POST upsert — insert path + audit ──────────────────────────────

    func testInsertRecipeTargetReturnsIsInsertAndAudit() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepParRepository(readDB: readDB, writeDB: writeDB)

        let result = try repo.upsert(
            input: PrepParUpsertInput(
                stationId: "grill", recipeSlug: "ribeye-8oz",
                targetQty: 12, unit: "portions", sortOrder: 1, cookId: "alice"
            ),
            context: .nativeCook(cookId: "alice")
        )
        XCTAssertTrue(result.isInsert)
        XCTAssertGreaterThan(result.id, 0)

        try writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM prep_par WHERE id = ?", arguments: [result.id])
            XCTAssertEqual(row?["station_id"], "grill")
            XCTAssertEqual(row?["recipe_slug"], "ribeye-8oz")
            XCTAssertEqual(row?["ingredient"], "")            // '' not NULL
            XCTAssertEqual(row?["target_qty"], 12.0)
            XCTAssertEqual(row?["unit"], "portions")

            let auditCount = try Int.fetchOne(
                db,
                sql: "SELECT COUNT(*) FROM audit_events WHERE entity='prep_par' AND entity_id=? AND action='insert'",
                arguments: [result.id]
            ) ?? 0
            XCTAssertEqual(auditCount, 1)
            let source = try String.fetchOne(
                db, sql: "SELECT actor_source FROM audit_events WHERE entity='prep_par' AND entity_id=? LIMIT 1",
                arguments: [result.id]
            )
            XCTAssertEqual(source, "native_cook")
        }
    }

    // ── POST upsert — update path reuses the row + audit update ─────────

    func testUpsertReusesRowAndRecordsUpdateAudit() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepParRepository(readDB: readDB, writeDB: writeDB)
        let ctx = RegulatedWriteContext.nativeCook(cookId: nil)

        let r1 = try repo.upsert(
            input: PrepParUpsertInput(stationId: "saute", recipeSlug: "chicken-breast", targetQty: 10, unit: "portions"),
            context: ctx
        )
        XCTAssertTrue(r1.isInsert)

        let r2 = try repo.upsert(
            input: PrepParUpsertInput(stationId: "saute", recipeSlug: "chicken-breast", targetQty: 20, unit: "portions"),
            context: ctx
        )
        XCTAssertEqual(r2.id, r1.id, "should reuse existing row")
        XCTAssertFalse(r2.isInsert)

        try writeDB.pool.read { db in
            let count = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM prep_par WHERE recipe_slug='chicken-breast'") ?? 0
            XCTAssertEqual(count, 1)
            let qty = try Double.fetchOne(db, sql: "SELECT target_qty FROM prep_par WHERE id=?", arguments: [r1.id])
            XCTAssertEqual(qty, 20.0)

            let updates = try Int.fetchOne(
                db,
                sql: "SELECT COUNT(*) FROM audit_events WHERE entity='prep_par' AND entity_id=? AND action='update'",
                arguments: [r1.id]
            ) ?? 0
            XCTAssertEqual(updates, 1)
        }
    }

    // ── POST 400 when both empty — no write, no audit ──────────────────

    func testUpsertRejectsBothEmptyWritesNothing() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepParRepository(readDB: readDB, writeDB: writeDB)

        XCTAssertThrowsError(
            try repo.upsert(input: PrepParUpsertInput(stationId: "fryer", targetQty: 5), context: .nativeCook(cookId: nil))
        ) { error in
            XCTAssertEqual(error as? PrepParWriteError, .recipeOrIngredientRequired)
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM prep_par") ?? 0, 0)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? 0, 0)
        }
    }

    // ── POST ingredient-target row ─────────────────────────────────────

    func testInsertIngredientTargetKeepsEmptyRecipe() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepParRepository(readDB: readDB, writeDB: writeDB)

        let result = try repo.upsert(
            input: PrepParUpsertInput(stationId: "cold", ingredient: "roma tomatoes", targetQty: 20, unit: "lbs"),
            context: .nativeCook(cookId: nil)
        )
        XCTAssertTrue(result.isInsert)
        try writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM prep_par WHERE id=?", arguments: [result.id])
            XCTAssertEqual(row?["ingredient"], "roma tomatoes")
            XCTAssertEqual(row?["recipe_slug"], "")
            XCTAssertEqual(row?["target_qty"], 20.0)
        }
    }

    // ── GET — location scoping ─────────────────────────────────────────

    func testLoadScopesToRequestedLocation() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepParRepository(readDB: readDB, writeDB: writeDB)

        _ = try repo.upsert(input: PrepParUpsertInput(recipeSlug: "salad", targetQty: 5), context: .nativeCook(cookId: nil, locationId: "kitchen-a"))
        _ = try repo.upsert(input: PrepParUpsertInput(recipeSlug: "soup", targetQty: 3), context: .nativeCook(cookId: nil, locationId: "kitchen-b"))

        let a = try await repo.load(locationId: "kitchen-a")
        XCTAssertEqual(a.rows.count, 1)
        XCTAssertEqual(a.rows.first?.recipeSlug, "salad")

        let b = try await repo.load(locationId: "kitchen-b")
        XCTAssertEqual(b.rows.count, 1)
        XCTAssertEqual(b.rows.first?.recipeSlug, "soup")
    }

    // ── GET — station filter ───────────────────────────────────────────

    func testLoadFiltersByStation() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepParRepository(readDB: readDB, writeDB: writeDB)
        let ctx = RegulatedWriteContext.nativeCook(cookId: nil)

        _ = try repo.upsert(input: PrepParUpsertInput(stationId: "grill", recipeSlug: "steak", targetQty: 10), context: ctx)
        _ = try repo.upsert(input: PrepParUpsertInput(stationId: "fryer", recipeSlug: "fries", targetQty: 20), context: ctx)
        _ = try repo.upsert(input: PrepParUpsertInput(stationId: "grill", ingredient: "salt", targetQty: 5), context: ctx)

        let snap = try await repo.load(stationId: "grill")
        XCTAssertEqual(snap.rows.count, 2)
        XCTAssertTrue(snap.rows.allSatisfy { $0.stationId == "grill" })
    }

    // ── GET — ordering: station_id, sort_order, recipe_slug, ingredient ─

    func testLoadOrdersByStationSortRecipeIngredient() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepParRepository(readDB: readDB, writeDB: writeDB)
        let ctx = RegulatedWriteContext.nativeCook(cookId: nil)

        _ = try repo.upsert(input: PrepParUpsertInput(stationId: "saute", recipeSlug: "pasta", targetQty: 5, sortOrder: 2), context: ctx)
        _ = try repo.upsert(input: PrepParUpsertInput(stationId: "grill", recipeSlug: "steak", targetQty: 10, sortOrder: 1), context: ctx)
        _ = try repo.upsert(input: PrepParUpsertInput(stationId: "saute", recipeSlug: "risotto", targetQty: 3, sortOrder: 1), context: ctx)

        let snap = try await repo.load()
        XCTAssertEqual(snap.rows[0].stationId, "grill")   // grill < saute
        XCTAssertEqual(snap.rows[1].stationId, "saute")
        XCTAssertEqual(snap.rows[1].recipeSlug, "risotto") // sort_order 1 before 2
        XCTAssertEqual(snap.rows[2].recipeSlug, "pasta")

        // Grouping: grill then saute; saute rows preserve query order.
        XCTAssertEqual(snap.groups.map(\.stationKey), ["grill", "saute"])
        XCTAssertEqual(snap.groups[1].rows.map(\.recipeSlug), ["risotto", "pasta"])
    }

    // ── DELETE — removes row + audit ───────────────────────────────────

    func testDeleteRemovesRowAndWritesAudit() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepParRepository(readDB: readDB, writeDB: writeDB)

        let r = try repo.upsert(input: PrepParUpsertInput(recipeSlug: "demo-dish", targetQty: 5), context: .nativeCook(cookId: nil))
        try repo.delete(id: r.id, context: .nativeCook(cookId: "bo"))

        try writeDB.pool.read { db in
            XCTAssertNil(try Row.fetchOne(db, sql: "SELECT * FROM prep_par WHERE id=?", arguments: [r.id]))
            let del = try Int.fetchOne(
                db,
                sql: "SELECT COUNT(*) FROM audit_events WHERE entity='prep_par' AND entity_id=? AND action='delete'",
                arguments: [r.id]
            ) ?? 0
            XCTAssertEqual(del, 1)
        }
    }

    // ── DELETE — wrong location → notFound, row survives ───────────────

    func testDeleteCrossLocationNotFoundLeavesRow() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepParRepository(readDB: readDB, writeDB: writeDB)

        let r = try repo.upsert(
            input: PrepParUpsertInput(recipeSlug: "location-scoped", targetQty: 3),
            context: .nativeCook(cookId: nil, locationId: "kitchen-a")
        )
        XCTAssertThrowsError(
            try repo.delete(id: r.id, context: .nativeCook(cookId: nil, locationId: "kitchen-b"))
        ) { error in
            XCTAssertEqual(error as? PrepParWriteError, .notFound)
        }
        try writeDB.pool.read { db in
            XCTAssertNotNil(try Row.fetchOne(db, sql: "SELECT id FROM prep_par WHERE id=?", arguments: [r.id]))
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE action='delete'") ?? 0, 0)
        }
    }

    // ── DELETE — bad id → badId ────────────────────────────────────────

    func testDeleteBadIdThrows() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = PrepParRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.delete(id: 0, context: .nativeCook(cookId: nil))) { error in
            XCTAssertEqual(error as? PrepParWriteError, .badId)
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private func makeRepos() throws -> (LariatDatabase, LariatWriteDatabase, String) {
        let path = try seedPrepParDatabase()
        let readDB = try LariatDatabase(path: path)
        let writeDB = try LariatWriteDatabase(path: path)
        return (readDB, writeDB, path)
    }

    private func cleanup(path: String) {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.removeItem(atPath: dir)
    }
}

private func seedPrepParDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-prep-par-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path

    let dbQueue = try DatabaseQueue(path: path)
    try dbQueue.write { db in
        // Schema mirrors lib/db.ts prep_par (UNIQUE + CHECK) + the audit_events shape.
        try db.execute(sql: """
            CREATE TABLE prep_par (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              location_id TEXT NOT NULL DEFAULT 'default',
              station_id TEXT NOT NULL DEFAULT '',
              recipe_slug TEXT NOT NULL DEFAULT '',
              ingredient TEXT NOT NULL DEFAULT '',
              target_qty REAL,
              unit TEXT,
              sort_order INTEGER DEFAULT 0,
              note TEXT,
              created_at TEXT DEFAULT (datetime('now')),
              updated_at TEXT DEFAULT (datetime('now')),
              UNIQUE(location_id, station_id, recipe_slug, ingredient),
              CHECK (recipe_slug <> '' OR ingredient <> '')
            );
            CREATE INDEX idx_prep_par_loc_station
              ON prep_par(location_id, station_id, sort_order);
            CREATE TABLE audit_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              entity TEXT NOT NULL,
              entity_id INTEGER,
              action TEXT NOT NULL
                CHECK(action IN ('insert','update','delete','correction','view')),
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
