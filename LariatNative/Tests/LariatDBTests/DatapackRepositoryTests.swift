import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Behavior parity with the lexical/direct-lookup/stats surface of
/// `lib/datapackSearch.ts` (`tests/js/test-datapack-search.mjs` /
/// `test-datapack-search-route.mjs`). The web tests skip on machines without
/// the SSD; here a small fixture datapack (same layout: `indexes/sqlite/`
/// source db + `indexes/search/fts/` FTS5 db) makes them deterministic.
final class DatapackRepositoryTests: XCTestCase {
    private var root: String!
    private var repo: DatapackRepository!

    override func setUpWithError() throws {
        root = NSTemporaryDirectory() + "lariat-datapack-" + UUID().uuidString
        let fm = FileManager.default
        try fm.createDirectory(atPath: root + "/indexes/sqlite", withIntermediateDirectories: true)
        try fm.createDirectory(atPath: root + "/indexes/search/fts", withIntermediateDirectories: true)
        let sqlitePath = root + "/indexes/sqlite/lariat_data.db"
        let ftsPath = root + "/indexes/search/fts/lariat_fts.db"

        let source = try DatabaseQueue(path: sqlitePath)
        try source.write { db in
            try db.execute(sql: """
                CREATE TABLE usda_foods (
                  fdc_id INTEGER PRIMARY KEY, data_type TEXT, source_archive TEXT,
                  description TEXT, food_category TEXT, food_category_id INTEGER,
                  brand_owner TEXT, gtin_upc TEXT, ingredients TEXT,
                  serving_size REAL, serving_size_unit TEXT);
                CREATE TABLE usda_nutrients (
                  fdc_id INTEGER, nutrient_id INTEGER, nutrient_name TEXT,
                  amount REAL, unit_name TEXT);
                CREATE TABLE off_products (
                  code TEXT PRIMARY KEY, product_name TEXT, brands TEXT, brand_owner TEXT,
                  ingredients_text TEXT, allergens_tags_json TEXT, traces_tags_json TEXT,
                  categories_tags_json TEXT, countries_en TEXT, nutriscore_grade TEXT,
                  serving_size TEXT, source_url TEXT);
                CREATE TABLE wikibooks_pages (
                  page_id INTEGER PRIMARY KEY, title TEXT, slug TEXT, source_url TEXT,
                  is_redirect INTEGER, redirect_target TEXT, plain_text_summary TEXT,
                  wikitext_length INTEGER, categories_json TEXT);
                CREATE TABLE fda_food_code_sections (
                  section_id TEXT, title TEXT, chapter TEXT, annex TEXT, body TEXT,
                  char_count INTEGER, page_start INTEGER, page_end INTEGER);
                CREATE TABLE off_allergens (code TEXT, tag TEXT);

                INSERT INTO usda_foods (fdc_id, description, food_category, source_archive)
                VALUES (171688, 'Apples, raw, with skin', 'Fruits', 'sr_legacy'),
                       (200001, 'Egg, whole, cooked, scrambled', 'Dairy and Egg Products', 'sr_legacy'),
                       (200002, 'Eggs, scrambled, frozen mixture', 'Dairy and Egg Products', 'fndds');
                INSERT INTO usda_nutrients (fdc_id, nutrient_id, nutrient_name, amount, unit_name)
                VALUES (171688, 1008, 'Energy', 52, 'kcal'),
                       (171688, 1003, 'Protein', 0.26, 'g'),
                       (171688, 1162, 'Vitamin C, total ascorbic acid', 4.6, 'mg');
                INSERT INTO off_products
                  (code, product_name, brands, brand_owner, ingredients_text,
                   allergens_tags_json, traces_tags_json)
                VALUES ('3017620422003', 'Nutella', 'Nutella', 'Ferrero',
                        'sugar, palm oil, hazelnuts, milk',
                        '["en:milk","en:nuts"]', '[]');
                INSERT INTO wikibooks_pages (page_id, title, slug, source_url, plain_text_summary)
                VALUES (99, 'Cookbook:Nutella', 'Cookbook:Nutella',
                        'https://en.wikibooks.org/wiki/Cookbook:Nutella',
                        'A hazelnut spread.');
                INSERT INTO fda_food_code_sections (section_id, title, chapter, body)
                VALUES ('3-501.13', 'Thawing', '3', 'TIME/TEMPERATURE CONTROL — thawing rules body.');
                """)
        }

        let fts = try DatabaseQueue(path: ftsPath)
        try fts.write { db in
            try db.execute(sql: """
                CREATE VIRTUAL TABLE usda_foods_fts USING fts5(description, food_category);
                CREATE VIRTUAL TABLE off_products_fts USING fts5(product_name, brands);
                CREATE TABLE off_products_codes (fts_rowid INTEGER PRIMARY KEY, code TEXT);
                CREATE VIRTUAL TABLE wikibooks_pages_fts USING fts5(title, body);
                CREATE VIRTUAL TABLE fda_food_code_sections_fts USING fts5(title, body);

                INSERT INTO usda_foods_fts (rowid, description, food_category)
                VALUES (171688, 'Apples, raw, with skin', 'Fruits'),
                       (200001, 'Egg, whole, cooked, scrambled', 'Dairy and Egg Products'),
                       (200002, 'Eggs, scrambled, frozen mixture', 'Dairy and Egg Products');
                INSERT INTO off_products_fts (rowid, product_name, brands)
                VALUES (1, 'Nutella', 'Nutella');
                INSERT INTO off_products_codes (fts_rowid, code) VALUES (1, '3017620422003');
                INSERT INTO wikibooks_pages_fts (rowid, title, body)
                VALUES (99, 'Cookbook:Nutella', 'A hazelnut spread recipe page.');
                INSERT INTO fda_food_code_sections_fts (rowid, title, body)
                VALUES (1, 'Thawing', 'TIME/TEMPERATURE CONTROL — thawing rules body.');
                """)
        }

        repo = DatapackRepository(dataRoot: root)
    }

