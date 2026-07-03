import XCTest
@testable import LariatModel

/// Feature: the BEO menu dropdown auto-populates a line item's price + prep
/// fields. `CateringMenuCatalog.load` merges `catering_menu.json` (name /
/// category / cost) with the `catering_prep_defaults.json` sidecar (Pre-Prep →
/// prep_notes, Plating → secondary_prep_notes, Notes → order_items_notes),
/// matching on a normalized name key shared with the Python ingest.
final class CateringMenuCatalogTests: XCTestCase {
    private var cache = ""

    override func setUpWithError() throws {
        cache = NSTemporaryDirectory() + "catering-fixture-" + UUID().uuidString
        try FileManager.default.createDirectory(atPath: cache, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(atPath: cache)
    }

    private func write(_ name: String, _ json: String) throws {
        try json.write(
            toFile: (cache as NSString).appendingPathComponent(name),
            atomically: true, encoding: .utf8
        )
    }

    func testNormalizeMatchesIngestKey() {
        XCTAssertEqual(CateringMenuCatalog.normalize("  Braised Chicken   Taco Buffet "),
                       "braised chicken taco buffet")
        XCTAssertEqual(CateringMenuCatalog.normalize("Gazpacho"), "gazpacho")
    }

    func testMergesPrepAndAmountDefaultsByNormalizedName() throws {
        try write("catering_menu.json", """
        [{"category":"Buffet","name":"Braised Chicken Taco Buffet","cost":125.0},
         {"category":"Passed Apps","name":"Gazpacho","cost":5.0}]
        """)
        // Sidecar keyed by normalized name; note the trailing-space/case variety.
        try write("catering_prep_defaults.json", """
        {"braised chicken taco buffet":{"prep":"THAW THIGHS/COOK","plating":"2\\" HOTEL BUFFET","order":"order chicken thighs?","amount_desc":"per pan · typically 1 pan","typ_qty":1},
         "gazpacho":{"prep":"","plating":"","order":"","amount_desc":"per piece · typically 50 pieces","typ_qty":50}}
        """)

        let items = CateringMenuCatalog.load(cacheDir: cache)
        XCTAssertEqual(items.count, 2)
        let chicken = try XCTUnwrap(items.first { $0.name == "Braised Chicken Taco Buffet" })
        XCTAssertEqual(chicken.cost, 125.0)
        XCTAssertEqual(chicken.prepNotes, "THAW THIGHS/COOK")
        XCTAssertEqual(chicken.secondaryPrepNotes, "2\" HOTEL BUFFET")
        XCTAssertEqual(chicken.orderItemsNotes, "order chicken thighs?")
        XCTAssertEqual(chicken.amountDescription, "per pan · typically 1 pan")
        XCTAssertEqual(chicken.defaultQuantity, 1)
        XCTAssertTrue(chicken.hasPrepDefaults)

        // Amount-only item: no prep, but a description + typical quantity that
        // pre-fills the line so 50 pieces land, not 1.
        let gazpacho = try XCTUnwrap(items.first { $0.name == "Gazpacho" })
        XCTAssertEqual(gazpacho.cost, 5.0)
        XCTAssertTrue(gazpacho.prepNotes.isEmpty)
        XCTAssertFalse(gazpacho.hasPrepDefaults)
        XCTAssertEqual(gazpacho.amountDescription, "per piece · typically 50 pieces")
        XCTAssertEqual(gazpacho.defaultQuantity, 50)
    }

    func testDefaultQuantityFallsBackToOneForOlderSidecar() throws {
        try write("catering_menu.json", """
        [{"category":"Buffet","name":"Trio Dips","cost":30.0}]
        """)
        // Older prep-only sidecar (no amount fields) still decodes; qty → 1.
        try write("catering_prep_defaults.json", """
        {"trio dips":{"prep":"Queso/chips","plating":"basket","order":""}}
        """)
        let items = CateringMenuCatalog.load(cacheDir: cache)
        let dips = try XCTUnwrap(items.first)
        XCTAssertEqual(dips.defaultQuantity, 1)
        XCTAssertEqual(dips.amountDescription, "")
        XCTAssertEqual(dips.secondaryPrepNotes, "basket")
    }

    func testMissingSidecarLeavesBaseMenuIntact() throws {
        try write("catering_menu.json", """
        [{"category":"Buffet","name":"Trio Dips","cost":30.0}]
        """)
        let items = CateringMenuCatalog.load(cacheDir: cache)
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].cost, 30.0)
        XCTAssertFalse(items[0].hasPrepDefaults)
    }

    func testMissingMenuCacheYieldsEmpty() {
        XCTAssertTrue(CateringMenuCatalog.load(cacheDir: cache).isEmpty)
    }

    func testCorruptSidecarIsIgnored() throws {
        try write("catering_menu.json", """
        [{"category":"Buffet","name":"Trio Dips","cost":30.0}]
        """)
        try write("catering_prep_defaults.json", "{ not json")
        let items = CateringMenuCatalog.load(cacheDir: cache)
        XCTAssertEqual(items.count, 1)
        XCTAssertFalse(items[0].hasPrepDefaults)
    }
}
