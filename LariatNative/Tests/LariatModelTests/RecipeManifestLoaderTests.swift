// RecipeManifestLoaderTests — the real-CSV loader parity test that Wave A
// deferred (pork_chop_marinade loaded from recipes/*.csv must expand to the
// golden fixture leaves), plus BEO-map resolution and pack_size/pin parsing.

import XCTest
@testable import LariatModel

final class RecipeManifestLoaderTests: XCTestCase {

    private var repoRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()   // Tests/LariatModelTests
            .deletingLastPathComponent()   // Tests
            .deletingLastPathComponent()   // LariatNative
            .deletingLastPathComponent()   // repo root
    }
    private var recipeIndex: URL { repoRoot.appendingPathComponent("recipes/recipe_index.csv") }
    private var normalizedDir: URL { repoRoot.appendingPathComponent("recipes/normalized") }
    private var beoMapCSV: URL { repoRoot.appendingPathComponent("menus/beo_recipe_map.csv") }

    func testLoadsPorkChopMarinadeFromRealCsvs() throws {
        let manifest = try RecipeManifestLoader.loadManifest(recipeIndex: recipeIndex, normalizedDir: normalizedDir)
        XCTAssertNotNil(manifest["pork_chop_marinade"], "pork_chop_marinade should load")

        // The golden fixture was exported from these same CSVs; expanding the
        // real-CSV manifest at 2 gal must reproduce its leaves exactly.
        let fx = try BomExpandFixtures.load("pork_chop_marinade_2x")
        let out = try BomExpandCompute.expandRecipe(manifest, slug: "pork_chop_marinade", qty: 2, unit: "gal")
        let expected = fx.expect.leaves ?? []
        XCTAssertEqual(out.count, expected.count, "leaf count")
        for t in expected {
            guard let got = out[BomKey(t.name, t.unit)] else {
                XCTFail("missing leaf \(t.name)/\(t.unit)"); continue
            }
            XCTAssertEqual(got, t.value, accuracy: 1e-6, "\(t.name)/\(t.unit)")
        }
    }

    func testLoadBeoRecipeMapResolvesDisplayNamesAndScales() throws {
        let manifest = try RecipeManifestLoader.loadManifest(recipeIndex: recipeIndex, normalizedDir: normalizedDir)
        let (lookup, _, scales) = RecipeManifestLoader.loadBeoRecipeMap(csv: beoMapCSV, manifest: manifest)
        let key = "green chile mac buffet"
        XCTAssertTrue(lookup[key]?.contains("queso_mac_sauce") ?? false,
                      "\(key) should resolve the 'Queso / Mac Sauce' display name to queso_mac_sauce")
        XCTAssertEqual(scales[BeoScaleKey(nameKey: key, slug: "queso_mac_sauce")], 5.5,
                       "per_count 5.5 for the buffet mapping")
    }

    func testPackSizeAndSubRecipePinParsing() throws {
        // pack_size is absent from the real recipe_index; a synthetic CSV
        // exercises the `unit:factor:yield_unit` parse and the pin regex.
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("rml_\(UUID().uuidString)")
        let norm = tmp.appendingPathComponent("normalized")
        try FileManager.default.createDirectory(at: norm, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }

        try """
        recipe_id,recipe_name,yield,yield_unit,sub_recipes,pack_size
        queso,Queso,22,qt,green_chile,
        green_chile,Green Chile,6,qt,,bag:3:qt
        """.write(to: tmp.appendingPathComponent("recipe_index.csv"), atomically: true, encoding: .utf8)
        try """
        ingredient,qty,unit,portions_per_batch,notes
        green chile,1,bag,,(sub-recipe=green_chile)
        """.write(to: norm.appendingPathComponent("queso.csv"), atomically: true, encoding: .utf8)

        let manifest = try RecipeManifestLoader.loadManifest(
            recipeIndex: tmp.appendingPathComponent("recipe_index.csv"), normalizedDir: norm
        )
        XCTAssertEqual(manifest["green_chile"]?.packConversions["bag"]?.factor, 3.0, "pack factor")
        XCTAssertEqual(manifest["green_chile"]?.packConversions["bag"]?.yieldUnit, "qt", "pack yield unit")
        let row = manifest["queso"]?.bom.first
        XCTAssertEqual(row?.isSubRecipe, true, "(sub-recipe=…) sets isSubRecipe")
        XCTAssertEqual(row?.subSlug, "green_chile", "pin resolves subSlug")
    }
}
