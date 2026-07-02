import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

// Behavior-parity port of the inventory LOG + WASTE surface against an in-memory
// (on-disk temp) GRDB fixture seeded with the REAL inventory_updates + bom_lines +
// audit_events schemas. Oracle: tests/js/test-t8-cooking-shrinkage.mjs (route
// handler + source gate + fallbacks + GET) and the waste-view reads.
//
// The pure-math oracle cases (applyShrinkage boundaries, formatters, reason
// strings) live in InventoryShrinkageComputeTests. Here we pin the route/repo
// behavior: the T8 source gate, bom_lines lookup, delta persistence, and the
// waste range reads. String-qty is type-impossible in the typed API (skipped);
// NaN/Infinity qty are normalized to nil to mirror JSON transport.
final class InventoryUpdateRepositoryTests: XCTestCase {

    private func ctx(location: String = "default", cook: String? = "alice") -> RegulatedWriteContext {
        RegulatedWriteContext(
            actorCookId: cook,
            actorSource: RegulatedWriteContext.nativeCookActorSource,
            locationId: location,
            shiftDate: "2026-07-02"
        )
    }

    /// Numeric portion of a formatted delta like "-10.667 oz".
    private func parseDelta(_ s: String?) -> Double {
        guard let s else { return .nan }
        let match = s.prefix { $0 == "-" || $0 == "." || $0.isNumber }
        return Double(match) ?? .nan
    }

    // ── T8 acceptance + source gate ─────────────────────────────────────