    override func tearDownWithError() throws {
        repo = nil
        try? FileManager.default.removeItem(atPath: root)
    }

    // ── availability ────────────────────────────────────────────────────

    func testAvailableWithFixturePack() {
        XCTAssertTrue(repo.isAvailable)
        XCTAssertEqual(repo.dataRoot, root)
    }

    func testUnavailableIsGracefulNoOp() throws {
        let missing = DatapackRepository(dataRoot: nil)
        XCTAssertFalse(missing.isAvailable)
        XCTAssertEqual(try missing.fts("eggs"), [])
        XCTAssertNil(try missing.usdaFood(fdcId: 171688))
        XCTAssertNil(try missing.offProduct(code: "3017620422003"))
        XCTAssertNil(try missing.stats())

        // A root without the index files is also unavailable (web parity).
        let emptyRoot = NSTemporaryDirectory() + "lariat-datapack-empty-" + UUID().uuidString
        try FileManager.default.createDirectory(atPath: emptyRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(atPath: emptyRoot) }
        XCTAssertFalse(DatapackRepository(dataRoot: emptyRoot).isAvailable)
    }

    // ── fts ─────────────────────────────────────────────────────────────

    func testFtsUsdaHitsSortedByAscendingBm25() throws {
        let hits = try repo.fts(
            DatapackSearchCompute.escapeFtsPhrase("scrambled"), source: .usda, limit: 5)
        XCTAssertGreaterThan(hits.count, 0)
        XCTAssertEqual(hits[0].source, .usda)
        XCTAssertTrue((hits[0].title ?? "").lowercased().contains("scrambled"))
        for i in 1..<hits.count {
            XCTAssertLessThanOrEqual(hits[i - 1].score, hits[i].score, "sorted by ascending bm25")
        }
    }

    func testFtsAllMergesSourcesSorted() throws {
        let hits = try repo.fts(
            DatapackSearchCompute.escapeFtsPhrase("nutella"), source: .all, limit: 6)
        let sources = Set(hits.map(\.source))
        XCTAssertTrue(sources.contains(.off))
        XCTAssertTrue(sources.contains(.wikibooks))
        for i in 1..<hits.count {
            XCTAssertLessThanOrEqual(hits[i - 1].score, hits[i].score)
        }
    }

    func testFtsFdaSectionIdRidesInSubtitle() throws {
        let hits = try repo.fts(
            DatapackSearchCompute.escapeFtsPhrase("thawing"), source: .fda, limit: 5)
        XCTAssertGreaterThan(hits.count, 0)
        XCTAssertEqual(hits[0].source, .fda)
        XCTAssertTrue(hits.contains { ($0.subtitle ?? "").range(
            of: "^\\d-\\d+\\.\\d+$", options: .regularExpression) != nil })
    }

