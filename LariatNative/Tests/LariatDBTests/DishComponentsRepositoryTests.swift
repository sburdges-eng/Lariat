import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Behavior-parity port of `app/api/dish-components/route.ts` +
/// `lib/dishComponentsRepo.ts` (upsertDishComponent) against a real GRDB
/// fixture with the web DDL (incl. the two partial UNIQUE indexes). No
/// dedicated web route test exists — authored against the web code paths
/// (documented in the A4.3 plan).
///
/// AUDIT POSTURE (asserted below): the web route posts NO audit_events for
/// dish-components writes; native mirrors that — writes go through
/// LariatWriteDatabase in ONE transaction with zero audit rows.
/// IDEMPOTENCY: the web wraps POST/DELETE in `withIdempotency`; native has
/// no idempotency layer (deliberate divergence, ingredient-masters
/// precedent) — there is no idempotency_keys table in this fixture and the
/// repository never references one.
final class DishComponentsRepositoryTests: XCTestCase {

    // ── fixture ─────────────────────────────────────────────────────────────

    private struct Repos {
        let repo: DishComponentsRepository
        let readDB: LariatDatabase
        let writeDB: LariatWriteDatabase

        func writeSeed(_ block: @escaping (Database) throws -> Void) throws {
            try writeDB.pool.write { db in try block(db) }
        }
        func count(_ sql: String) throws -> Int {
            try writeDB.pool.read { db in try Int.fetchOne(db, sql: sql) ?? -1 }
        }
    }

    private func makeRepos(locationId: String = "default") throws -> (Repos, String) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("lariat-dish-components-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let path = dir.appendingPathComponent("lariat.db").path

        let dbQueue = try DatabaseQueue(path: path)
        try dbQueue.write { db in
            try db.execute(sql: """
                CREATE TABLE dish_components (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  location_id TEXT NOT NULL DEFAULT 'default',
                  dish_name TEXT NOT NULL,
                  component_type TEXT NOT NULL DEFAULT 'recipe'
                    CHECK(component_type IN ('recipe', 'vendor_item')),
                  recipe_slug TEXT,
                  vendor_ingredient TEXT,
                  qty_per_serving REAL NOT NULL,
                  unit TEXT NOT NULL,
                  notes TEXT,
                  created_at TEXT DEFAULT (datetime('now')),
                  updated_at TEXT DEFAULT (datetime('now')),
                  CHECK (
                    (component_type = 'recipe' AND recipe_slug IS NOT NULL AND vendor_ingredient IS NULL) OR
                    (component_type = 'vendor_item' AND vendor_ingredient IS NOT NULL AND recipe_slug IS NULL)
                  ));
                CREATE UNIQUE INDEX idx_dish_components_recipe_unique
                  ON dish_components(location_id, dish_name, recipe_slug)
                  WHERE component_type = 'recipe';
                CREATE UNIQUE INDEX idx_dish_components_vendor_unique
                  ON dish_components(location_id, dish_name, vendor_ingredient)
                  WHERE component_type = 'vendor_item';

                CREATE TABLE vendor_prices (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  ingredient TEXT NOT NULL,
                  vendor TEXT,
                  sku TEXT,
                  pack_size REAL,
                  pack_unit TEXT,
                  pack_price REAL,
                  unit_price REAL,
                  category TEXT,
                  location_id TEXT DEFAULT 'default',
                  imported_at TEXT DEFAULT (datetime('now')));

                CREATE TABLE order_guide_items (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  ingredient TEXT NOT NULL,
                  base_qty REAL,
                  unit TEXT,
                  vendor TEXT,
                  unit_price REAL,
                  location_id TEXT DEFAULT 'default',
                  imported_at TEXT DEFAULT (datetime('now')),
                  is_placeholder INTEGER DEFAULT 0);

                CREATE TABLE audit_events (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  shift_date TEXT NOT NULL,
                  location_id TEXT DEFAULT 'default',
                  actor_cook_id TEXT,
                  actor_source TEXT NOT NULL,
                  entity TEXT NOT NULL,
                  entity_id INTEGER,
                  action TEXT NOT NULL
                    CHECK(action IN ('insert','update','delete','correction','view')),
                  replaces_id INTEGER,
                  payload_json TEXT,
                  note TEXT,
                  created_at TEXT DEFAULT (datetime('now')));
                """)
        }

        let readDB = try LariatDatabase(path: path)
        let writeDB = try LariatWriteDatabase(path: path)
        let repo = DishComponentsRepository(readDB: readDB, writeDB: writeDB, locationId: locationId)
        return (Repos(repo: repo, readDB: readDB, writeDB: writeDB), path)
    }

