import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Behavior parity with `tests/js/test-specials-saved-api.mjs`,
/// `test-specials-export.mjs` (route half), and `test-specials-promotion.mjs`
/// against a temp fixture DB mirroring the web `lib/db.ts` DDL for `specials`,
/// `specials_promotions`, `dish_components` (+ the vendor partial UNIQUE
/// index), `vendor_prices`, `ingredient_densities`, `entities_recipes`, and
/// `audit_events`. Never touches the real `data/lariat.db`.
final class SpecialsRepositoryTests: XCTestCase {
    private var dir: String!
    private var dbPath: String!
    private var auditPath: String!
    private var readDB: LariatDatabase!
    private var writeDB: LariatWriteDatabase!

    override func setUpWithError() throws {
        dir = NSTemporaryDirectory() + "lariat-specials-" + UUID().uuidString
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        dbPath = (dir as NSString).appendingPathComponent("lariat.db")
        auditPath = (dir as NSString).appendingPathComponent("management-actions.jsonl")

        let bootstrap = try DatabasePool(path: dbPath)
        try bootstrap.write { db in
            try db.execute(sql: """
                CREATE TABLE specials (
                  id TEXT PRIMARY KEY,
                  location_id TEXT NOT NULL DEFAULT 'default',
                  name TEXT NOT NULL,
                  pantry_text TEXT NOT NULL DEFAULT '',
                  prompt_text TEXT NOT NULL DEFAULT '',
                  ai_answer TEXT NOT NULL DEFAULT '',
                  ai_model TEXT NOT NULL DEFAULT '',
                  cost_breakdown TEXT,
                  cost_total REAL,
                  scratch_notes TEXT NOT NULL DEFAULT '',
                  sources TEXT,
                  last_exported_at INTEGER,
                  created_at INTEGER NOT NULL,
                  updated_at INTEGER NOT NULL,
                  archived_at INTEGER);
                CREATE TABLE specials_promotions (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  special_id TEXT NOT NULL,
                  location_id TEXT NOT NULL DEFAULT 'default',
                  menu_item_name TEXT NOT NULL,
                  servings REAL NOT NULL DEFAULT 1,
                  components_json TEXT NOT NULL DEFAULT '[]',
                  promoted_at INTEGER NOT NULL,
                  updated_at INTEGER NOT NULL);
                CREATE UNIQUE INDEX idx_specials_promotions_special
                  ON specials_promotions(location_id, special_id);
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
                  updated_at TEXT DEFAULT (datetime('now')));
                CREATE UNIQUE INDEX idx_dish_components_vendor_unique
                  ON dish_components(location_id, dish_name, vendor_ingredient)
                  WHERE component_type = 'vendor_item';
                CREATE TABLE vendor_prices (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  ingredient TEXT NOT NULL,
                  vendor TEXT, sku TEXT,
                  pack_size REAL, pack_unit TEXT, pack_price REAL, unit_price REAL,
                  category TEXT,
                  location_id TEXT DEFAULT 'default',
                  imported_at TEXT DEFAULT (datetime('now')));
                CREATE TABLE ingredient_densities (
                  ingredient_key TEXT PRIMARY KEY,
                  g_per_ml REAL NOT NULL,
                  source TEXT,
                  updated_at TEXT DEFAULT (datetime('now')));
                CREATE TABLE entities_recipes (
                  slug TEXT NOT NULL,
                  location_id TEXT NOT NULL DEFAULT 'default');
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
        readDB = try LariatDatabase(path: dbPath)
        writeDB = try LariatWriteDatabase(path: dbPath)
    }

    override func tearDownWithError() throws {
        readDB = nil
        writeDB = nil
        try? FileManager.default.removeItem(atPath: dir)
    }

    private var repo: SpecialsRepository {
        SpecialsRepository(readDB: readDB, writeDB: writeDB, auditPath: auditPath)
    }

    private var context: RegulatedWriteContext {
        RegulatedWriteContext(
            actorCookId: "7", actorSource: "native_mac",
            locationId: "default", shiftDate: "2026-07-02")
    }

    private func validDraft(name: String = "Pork Belly App") -> SpecialDraft {
        SpecialDraft(
            name: name,
            pantryText: "10 lbs pork belly",
            promptText: "High-margin appetizer",
            aiAnswer: "Sear belly. Plate over slaw.",
            aiModel: "lari-the-kitchen-assistant",
            costBreakdownJson: #"[{"item":"Pork Belly","req_qty":2,"req_unit":"lb","match":"Sysco","cost":10}]"#,
            costTotal: 10)
    }

    /// The promotion suite's costed special: two matched lines + one unmatched.
    private func costedDraft(name: String = "Pork Belly Stack") -> SpecialDraft {
        SpecialDraft(
            name: name,
            pantryText: "10 lbs pork belly",
            promptText: "High-margin special",
            aiAnswer: "Sear belly. Stack over slaw.",
            aiModel: "lari-the-kitchen-assistant",
            costBreakdownJson: """
                [{"item":"pork belly","req_qty":4,"req_unit":"lb","match":"PORK BELLY SKIN-ON","cost":20},
                 {"item":"bbq sauce","req_qty":8,"req_unit":"oz","match":"BBQ SAUCE SWEET 1GAL","cost":1.5},
                 {"item":"micro greens","req_qty":1,"req_unit":"oz","cost":null,"note":"No vendor match"}]
                """,
            costTotal: 21.5)
    }

    private func seedVendor(_ ingredient: String, packUnit: String, locationId: String = "default") throws {
        try writeDB.write { db in
            try db.execute(sql: """
                INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, category, location_id)
                VALUES (?, 'shamrock', 'SKU-1', 1, ?, 1, 1, 'protein', ?)
                """, arguments: [ingredient, packUnit, locationId])
        }
    }

    private func seedDefaultVendors(locationId: String = "default") throws {
        try seedVendor("PORK BELLY SKIN-ON", packUnit: "lb", locationId: locationId)
        try seedVendor("BBQ SAUCE SWEET 1GAL", packUnit: "oz", locationId: locationId)
    }

    private func auditLines() throws -> [[String: Any]] {
        guard FileManager.default.fileExists(atPath: auditPath) else { return [] }
        let content = try String(contentsOfFile: auditPath, encoding: .utf8)
        return content.split(separator: "\n").compactMap {
            try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any]
        }
    }

    private func fetchOne(_ sql: String, _ arguments: StatementArguments = []) throws -> Row? {
        try readDB.pool.read { db in try Row.fetchOne(db, sql: sql, arguments: arguments) }
    }

    // ── create ──────────────────────────────────────────────────────────────

    func testCreateInsertsRowAndReturnsUuid() throws {
        let id = try repo.create(validDraft())
        XCTAssertNotNil(id.range(of: "^[0-9a-f-]{36}$", options: .regularExpression))
        let row = try fetchOne("SELECT * FROM specials WHERE id = ?", [id])!
        XCTAssertEqual(row["name"] as String, "Pork Belly App")
        XCTAssertEqual(row["location_id"] as String, "default")
        XCTAssertEqual(row["cost_total"] as Double, 10)
        XCTAssertNotNil(row["cost_breakdown"] as String?)
        XCTAssertNil(row["archived_at"] as Int64?)
        XCTAssertNil(row["last_exported_at"] as Int64?)
    }

    func testCreateRejectsEmptyName() {
        var draft = validDraft()
        draft.name = "   "
        XCTAssertThrowsError(try repo.create(draft)) {
            XCTAssertEqual($0 as? SpecialsValidationError, .nameRequired)
        }
    }

    func testCreateRejectsEmptySessionContent() {
        let draft = SpecialDraft(name: "X")
        XCTAssertThrowsError(try repo.create(draft)) {
            XCTAssertEqual($0 as? SpecialsWriteError, .noSessionContent)
        }
    }

    func testCreateRejectsInvalidCostBreakdownJson() {
        var draft = validDraft()
        draft.costBreakdownJson = "not json at all"
        XCTAssertThrowsError(try repo.create(draft)) {
            XCTAssertEqual($0 as? SpecialsValidationError, .invalidJson(field: "cost_breakdown"))
        }
    }

    func testCreateHonorsLocationId() throws {
        let id = try repo.create(validDraft(), locationId: "food-truck")
        let row = try fetchOne("SELECT location_id FROM specials WHERE id = ?", [id])!
        XCTAssertEqual(row["location_id"] as String, "food-truck")
    }

    func testCreateWritesFileAuditLine() throws {
        let id = try repo.create(validDraft())
        let lines = try auditLines()
        XCTAssertEqual(lines.count, 1)
        XCTAssertEqual(lines[0]["action"] as? String, "specials.create")
        XCTAssertEqual(lines[0]["special_id"] as? String, id)
        XCTAssertEqual(lines[0]["name"] as? String, "Pork Belly App")
    }

    func testCreateClipsUserEditableFieldsButNotAiAnswer() throws {
        var draft = validDraft()
        draft.scratchNotes = String(repeating: "n", count: 4500)
        draft.pantryText = String(repeating: "p", count: 4500)
        draft.promptText = String(repeating: "q", count: 2500)
        draft.aiAnswer = String(repeating: "a", count: 10_000)
        let id = try repo.create(draft)
        let row = try fetchOne("SELECT * FROM specials WHERE id = ?", [id])!
        XCTAssertEqual((row["scratch_notes"] as String).count, 4000)
        XCTAssertEqual((row["pantry_text"] as String).count, 4000)
        XCTAssertEqual((row["prompt_text"] as String).count, 2000)
        XCTAssertEqual((row["ai_answer"] as String).count, 10_000)
    }

    // ── list ────────────────────────────────────────────────────────────────

    func testListReturnsActiveRowsNewestFirstWithSnippet() async throws {
        try writeDB.write { db in
            try db.execute(sql: """
                INSERT INTO specials (id, location_id, name, ai_answer, created_at, updated_at)
                VALUES ('a', 'default', 'Old', 'answer old', 100, 100),
                       ('b', 'default', 'New', 'answer new', 200, 200)
                """)
        }
        let items = try await repo.list()
        XCTAssertEqual(items.map(\.name), ["New", "Old"])
        XCTAssertLessThanOrEqual(items[0].snippet.count, 120)
    }

    func testListIsolatesByLocation() async throws {
        _ = try repo.create(validDraft(name: "A"), locationId: "a")
        _ = try repo.create(validDraft(name: "B"), locationId: "b")
        let items = try await repo.list(locationId: "a")
        XCTAssertEqual(items.map(\.name), ["A"])
    }

    func testListShowsPromotionBadgeJoin() async throws {
        try seedDefaultVendors()
        let id = try repo.create(costedDraft())
        _ = try repo.promote(id: id, menuItemName: "Lariat Belly Stack", servings: 2, context: context)
        let items = try await repo.list()
        XCTAssertEqual(items[0].promotedMenuItem, "Lariat Belly Stack")
        XCTAssertNotNil(items[0].promotedAt)
    }

    // ── get ─────────────────────────────────────────────────────────────────

    func testGetReturnsFullRecord() async throws {
        let id = try repo.create(validDraft())
        let got = try await repo.get(id: id)
        XCTAssertEqual(got?.special.name, "Pork Belly App")
        XCTAssertEqual(got?.special.aiAnswer, "Sear belly. Plate over slaw.")
        XCTAssertNil(got?.promotion)
    }

    func testGetReturnsNilForUnknownAndCrossLocation() async throws {
        let missing = try await repo.get(id: "missing")
        XCTAssertNil(missing)
        let id = try repo.create(validDraft(), locationId: "a")
        let wrongLocation = try await repo.get(id: id, locationId: "b")
        XCTAssertNil(wrongLocation)
    }

    // ── update ──────────────────────────────────────────────────────────────

    func testUpdatePatchesAllowedFieldsAndBumpsUpdatedAt() async throws {
        let id = try repo.create(validDraft())
        let before = try fetchOne("SELECT updated_at FROM specials WHERE id = ?", [id])!["updated_at"] as Int64
        try await Task.sleep(for: .milliseconds(5))
        try repo.update(id: id, name: "Renamed", scratchNotes: "hello")
        let row = try fetchOne("SELECT * FROM specials WHERE id = ?", [id])!
        XCTAssertEqual(row["name"] as String, "Renamed")
        XCTAssertEqual(row["scratch_notes"] as String, "hello")
        XCTAssertGreaterThan(row["updated_at"] as Int64, before)
    }

    func testUpdateRejectsEmptyPatch() throws {
        let id = try repo.create(validDraft())
        XCTAssertThrowsError(try repo.update(id: id)) {
            XCTAssertEqual($0 as? SpecialsWriteError, .noFieldsToUpdate)
        }
    }

    func testUpdateKeepsCapturedSessionFieldsImmutable() throws {
        // Native's typed API structurally rejects non-patchable fields — the
        // web's key filter is pinned in SpecialsValidatorsTests. Verify the
        // captured fields survive a rename.
        let id = try repo.create(validDraft())
        let before = try fetchOne("SELECT ai_answer, cost_total FROM specials WHERE id = ?", [id])!
        try repo.update(id: id, name: "X")
        let after = try fetchOne("SELECT ai_answer, cost_total FROM specials WHERE id = ?", [id])!
        XCTAssertEqual(after["ai_answer"] as String, before["ai_answer"] as String)
        XCTAssertEqual(after["cost_total"] as Double, before["cost_total"] as Double)
    }

    func testUpdateClipsScratchNotes() throws {
        let id = try repo.create(validDraft())
        try repo.update(id: id, scratchNotes: String(repeating: "n", count: 4500))
        let row = try fetchOne("SELECT scratch_notes FROM specials WHERE id = ?", [id])!
        XCTAssertEqual((row["scratch_notes"] as String).count, 4000)
    }

    func testUpdateNotFoundThrows() {
        XCTAssertThrowsError(try repo.update(id: "missing", name: "X")) {
            XCTAssertEqual($0 as? SpecialsWriteError, .notFound)
        }
    }

    func testUpdateWritesFileAuditLine() throws {
        let id = try repo.create(validDraft())
        try? FileManager.default.removeItem(atPath: auditPath)
        try repo.update(id: id, name: "Renamed")
        let lines = try auditLines()
        XCTAssertEqual(lines.last?["action"] as? String, "specials.update")
        XCTAssertEqual(lines.last?["special_id"] as? String, id)
        XCTAssertEqual(lines.last?["changed"] as? [String], ["name"])
    }

    // ── archive ─────────────────────────────────────────────────────────────

    func testArchiveSoftDeletesAndRemovesFromList() async throws {
        let id = try repo.create(validDraft())
        XCTAssertTrue(try repo.archive(id: id))
        let row = try fetchOne("SELECT archived_at FROM specials WHERE id = ?", [id])!
        XCTAssertNotNil(row["archived_at"] as Int64?)
        let items = try await repo.list()
        XCTAssertEqual(items.count, 0)
    }

    func testArchiveIsIdempotent() throws {
        let id = try repo.create(validDraft())
        XCTAssertTrue(try repo.archive(id: id))
        try? FileManager.default.removeItem(atPath: auditPath)
        XCTAssertFalse(try repo.archive(id: id))          // ok:true, no write
        XCTAssertEqual(try auditLines().count, 0)          // no second JSONL line
    }

    func testArchiveWritesFileAuditLine() throws {
        let id = try repo.create(validDraft())
        try? FileManager.default.removeItem(atPath: auditPath)
        _ = try repo.archive(id: id)
        let lines = try auditLines()
        XCTAssertEqual(lines.last?["action"] as? String, "specials.delete")
        XCTAssertEqual(lines.last?["special_id"] as? String, id)
    }

    // ── export ──────────────────────────────────────────────────────────────

    private var exportInput: SpecialsRepository.ExportInput {
        .init(slug: "pork-belly-app", yieldQty: 12, yieldUnit: "portions", category: "appetizer")
    }

    private func exportDraft() -> SpecialDraft {
        var draft = validDraft()
        draft.aiAnswer = "Sear belly.\n\n> [!NOTE]\n> ⚡ COMPUTED RECIPE COST: $10.00"
        draft.costBreakdownJson = """
            [{"item":"Pork Belly","req_qty":2,"req_unit":"lb","match":"Sysco Pork Belly Skin-On","pack_size":10,"pack_unit":"lb","pack_price":50,"cost":10},
             {"item":"Tomato (soft)","req_qty":0.5,"req_unit":"case","match":"","pack_size":null,"pack_unit":null,"pack_price":null,"cost":null}]
            """
        return draft
    }

    func testExportBuildsCsvWithRecipeAndIngredientSections() throws {
        let id = try repo.create(exportDraft())
        let result = try repo.export(id: id, input: exportInput)
        XCTAssertTrue(result.csv.hasPrefix("# RECIPE\n"))
        XCTAssertTrue(result.csv.contains("pork-belly-app"))
        XCTAssertTrue(result.csv.contains("\n\n# INGREDIENTS\n"))
        XCTAssertTrue(result.csv.contains("Pork Belly,2,lb,Sysco Pork Belly Skin-On,"))
        XCTAssertEqual(result.recipeRow.slug, "pork-belly-app")
        XCTAssertEqual(result.ingredientRows.count, 2)
        XCTAssertEqual(result.skipped.count, 1)
        XCTAssertEqual(result.skipped[0].ingredient, "Tomato (soft)")
    }

    func testExportStripsCostMarkdownWithoutOverride() throws {
        let id = try repo.create(exportDraft())
        let result = try repo.export(id: id, input: exportInput)
        XCTAssertEqual(result.recipeRow.procedure, "Sear belly.")
    }

    func testExportUsesProcedureOverride() throws {
        let id = try repo.create(exportDraft())
        var input = exportInput
        input.procedureOverride = "Custom procedure"
        let result = try repo.export(id: id, input: input)
        XCTAssertEqual(result.recipeRow.procedure, "Custom procedure")
    }

    func testExportUpdatesLastExportedAtEachTime() async throws {
        let id = try repo.create(exportDraft())
        _ = try repo.export(id: id, input: exportInput)
        let t1 = try fetchOne("SELECT last_exported_at FROM specials WHERE id = ?", [id])!["last_exported_at"] as Int64
        XCTAssertGreaterThan(t1, 0)
        try await Task.sleep(for: .milliseconds(5))
        _ = try repo.export(id: id, input: exportInput)
        let t2 = try fetchOne("SELECT last_exported_at FROM specials WHERE id = ?", [id])!["last_exported_at"] as Int64
        XCTAssertGreaterThan(t2, t1)
    }

    func testExportArchivedSpecialThrows410() throws {
        let id = try repo.create(exportDraft())
        _ = try repo.archive(id: id)
        XCTAssertThrowsError(try repo.export(id: id, input: exportInput)) {
            XCTAssertEqual($0 as? SpecialsWriteError, .archived)
        }
    }

    func testExportInvalidYieldQtyAndSlugThrow400() throws {
        let id = try repo.create(exportDraft())
        var badQty = exportInput
        badQty.yieldQty = 0
        XCTAssertThrowsError(try repo.export(id: id, input: badQty)) {
            XCTAssertEqual($0 as? SpecialsValidationError, .yieldQtyInvalid)
        }
        var badSlug = exportInput
        badSlug.slug = "Bad Slug"
        XCTAssertThrowsError(try repo.export(id: id, input: badSlug)) {
            XCTAssertEqual($0 as? SpecialsValidationError, .slugCharset)
        }
    }

    func testExportSlugCollisionThrows409() throws {
        try writeDB.write { db in
            try db.execute(sql: "INSERT INTO entities_recipes (slug, location_id) VALUES ('pork-belly-app', 'default')")
        }
        let id = try repo.create(exportDraft())
        XCTAssertThrowsError(try repo.export(id: id, input: exportInput)) {
            XCTAssertEqual($0 as? SpecialsWriteError, .slugExists("pork-belly-app"))
        }
    }

    func testExportToleratesMissingEntitiesRecipesTable() throws {
        try writeDB.write { db in
            try db.execute(sql: "DROP TABLE entities_recipes")
        }
        let id = try repo.create(exportDraft())
        XCTAssertNoThrow(try repo.export(id: id, input: exportInput))
    }

    func testExportWritesFileAuditLine() throws {
        let id = try repo.create(exportDraft())
        try? FileManager.default.removeItem(atPath: auditPath)
        _ = try repo.export(id: id, input: exportInput)
        let lines = try auditLines()
        XCTAssertEqual(lines.last?["action"] as? String, "specials.export")
        XCTAssertEqual(lines.last?["special_id"] as? String, id)
        XCTAssertEqual(lines.last?["slug"] as? String, "pork-belly-app")
    }

    // ── promote — happy path ────────────────────────────────────────────────

    func testPromoteWritesComponentsPromotionAndAuditRow() throws {
        try seedDefaultVendors()
        let id = try repo.create(costedDraft())

        let result = try repo.promote(id: id, menuItemName: "Lariat Belly Stack", servings: 2, context: context)
        XCTAssertFalse(result.repromoted)
        XCTAssertEqual(result.promotion.specialId, id)
        XCTAssertEqual(result.promotion.menuItemName, "Lariat Belly Stack")
        XCTAssertEqual(result.promotion.servings, 2)
        XCTAssertGreaterThan(result.promotion.promotedAt, 0)
        XCTAssertEqual(result.components.count, 2)
        XCTAssertEqual(result.skipped, [SkippedComponent(item: "micro greens", reason: .unmatched)])

        // dish_components: per-serving quantities under the canonical dish name.
        let canonical = DishCostBridge.normalizeDishName("Lariat Belly Stack")
        let rows = try readDB.pool.read { db in
            try Row.fetchAll(db,
                sql: "SELECT * FROM dish_components WHERE dish_name = ? ORDER BY vendor_ingredient",
                arguments: [canonical])
        }
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[0]["component_type"] as String, "vendor_item")
        XCTAssertEqual(rows[0]["vendor_ingredient"] as String, "BBQ SAUCE SWEET 1GAL")
        XCTAssertEqual(rows[0]["qty_per_serving"] as Double, 4)    // 8 oz / 2 servings
        XCTAssertEqual(rows[0]["unit"] as String, "oz")
        XCTAssertEqual(rows[1]["vendor_ingredient"] as String, "PORK BELLY SKIN-ON")
        XCTAssertEqual(rows[1]["qty_per_serving"] as Double, 2)    // 4 lb / 2 servings
        XCTAssertEqual(rows[1]["unit"] as String, "lb")
        XCTAssertEqual(rows[1]["location_id"] as String, "default")

        // Promotion record.
        let promo = try fetchOne("SELECT * FROM specials_promotions WHERE special_id = ?", [id])!
        XCTAssertEqual(promo["menu_item_name"] as String, "Lariat Belly Stack")
        XCTAssertEqual(promo["servings"] as Double, 2)
        XCTAssertEqual(PromotedComponent.parseComponentsJson(promo["components_json"] as String).count, 2)

        // Transactional audit_events row.
        let audits = try readDB.pool.read { db in
            try Row.fetchAll(db, sql: "SELECT * FROM audit_events WHERE entity = 'specials_promotion'")
        }
        XCTAssertEqual(audits.count, 1)
        XCTAssertEqual(audits[0]["action"] as String, "insert")
        XCTAssertEqual(audits[0]["actor_source"] as String, "native_mac")
        let payload = try JSONSerialization.jsonObject(
            with: Data((audits[0]["payload_json"] as String).utf8)) as! [String: Any]
        XCTAssertEqual(payload["special_id"] as? String, id)
        XCTAssertEqual(payload["menu_item_name"] as? String, "Lariat Belly Stack")
        XCTAssertEqual(payload["component_count"] as? Int, 2)
        XCTAssertEqual(payload["skipped_count"] as? Int, 1)

        // File-audit line (route parity, post-commit).
        let lines = try auditLines()
        XCTAssertEqual(lines.last?["action"] as? String, "specials.promote")
        XCTAssertEqual(lines.last?["special_id"] as? String, id)
    }

    func testPromoteDefaultsToSpecialNameAndOneServing() throws {
        try seedDefaultVendors()
        let id = try repo.create(costedDraft())
        let result = try repo.promote(id: id, context: context)
        XCTAssertEqual(result.promotion.menuItemName, "Pork Belly Stack")
        XCTAssertEqual(result.promotion.servings, 1)
        let canonical = DishCostBridge.normalizeDishName("Pork Belly Stack")
        let qty = try fetchOne(
            "SELECT qty_per_serving FROM dish_components WHERE dish_name = ? AND vendor_ingredient = 'PORK BELLY SKIN-ON'",
            [canonical])!["qty_per_serving"] as Double
        XCTAssertEqual(qty, 4)
    }

    func testPromoteAlignsToVendorPackUnitWithDensity() throws {
        try seedVendor("AP FLOUR", packUnit: "lb")
        try writeDB.write { db in
            try db.execute(sql: "INSERT INTO ingredient_densities (ingredient_key, g_per_ml, source) VALUES ('ap flour', 0.5, 'measured')")
        }
        var draft = costedDraft(name: "Buttermilk Bites")
        draft.costBreakdownJson = #"[{"item":"ap flour","req_qty":1,"req_unit":"cup","match":"AP FLOUR","cost":0.26}]"#
        draft.costTotal = 0.26
        let id = try repo.create(draft)

        let result = try repo.promote(id: id, menuItemName: "Buttermilk Bites", servings: 1, context: context)
        XCTAssertEqual(result.skipped, [])
        XCTAssertEqual(result.components.count, 1)
        XCTAssertEqual(result.components[0].vendorIngredient, "AP FLOUR")
        XCTAssertEqual(result.components[0].unit, "lb")
        XCTAssertEqual(result.components[0].qtyPerServing, 0.2607938891256041, accuracy: 1e-9)

        let canonical = DishCostBridge.normalizeDishName("Buttermilk Bites")
        let row = try fetchOne(
            "SELECT qty_per_serving, unit FROM dish_components WHERE dish_name = ? AND vendor_ingredient = 'AP FLOUR'",
            [canonical])!
        XCTAssertEqual(row["unit"] as String, "lb")
        XCTAssertEqual(row["qty_per_serving"] as Double, 0.2607938891256041, accuracy: 1e-9)
    }

    // ── promote — idempotent re-promote ─────────────────────────────────────

    func testRepromoteRefreshesInsteadOfDuplicating() throws {
        try seedDefaultVendors()
        let id = try repo.create(costedDraft())
        _ = try repo.promote(id: id, menuItemName: "Lariat Belly Stack", servings: 2, context: context)
        let result = try repo.promote(id: id, menuItemName: "Lariat Belly Stack", servings: 2, context: context)
        XCTAssertTrue(result.repromoted)

        let promoCount = try fetchOne("SELECT COUNT(*) AS c FROM specials_promotions")!["c"] as Int
        XCTAssertEqual(promoCount, 1)
        let canonical = DishCostBridge.normalizeDishName("Lariat Belly Stack")
        let dishCount = try fetchOne(
            "SELECT COUNT(*) AS c FROM dish_components WHERE dish_name = ?", [canonical])!["c"] as Int
        XCTAssertEqual(dishCount, 2)
        let actions = try readDB.pool.read { db in
            try String.fetchAll(db,
                sql: "SELECT action FROM audit_events WHERE entity = 'specials_promotion' ORDER BY id")
        }
        XCTAssertEqual(actions, ["insert", "update"])
    }

    func testRepromoteUnderNewNameMovesCostRows() throws {
        try seedDefaultVendors()
        let id = try repo.create(costedDraft())
        _ = try repo.promote(id: id, menuItemName: "Old Name", servings: 2, context: context)
        _ = try repo.promote(id: id, menuItemName: "New Name", servings: 4, context: context)

        let oldCount = try fetchOne(
            "SELECT COUNT(*) AS c FROM dish_components WHERE dish_name = ?",
            [DishCostBridge.normalizeDishName("Old Name")])!["c"] as Int
        XCTAssertEqual(oldCount, 0)

        let rows = try readDB.pool.read { db in
            try Row.fetchAll(db,
                sql: "SELECT * FROM dish_components WHERE dish_name = ? ORDER BY vendor_ingredient",
                arguments: [DishCostBridge.normalizeDishName("New Name")])
        }
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[1]["qty_per_serving"] as Double, 1)   // 4 lb / 4 servings

        let promo = try fetchOne("SELECT * FROM specials_promotions WHERE special_id = ?", [id])!
        XCTAssertEqual(promo["menu_item_name"] as String, "New Name")
        XCTAssertEqual(promo["servings"] as Double, 4)
    }

    // ── promote — location scoping ──────────────────────────────────────────

    func testPromoteScopesToLocationAnd404sCrossLocation() throws {
        try seedDefaultVendors(locationId: "loc-a")
        let id = try repo.create(costedDraft(), locationId: "loc-a")

        XCTAssertThrowsError(try repo.promote(id: id, servings: 1, locationId: "loc-b", context: context)) {
            XCTAssertEqual($0 as? SpecialsWriteError, .notFound)
        }

        _ = try repo.promote(id: id, menuItemName: "Belly A", servings: 1, locationId: "loc-a", context: context)
        let locations = try readDB.pool.read { db in
            try String.fetchAll(db, sql: "SELECT DISTINCT location_id FROM dish_components")
        }
        XCTAssertEqual(locations, ["loc-a"])
        XCTAssertEqual(
            try fetchOne("SELECT location_id FROM specials_promotions WHERE special_id = ?", [id])!["location_id"] as String,
            "loc-a")
    }

    // ── promote — failure modes ─────────────────────────────────────────────

    func testPromoteUnknownIdThrowsNotFound() {
        XCTAssertThrowsError(try repo.promote(id: "no-such-id", servings: 1, context: context)) {
            XCTAssertEqual($0 as? SpecialsWriteError, .notFound)
        }
    }

    func testPromoteArchivedThrows410() throws {
        try seedDefaultVendors()
        let id = try repo.create(costedDraft())
        _ = try repo.archive(id: id)
        XCTAssertThrowsError(try repo.promote(id: id, servings: 1, context: context)) {
            XCTAssertEqual($0 as? SpecialsWriteError, .archived)
        }
    }

    func testPromoteWithNoCostableComponentsThrows400AndWritesNothing() throws {
        var draft = costedDraft()
        draft.costBreakdownJson = #"[{"item":"micro greens","req_qty":1,"req_unit":"oz","cost":null,"note":"No vendor match"}]"#
        let id = try repo.create(draft)
        XCTAssertThrowsError(try repo.promote(id: id, servings: 1, context: context)) {
            XCTAssertEqual($0 as? SpecialsWriteError, .noCostableComponents)
        }
        XCTAssertEqual(try fetchOne("SELECT COUNT(*) AS c FROM specials_promotions")!["c"] as Int, 0)
        XCTAssertEqual(try fetchOne("SELECT COUNT(*) AS c FROM dish_components")!["c"] as Int, 0)
        XCTAssertEqual(try fetchOne("SELECT COUNT(*) AS c FROM audit_events")!["c"] as Int, 0)
    }

    func testPromoteInvalidServingsAndNameThrow400() throws {
        try seedDefaultVendors()
        let id = try repo.create(costedDraft())
        XCTAssertThrowsError(try repo.promote(id: id, servings: -2, context: context)) {
            XCTAssertEqual($0 as? SpecialsWriteError, .invalidServings)
        }
        XCTAssertThrowsError(try repo.promote(id: id, menuItemName: "   ", context: context)) {
            XCTAssertEqual($0 as? SpecialsValidationError, .nameRequired)
        }
    }

    // ── divergence assertions ───────────────────────────────────────────────

    /// Native has NO idempotency-key replay layer (web `withIdempotency`) —
    /// two identical creates insert two rows. Deliberate, documented.
    func testNoIdempotencyLayerTwoCreatesInsertTwoRows() throws {
        _ = try repo.create(validDraft())
        _ = try repo.create(validDraft())
        XCTAssertEqual(try fetchOne("SELECT COUNT(*) AS c FROM specials")!["c"] as Int, 2)
    }
}