    func testFtsOffHitCarriesTextCode() throws {
        let hits = try repo.fts(
            DatapackSearchCompute.escapeFtsPhrase("nutella"), source: .off, limit: 5)
        XCTAssertEqual(hits.first?.hitId, "3017620422003")
    }

    func testFtsEmptyQueryReturnsEmpty() throws {
        XCTAssertEqual(try repo.fts(""), [])
        XCTAssertEqual(try repo.fts("   ", source: .usda), [])
    }

    func testFtsClampsLimit() throws {
        let big = try repo.fts(DatapackSearchCompute.escapeFtsPhrase("eggs"), source: .usda, limit: 500)
        XCTAssertLessThanOrEqual(big.count, 200)
        let small = try repo.fts(DatapackSearchCompute.escapeFtsPhrase("scrambled"), source: .usda, limit: 0)
        XCTAssertEqual(small.count, 1)   // clamped up to 1
    }

    func testFtsBadMatchSyntaxThrows() {
        // Raw (unescaped) broken FTS5 syntax — the route maps this to 400.
        XCTAssertThrowsError(try repo.fts("\"unbalanced", source: .usda))
    }

    // ── direct lookups ──────────────────────────────────────────────────

    func testUsdaFoodAndNutrients() throws {
        let food = try repo.usdaFood(fdcId: 171688)
        XCTAssertEqual(food?.fdcId, 171688)
        XCTAssertTrue((food?.description ?? "").lowercased().contains("apple"))
        let nutrients = try repo.usdaNutrients(fdcId: 171688)
        XCTAssertEqual(nutrients.count, 3)
        // ORDER BY nutrient_name.
        XCTAssertEqual(nutrients.map(\.nutrientName), ["Energy", "Protein", "Vitamin C, total ascorbic acid"])
    }

    func testOffProductByGtin() throws {
        let product = try repo.offProduct(code: "3017620422003")
        XCTAssertEqual(product?.code, "3017620422003")
        XCTAssertTrue((product?.brands ?? "").lowercased().contains("nutella"))
        XCTAssertEqual(AllergenLookupHelpers.parseAllergenTags(product?.allergensTagsJson),
                       ["en:milk", "en:nuts"])
    }

    func testFdaSectionBySectionIdAndRowid() throws {
        let section = try repo.fdaSection(sectionId: "3-501.13")
        XCTAssertEqual(section?.sectionId, "3-501.13")
        XCTAssertTrue((section?.title ?? "").lowercased().contains("thaw"))
        XCTAssertFalse(section?.body.isEmpty ?? true)
        let byRowid = try repo.fdaSection(rowid: section!.rowid)
        XCTAssertEqual(byRowid?.sectionId, "3-501.13")
    }

    func testWikibooksPageByTitleAndId() throws {
        let byTitle = try repo.wikibooksPage(title: "Cookbook:Nutella")
        XCTAssertEqual(byTitle?.title, "Cookbook:Nutella")
        let byId = try repo.wikibooksPage(pageId: 99)
        XCTAssertEqual(byId?.pageId, 99)
    }

    func testUnknownIdsReturnNil() throws {
        XCTAssertNil(try repo.usdaFood(fdcId: -1))
        XCTAssertNil(try repo.offProduct(code: "this-is-not-a-gtin"))
        XCTAssertNil(try repo.fdaSection(sectionId: "no-such-section"))
        XCTAssertNil(try repo.wikibooksPage(title: "no-such-page"))
    }

    // ── stats ───────────────────────────────────────────────────────────

    func testStatsReportsRowCountsAndFtsMirrors() throws {
        let stats = try repo.stats()
        XCTAssertEqual(stats?.sqlite["usda_foods"], 3)
        XCTAssertEqual(stats?.sqlite["off_products"], 1)
        XCTAssertEqual(stats?.sqlite["fda_food_code_sections"], 1)
        XCTAssertEqual(stats?.sqlite["off_allergens"], 0)
        // FTS row counts mirror SQLite for the indexed tables.
        XCTAssertEqual(stats?.fts["usda_foods_fts"], stats?.sqlite["usda_foods"])
        XCTAssertEqual(stats?.fts["fda_food_code_sections_fts"], stats?.sqlite["fda_food_code_sections"])
    }

}
