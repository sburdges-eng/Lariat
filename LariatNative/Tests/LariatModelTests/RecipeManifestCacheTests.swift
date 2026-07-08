// RecipeManifestCacheTests — the mtime cache serves a cached manifest until a
// recipe CSV changes, then reloads (the "recipe updates without rebuild" path).

import XCTest
@testable import LariatModel

final class RecipeManifestCacheTests: XCTestCase {

    func testServesCacheUntilCsvsChange() throws {
        let fm = FileManager.default
        let tmp = fm.temporaryDirectory.appendingPathComponent("rmc_\(UUID().uuidString)")
        let norm = tmp.appendingPathComponent("normalized")
        try fm.createDirectory(at: norm, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tmp) }

        let index = tmp.appendingPathComponent("recipe_index.csv")
        try """
        recipe_id,recipe_name,yield,yield_unit,sub_recipes,pack_size
        queso,Queso,22,qt,,
        """.write(to: index, atomically: true, encoding: .utf8)
        let queso = norm.appendingPathComponent("queso.csv")
        try """
        ingredient,qty,unit,portions_per_batch,notes
        milk,4,qt,,
        """.write(to: queso, atomically: true, encoding: .utf8)

        let cache = RecipeManifestCache()
        let m1 = try cache.manifest(recipeIndex: index, normalizedDir: norm)
        let m2 = try cache.manifest(recipeIndex: index, normalizedDir: norm)
        XCTAssertEqual(cache.loadCount, 1, "second call must be served from cache")
        XCTAssertEqual(m1.count, 1)
        XCTAssertEqual(m2["queso"]?.bom.count, 1)

        // A newer mtime on recipe_index.csv invalidates the cache.
        try fm.setAttributes([.modificationDate: Date().addingTimeInterval(120)], ofItemAtPath: index.path)
        _ = try cache.manifest(recipeIndex: index, normalizedDir: norm)
        XCTAssertEqual(cache.loadCount, 2, "changed recipe_index must invalidate")

        // A newer mtime on a normalized CSV also invalidates.
        try fm.setAttributes([.modificationDate: Date().addingTimeInterval(240)], ofItemAtPath: queso.path)
        _ = try cache.manifest(recipeIndex: index, normalizedDir: norm)
        XCTAssertEqual(cache.loadCount, 3, "changed normalized csv must invalidate")
    }
}
