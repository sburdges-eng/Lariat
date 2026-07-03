import XCTest
@testable import LariatModel

/// The BEO recipe-tree feature: `RecipeTreeCatalog` reads
/// `beo_recipe_tree.json` and expands a menu item into its make-ahead tree —
/// in-house sub-recipes nested down to purchased ingredients, each with a prep
/// timing. Mirrors the Battered-Fish-Taco → Mexi-Slaw → Chipotle-Aioli shape.
final class RecipeTreeCatalogTests: XCTestCase {
    private var cache = ""

    override func setUpWithError() throws {
        cache = NSTemporaryDirectory() + "recipe-tree-fixture-" + UUID().uuidString
        try FileManager.default.createDirectory(atPath: cache, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(atPath: cache)
    }

    private func writeTree(_ json: String) throws {
        try json.write(
            toFile: (cache as NSString).appendingPathComponent("beo_recipe_tree.json"),
            atomically: true, encoding: .utf8
        )
    }

    private let fixture = """
    {
      "menu_items": {
        "battered fish taco": ["chipotle_aioli", "mexi_slaw"],
        "barbacoa taco": ["birria"]
      },
      "recipes": {
        "chipotle_aioli": {
          "name": "Chipotle Aioli", "station": "garde", "prep_timing": "day_before",
          "ingredients": [
            {"item": "mayonnaise", "qty": 900, "unit": "g", "recipe": null},
            {"item": "adobo puree", "qty": 150, "unit": "g", "recipe": null}
          ]
        },
        "mexi_slaw": {
          "name": "Mexi Slaw", "station": "garde", "prep_timing": "day_before",
          "ingredients": [
            {"item": "red cabbage", "qty": 5, "unit": "lb", "recipe": null},
            {"item": "chipotle aioli", "qty": 2, "unit": "cup", "recipe": "chipotle_aioli"}
          ]
        },
        "birria": {
          "name": "Birria", "station": "braise", "prep_timing": "overnight",
          "ingredients": [
            {"item": "beef cheeks", "qty": 1, "unit": "case", "recipe": null}
          ]
        }
      }
    }
    """

    func testExpandsNestedTreeToPurchasedLeaves() throws {
        try writeTree(fixture)
        let cat = RecipeTreeCatalog.load(cacheDir: cache)
        XCTAssertFalse(cat.isEmpty)

        let tree = cat.tree(for: "Battered Fish Taco")
        XCTAssertEqual(tree.map(\.name), ["Chipotle Aioli", "Mexi Slaw"])

        // Mexi Slaw nests Chipotle Aioli (in-house), and keeps red cabbage as a
        // purchased leaf.
        let slaw = try XCTUnwrap(tree.first { $0.slug == "mexi_slaw" })
        XCTAssertEqual(slaw.leaves.map(\.item), ["red cabbage"])
        XCTAssertEqual(slaw.children.map(\.name), ["Chipotle Aioli"])
        let aioli = try XCTUnwrap(slaw.children.first)
        XCTAssertEqual(aioli.leaves.map(\.item), ["mayonnaise", "adobo puree"])
        XCTAssertTrue(aioli.children.isEmpty)
    }

    func testTimingLabelsAndSummary() throws {
        try writeTree(fixture)
        let cat = RecipeTreeCatalog.load(cacheDir: cache)

        let birria = try XCTUnwrap(cat.tree(for: "Barbacoa Taco").first)
        XCTAssertEqual(birria.timing, .overnight)
        XCTAssertEqual(birria.timing.label, "Overnight")
        XCTAssertEqual(birria.leaves.first?.summary, "1 case beef cheeks")

        // Distinct timings across the fish-taco tree, earliest first.
        XCTAssertEqual(cat.timings(for: "Battered Fish Taco"), [.dayBefore])
    }

    func testNormalizationMatchesRegardlessOfCaseAndSpacing() throws {
        try writeTree(fixture)
        let cat = RecipeTreeCatalog.load(cacheDir: cache)
        XCTAssertEqual(cat.tree(for: "  BATTERED   Fish Taco ").map(\.name),
                       ["Chipotle Aioli", "Mexi Slaw"])
    }

    func testUnmappedItemYieldsEmptyTree() throws {
        try writeTree(fixture)
        let cat = RecipeTreeCatalog.load(cacheDir: cache)
        XCTAssertTrue(cat.tree(for: "Deviled Eggs").isEmpty)
    }

    func testMissingCacheIsEmpty() {
        let cat = RecipeTreeCatalog.load(cacheDir: cache)
        XCTAssertTrue(cat.isEmpty)
        XCTAssertTrue(cat.tree(for: "anything").isEmpty)
    }

    func testCyclicSubRecipeDoesNotRecurseForever() throws {
        // A → B → A must terminate (defensive; the ingest never emits cycles).
        try writeTree("""
        {"menu_items": {"loop item": ["a"]},
         "recipes": {
           "a": {"name":"A","station":"","prep_timing":"day_of",
                 "ingredients":[{"item":"b","qty":1,"unit":"ea","recipe":"b"}]},
           "b": {"name":"B","station":"","prep_timing":"day_of",
                 "ingredients":[{"item":"a","qty":1,"unit":"ea","recipe":"a"}]}
         }}
        """)
        let cat = RecipeTreeCatalog.load(cacheDir: cache)
        let a = try XCTUnwrap(cat.tree(for: "loop item").first)
        let b = try XCTUnwrap(a.children.first)
        XCTAssertEqual(b.name, "B")
        XCTAssertTrue(b.children.isEmpty, "the cycle back to A is cut")
    }
}