    private func cleanup(_ path: String) {
        try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent)
    }

    private func recipeDraft(
        dish: String = "Rope Burger", slug: String = "bacon_jam",
        qty: Double = 0.5, unit: String = "cup", notes: String? = nil,
        locationId: String = "default"
    ) -> DishComponentDraft {
        DishComponentDraft(dishName: dish, componentType: "recipe", recipeSlug: slug,
                           vendorIngredient: nil, qtyPerServing: qty, unit: unit,
                           notes: notes, locationId: locationId)
    }

    private func vendorDraft(
        dish: String = "Rope Burger", ingredient: String = "Brioche Bun",
        qty: Double = 1, unit: String = "each", locationId: String = "default"
    ) -> DishComponentDraft {
        DishComponentDraft(dishName: dish, componentType: "vendor_item", recipeSlug: nil,
                           vendorIngredient: ingredient, qtyPerServing: qty, unit: unit,
                           notes: nil, locationId: locationId)
    }

    // ── GET parity (route.ts L18-48) ────────────────────────────────────────

    func testListOrderedAndLocationScoped() async throws {
        let (r, p) = try makeRepos(); defer { cleanup(p) }
        _ = try r.repo.upsert(vendorDraft(dish: "Zebra Cake", ingredient: "Sprinkles"))
        _ = try r.repo.upsert(recipeDraft(dish: "Apple Pie", slug: "pie_dough"))
        _ = try r.repo.upsert(recipeDraft(dish: "Apple Pie", slug: "apple_filling"))
        try r.writeSeed { db in
            try db.execute(sql: """
                INSERT INTO dish_components
                  (location_id, dish_name, component_type, recipe_slug, qty_per_serving, unit)
                VALUES ('kitchen-b', 'other dish', 'recipe', 'x', 1, 'oz')
                """)
        }

        let rows = try await r.repo.list()
        // ORDER BY dish_name, component_type, recipe_slug, vendor_ingredient
        XCTAssertEqual(rows.map(\.dishName), ["apple pie", "apple pie", "zebra cake"])
        XCTAssertEqual(rows.map(\.recipeSlug), ["apple_filling", "pie_dough", nil])
        XCTAssertNil(rows.first { $0.locationId == "kitchen-b" }, "other locations must not leak")
    }

    /// GET ?dish= filter matches on LOWER(TRIM(dish_name)) = normalizeDishName(dish)
    /// — a display-form query ("THE Rope Burger!") finds the canonical row.
    func testListDishFilterUsesNormalizedName() async throws {
        let (r, p) = try makeRepos(); defer { cleanup(p) }
        _ = try r.repo.upsert(recipeDraft(dish: "The Rope Burger", slug: "bacon_jam"))
        _ = try r.repo.upsert(recipeDraft(dish: "Apple Pie", slug: "pie_dough"))

        let rows = try await r.repo.list(dish: " THE Rope  Burger! ")
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].dishName, "the rope burger")
    }

    // ── POST parity: upsert (route + lib/dishComponentsRepo) ────────────────

    func testUpsertInsertsCanonicalRow() async throws {
        let (r, p) = try makeRepos(); defer { cleanup(p) }
        let result = try r.repo.upsert(recipeDraft(dish: "  THE Rope  Burger! ", notes: " toasted "))
        XCTAssertEqual(result.outcome, .inserted)
        XCTAssertEqual(result.row.dishName, "the rope burger", "dish_name stored CANONICAL")
        XCTAssertEqual(result.row.componentType, "recipe")
        XCTAssertEqual(result.row.recipeSlug, "bacon_jam")
        XCTAssertNil(result.row.vendorIngredient)
        XCTAssertEqual(result.row.qtyPerServing, 0.5, accuracy: 1e-9)
        XCTAssertEqual(result.row.unit, "cup")
        XCTAssertEqual(result.row.notes, "toasted")
    }

    /// Identical re-post → 'skipped' (same qty, unit, notes — repo L138-145).
    func testUpsertIdenticalRowSkipped() async throws {
        let (r, p) = try makeRepos(); defer { cleanup(p) }
        _ = try r.repo.upsert(recipeDraft())
        let second = try r.repo.upsert(recipeDraft())
        XCTAssertEqual(second.outcome, .skipped)
        XCTAssertEqual(try r.count("SELECT COUNT(*) FROM dish_components"), 1)
    }

    /// Changed qty → 'updated', single row (partial unique index conflict path).
    func testUpsertChangedQtyUpdatesInPlace() async throws {
        let (r, p) = try makeRepos(); defer { cleanup(p) }
        _ = try r.repo.upsert(recipeDraft(qty: 0.5))
        let second = try r.repo.upsert(recipeDraft(qty: 0.75))
        XCTAssertEqual(second.outcome, .updated)
        XCTAssertEqual(second.row.qtyPerServing, 0.75, accuracy: 1e-9)
        XCTAssertEqual(try r.count("SELECT COUNT(*) FROM dish_components"), 1)
    }

    /// vendor_item conflict targets (location, dish, vendor_ingredient).
    func testVendorUpsertDedupesOnIngredient() async throws {
        let (r, p) = try makeRepos(); defer { cleanup(p) }
        _ = try r.repo.upsert(vendorDraft(qty: 1))
        let second = try r.repo.upsert(vendorDraft(qty: 2))
        XCTAssertEqual(second.outcome, .updated)
        XCTAssertEqual(try r.count("SELECT COUNT(*) FROM dish_components"), 1)
    }

    /// nil componentType defaults to 'recipe' (web `?? 'recipe'`).
    func testNilComponentTypeDefaultsToRecipe() async throws {
        let (r, p) = try makeRepos(); defer { cleanup(p) }
        let result = try r.repo.upsert(DishComponentDraft(
            dishName: "Pie", componentType: nil, recipeSlug: "pie_dough",
            vendorIngredient: nil, qtyPerServing: 1, unit: "each",
            notes: nil, locationId: "default"))
        XCTAssertEqual(result.row.componentType, "recipe")
    }

    /// Rule failure throws BEFORE any write — table untouched, no audit rows.
    func testValidationFailureThrowsBeforeWrite() async throws {
        let (r, p) = try makeRepos(); defer { cleanup(p) }
        XCTAssertThrowsError(try r.repo.upsert(recipeDraft(qty: 0))) {
            XCTAssertEqual($0 as? DishComponentWriteError,
                           .validation(reason: "qty_per_serving must be a positive number"))
        }
        XCTAssertThrowsError(try r.repo.upsert(recipeDraft(dish: "!!!"))) {
            XCTAssertEqual($0 as? DishComponentWriteError, .normalizedEmpty)
        }
        XCTAssertEqual(try r.count("SELECT COUNT(*) FROM dish_components"), 0)
        XCTAssertEqual(try r.count("SELECT COUNT(*) FROM audit_events"), 0)
    }

    /// Over-length fields are CLIPPED (80/200/24/500), not rejected — route
    /// clip() parity, persisted through the write path.
    func testOverLengthFieldsClippedOnWrite() async throws {
        let (r, p) = try makeRepos(); defer { cleanup(p) }
        let long = try r.repo.upsert(recipeDraft(
            slug: String(repeating: "s", count: 100),
            unit: String(repeating: "u", count: 30),
            notes: String(repeating: "n", count: 600)))
        XCTAssertEqual(long.row.recipeSlug?.count, 80)
        XCTAssertEqual(long.row.unit.count, 24)
        XCTAssertEqual(long.row.notes?.count, 500)

        let vendor = try r.repo.upsert(vendorDraft(ingredient: String(repeating: "v", count: 250)))
        XCTAssertEqual(vendor.row.vendorIngredient?.count, 200)
    }

    /// WEB-PARITY AUDIT POSTURE: the route posts NO audit_events for these
    /// writes — successful native writes must leave audit_events empty too.
    func testWritesPostNoAuditEvents() async throws {
        let (r, p) = try makeRepos(); defer { cleanup(p) }
        let inserted = try r.repo.upsert(recipeDraft())
        _ = try r.repo.upsert(recipeDraft(qty: 0.75))
        try r.repo.delete(id: inserted.row.id)
        XCTAssertEqual(try r.count("SELECT COUNT(*) FROM audit_events"), 0,
                       "web /api/dish-components writes no audit_events; native mirrors that")
    }

    // ── DELETE parity (route.ts L98-116) ────────────────────────────────────

    func testDeleteRemovesRowById() async throws {
        let (r, p) = try makeRepos(); defer { cleanup(p) }
        let inserted = try r.repo.upsert(recipeDraft())
        try r.repo.delete(id: inserted.row.id)
        XCTAssertEqual(try r.count("SELECT COUNT(*) FROM dish_components"), 0)
    }

    func testDeleteRejectsNonPositiveId() async throws {
        let (r, p) = try makeRepos(); defer { cleanup(p) }
        XCTAssertThrowsError(try r.repo.delete(id: 0)) {
            XCTAssertEqual($0 as? DishComponentWriteError, .invalidId)
        }
        XCTAssertThrowsError(try r.repo.delete(id: -5)) {
            XCTAssertEqual($0 as? DishComponentWriteError, .invalidId)
        }
    }

    /// Deleting a missing id succeeds silently (web returns ok:true) and the
    /// web DELETE has NO location scoping — by-pk only (mirrored).
    func testDeleteMissingIdIsSilentlyOk() async throws {
        let (r, p) = try makeRepos(); defer { cleanup(p) }
        XCTAssertNoThrow(try r.repo.delete(id: 12345))
    }

    // ── distributor candidates (components/page.tsx L60-96) ────────────────

    func testDistributorCandidatesVendorPreferredThenOrderGuide() async throws {
        let (r, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { db in
            try db.execute(sql: """
                INSERT INTO vendor_prices (ingredient, vendor, pack_unit, unit_price, location_id, imported_at)
                VALUES ('Brioche Bun', 'sysco', 'each', 0.40, 'default', '2026-06-01 00:00:00'),
                       ('Brioche Bun', 'sysco', 'each', 0.99, 'default', '2026-05-01 00:00:00');
                INSERT INTO order_guide_items (ingredient, unit, vendor, unit_price, location_id)
                VALUES ('BRIOCHE BUN', 'each', 'shamrock', 0.55, 'default'),
                       ('American Cheese', 'each', 'shamrock', 0.12, 'default');
                """)
        }
        let candidates = try await r.repo.distributorCandidates()
        XCTAssertEqual(candidates.count, 2, "case-insensitive dedupe by ingredient")
        let bun = try XCTUnwrap(candidates.first { $0.ingredient == "Brioche Bun" })
        XCTAssertEqual(bun.source, "vendor_prices")
        XCTAssertEqual(bun.unitPrice ?? -1, 0.40, accuracy: 1e-9, "latest imported_at wins")
        let cheese = try XCTUnwrap(candidates.first { $0.ingredient == "American Cheese" })
        XCTAssertEqual(cheese.source, "order_guide")
    }
}