    func testToastAcceptanceDepletesRawWeight() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        try seedBom(writeDB, recipe: "burger", ingredient: "patty", lossFactor: 0.25)
        let repo = InventoryUpdateRepository(readDB: readDB, writeDB: writeDB)
        let r = try repo.logUpdate(input: InventoryLogInput(
            item: "patty", qty: 8, unit: "oz", direction: "out", source: "toast",
            recipeId: "burger", ingredient: "patty"
        ), context: ctx())
        XCTAssertEqual(r.source, "toast")
        XCTAssertTrue(r.shrinkageApplied)
        XCTAssertEqual(r.shrinkageReason, "shrinkage_applied")
        XCTAssertEqual(r.rawQty ?? 0, 10.6667, accuracy: 0.001)
        XCTAssertEqual(parseDelta(r.delta), -10.667, accuracy: 0.1)
        try writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM inventory_updates ORDER BY id DESC LIMIT 1")!
            XCTAssertEqual(row["item"], "patty")
            XCTAssertEqual(row["direction"], "out")
            let note: String = row["note"]
            XCTAssertTrue(note.contains("T8") && note.contains("cooked=8 oz") && note.contains("raw=10.667 oz") && note.contains("shrinkage_applied"), note)
            XCTAssertEqual(try String.fetchOne(db, sql: "SELECT actor_source FROM audit_events WHERE entity='inventory_updates' LIMIT 1"), "native_cook")
        }
    }

    func testManualSourceDoesNotApplyShrinkage() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        try seedBom(writeDB, recipe: "burger", ingredient: "patty", lossFactor: 0.25)
        let repo = InventoryUpdateRepository(readDB: readDB, writeDB: writeDB)
        let r = try repo.logUpdate(input: InventoryLogInput(
            item: "patty", qty: 8, unit: "oz", direction: "out", source: "manual",
            recipeId: "burger", ingredient: "patty"
        ), context: ctx())
        XCTAssertEqual(r.source, "manual")
        XCTAssertFalse(r.shrinkageApplied)
        XCTAssertEqual(parseDelta(r.delta), -8, accuracy: 0.01)   // cooked-qty preserved
        try writeDB.pool.read { db in
            let note: String? = try Row.fetchOne(db, sql: "SELECT note FROM inventory_updates ORDER BY id DESC LIMIT 1")?["note"]
            XCTAssertNil(note)   // no shrinkage note on the manual path
        }
    }

    func testDefaultSourceIsManualEquivalent() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        try seedBom(writeDB, recipe: "burger", ingredient: "patty", lossFactor: 0.25)
        let repo = InventoryUpdateRepository(readDB: readDB, writeDB: writeDB)
        let r = try repo.logUpdate(input: InventoryLogInput(
            item: "patty", qty: 8, unit: "oz", recipeId: "burger", ingredient: "patty"
        ), context: ctx())
        XCTAssertEqual(r.source, "manual")
        XCTAssertFalse(r.shrinkageApplied)
        XCTAssertEqual(parseDelta(r.delta), -8, accuracy: 0.01)
    }

    func testUppercaseToastNormalized() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        try seedBom(writeDB, recipe: "burger", ingredient: "patty", lossFactor: 0.25)
        let repo = InventoryUpdateRepository(readDB: readDB, writeDB: writeDB)
        let r = try repo.logUpdate(input: InventoryLogInput(
            item: "patty", qty: 8, unit: "oz", source: "TOAST", recipeId: "burger", ingredient: "patty"
        ), context: ctx())
        XCTAssertEqual(r.source, "toast")
        XCTAssertTrue(r.shrinkageApplied)
    }

    // ── toast fallbacks ─────────────────────────────────────────────────

    func testToastFallbacks() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryUpdateRepository(readDB: readDB, writeDB: writeDB)

        // no bom row
        var r = try repo.logUpdate(input: InventoryLogInput(item: "patty", qty: 8, unit: "oz", source: "toast", recipeId: "no-such", ingredient: "patty"), context: ctx())
        XCTAssertFalse(r.shrinkageApplied)
        XCTAssertEqual(r.shrinkageReason, "no_bom_line")
        XCTAssertEqual(parseDelta(r.delta), -8, accuracy: 0.01)

        // bom row, NULL loss_factor
        try seedBom(writeDB, recipe: "burger", ingredient: "patty", lossFactor: nil)
        r = try repo.logUpdate(input: InventoryLogInput(item: "patty", qty: 8, unit: "oz", source: "toast", recipeId: "burger", ingredient: "patty"), context: ctx())
        XCTAssertEqual(r.shrinkageReason, "no_loss_factor")
        XCTAssertEqual(parseDelta(r.delta), -8, accuracy: 0.01)

        // loss_factor = 0 and = 1 → out_of_range
        try seedBom(writeDB, recipe: "salad", ingredient: "lettuce", lossFactor: 0)
        r = try repo.logUpdate(input: InventoryLogInput(item: "lettuce", qty: 8, unit: "oz", source: "toast", recipeId: "salad", ingredient: "lettuce"), context: ctx())
        XCTAssertEqual(r.shrinkageReason, "loss_factor_out_of_range")
        XCTAssertEqual(parseDelta(r.delta), -8, accuracy: 0.01)

        try seedBom(writeDB, recipe: "evap", ingredient: "water", lossFactor: 1)
        r = try repo.logUpdate(input: InventoryLogInput(item: "water", qty: 8, unit: "oz", source: "toast", recipeId: "evap", ingredient: "water"), context: ctx())
        XCTAssertEqual(r.shrinkageReason, "loss_factor_out_of_range")
        XCTAssertEqual(parseDelta(r.delta), -8, accuracy: 0.01)
    }

    func testMissingRecipeIdFallsThrough() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        try seedBom(writeDB, recipe: "burger", ingredient: "patty", lossFactor: 0.25)
        let repo = InventoryUpdateRepository(readDB: readDB, writeDB: writeDB)
        let r = try repo.logUpdate(input: InventoryLogInput(item: "patty", qty: 8, unit: "oz", source: "toast", ingredient: "patty"), context: ctx())
        XCTAssertFalse(r.shrinkageApplied)      // gate fails (no recipe_id)
        XCTAssertEqual(parseDelta(r.delta), -8, accuracy: 0.01)   // cooked-qty delta
    }

    func testBomLookupCaseInsensitiveAndLocationScoped() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryUpdateRepository(readDB: readDB, writeDB: writeDB)
        // Seeded as "Patty" at default; looked up as "  patty " → case-insensitive/trim match.
        try seedBom(writeDB, recipe: "burger", ingredient: "Patty", lossFactor: 0.25)
        let hit = try repo.logUpdate(input: InventoryLogInput(item: "patty", qty: 8, unit: "oz", source: "toast", recipeId: "burger", ingredient: "  patty "), context: ctx())
        XCTAssertTrue(hit.shrinkageApplied)
        // A bom row that lives at another site is invisible → no_bom_line.
        try seedBom(writeDB, recipe: "wrap", ingredient: "tortilla", lossFactor: 0.25, location: "uptown")
        let miss = try repo.logUpdate(input: InventoryLogInput(item: "tortilla", qty: 8, unit: "oz", source: "toast", recipeId: "wrap", ingredient: "tortilla"), context: ctx(location: "default"))
        XCTAssertFalse(miss.shrinkageApplied)
        XCTAssertEqual(miss.shrinkageReason, "no_bom_line")
    }

    // ── validation / edge cases ──────────────────────────────────────────

    func testItemRequired() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryUpdateRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.logUpdate(input: InventoryLogInput(item: "   ", qty: 8, unit: "oz"), context: ctx())) {
            XCTAssertEqual($0 as? InventoryUpdateWriteError, .itemRequired)
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM inventory_updates") ?? -1, 0)
        }
    }

    func testFreeTextDeltaPreservedVerbatim() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryUpdateRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.logUpdate(input: InventoryLogInput(item: "cilantro", delta: "half a bunch", direction: "waste"), context: ctx())
        try writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT delta, direction FROM inventory_updates ORDER BY id DESC LIMIT 1")!
            XCTAssertEqual(row["delta"], "half a bunch")
            XCTAssertEqual(row["direction"], "waste")
        }
    }

    func testNonPositiveAndNonFiniteQtyStoreNullDelta() throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        try seedBom(writeDB, recipe: "burger", ingredient: "patty", lossFactor: 0.25)
        let repo = InventoryUpdateRepository(readDB: readDB, writeDB: writeDB)
        for qty in [-5.0, Double.nan, Double.infinity] {
            let r = try repo.logUpdate(input: InventoryLogInput(item: "patty", qty: qty, unit: "oz", source: "toast", recipeId: "burger", ingredient: "patty"), context: ctx())
            XCTAssertFalse(r.shrinkageApplied, "qty=\(qty)")
            XCTAssertNil(r.delta, "qty=\(qty) should store no computed delta")
        }
    }

    // ── GET list + waste reads ────────────────────────────────────────────

    func testListNewestFirst() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        try seedBom(writeDB, recipe: "burger", ingredient: "patty", lossFactor: 0.25)
        let repo = InventoryUpdateRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.logUpdate(input: InventoryLogInput(item: "patty", qty: 8, unit: "oz", source: "toast", recipeId: "burger", ingredient: "patty"), context: ctx())
        _ = try repo.logUpdate(input: InventoryLogInput(item: "cilantro", delta: "1 bunch", direction: "waste"), context: ctx())
        let rows = try await repo.listUpdates(date: ShiftDate.todayISO())
        XCTAssertEqual(rows.map(\.item), ["cilantro", "patty"])   // newest first
    }

    func testWasteRecentAndByItemWindow() async throws {
        let (readDB, writeDB, path) = try makeRepos()
        defer { cleanup(path: path) }
        let repo = InventoryUpdateRepository(readDB: readDB, writeDB: writeDB)
        // Two waste rows for lettuce + one for tomato inside the window, one stale.
        try await writeDB.pool.write { db in
            try db.execute(sql: "INSERT INTO inventory_updates (shift_date, item, delta, direction, location_id, created_at) VALUES ('2026-07-02','lettuce','-1','waste','default','2026-07-02 09:00:00')")
            try db.execute(sql: "INSERT INTO inventory_updates (shift_date, item, delta, direction, location_id, created_at) VALUES ('2026-07-01','lettuce','-2','waste','default','2026-07-01 09:00:00')")
            try db.execute(sql: "INSERT INTO inventory_updates (shift_date, item, delta, direction, location_id, created_at) VALUES ('2026-07-02','tomato','-3','waste','default','2026-07-02 10:00:00')")
            // Out of window (older than since) — excluded.
            try db.execute(sql: "INSERT INTO inventory_updates (shift_date, item, delta, direction, location_id, created_at) VALUES ('2026-06-01','lettuce','-9','waste','default','2026-06-01 09:00:00')")
            // Non-waste — excluded from both waste queries.
            try db.execute(sql: "INSERT INTO inventory_updates (shift_date, item, delta, direction, location_id, created_at) VALUES ('2026-07-02','patty','-8 oz','out','default','2026-07-02 11:00:00')")
        }
        let days = InventoryWaste.clampDays(7)
        let since = InventoryWaste.sinceDate(today: "2026-07-02", days: days)   // 2026-06-26
        XCTAssertEqual(since, "2026-06-26")

        let recent = try await repo.wasteRecent(since: since, locationId: "default")
        XCTAssertEqual(recent.count, 3)                          // 3 in-window waste rows, stale + non-waste excluded
        XCTAssertTrue(recent.allSatisfy { $0.direction == "waste" })

        let byItem = try await repo.wasteByItem(since: since, locationId: "default")
        XCTAssertEqual(byItem.map(\.item), ["lettuce", "tomato"])   // hits desc: lettuce 2, tomato 1
        XCTAssertEqual(byItem.first?.hits, 2)
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private func seedBom(_ writeDB: LariatWriteDatabase, recipe: String, ingredient: String, lossFactor: Double?, location: String = "default") throws {
        try writeDB.pool.write { db in
            try db.execute(
                sql: "INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, loss_factor, location_id) VALUES (?, ?, 1, 'oz', ?, ?)",
                arguments: [recipe, ingredient, lossFactor, location]
            )
        }
    }

    private func makeRepos() throws -> (LariatDatabase, LariatWriteDatabase, String) {
        let path = try seedInventoryUpdatesDatabase()
        return (try LariatDatabase(path: path), try LariatWriteDatabase(path: path), path)
    }
    private func cleanup(path: String) {
        try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent)
    }
}

private func seedInventoryUpdatesDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-inv-updates-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path
    let dbQueue = try DatabaseQueue(path: path)
    try dbQueue.write { db in
        // Mirror the REAL web schema (lib/db.ts ~L1029; bom_lines ~L1410 + the
        // T1 loss_factor migration column).
        try db.execute(sql: """
            CREATE TABLE inventory_updates (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL, station_id TEXT, item TEXT NOT NULL, master_id TEXT,
              delta TEXT, direction TEXT, note TEXT, cook_id TEXT,
              created_at TEXT DEFAULT (datetime('now')), location_id TEXT DEFAULT 'default'
            );
            CREATE TABLE bom_lines (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              recipe_id TEXT NOT NULL, ingredient TEXT, qty REAL, unit TEXT,
              loss_factor REAL, location_id TEXT DEFAULT 'default'
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
