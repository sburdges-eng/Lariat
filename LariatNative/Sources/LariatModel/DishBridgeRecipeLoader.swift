import Foundation

/// Loads the dish-cost bridge's discovery layer (`recipes.menu_items[]`) from
/// `data/cache/recipes.json` — the same source `lib/data.ts getRecipes()`
/// reads on the web. Follows the `StationCatalog.load()` precedent for cache
/// files; NOT in `Compute/` because it performs file I/O.
///
/// Web parity: `getRecipes()` returns `[]` when the cache file is missing or
/// malformed (its `load()` helper returns null on failure) — mirrored by
/// returning `[]` on any error rather than throwing.
public enum DishBridgeRecipeLoader {
    public static func load(
        env: [String: String] = ProcessInfo.processInfo.environment,
        cwd: String = FileManager.default.currentDirectoryPath
    ) -> [BridgeRecipe] {
        let cacheDir = resolveCacheDirectory(env: env, cwd: cwd)
        let path = (cacheDir as NSString).appendingPathComponent("recipes.json")
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
              let recipes = try? JSONDecoder().decode([BridgeRecipe].self, from: data)
        else { return [] }
        return recipes
    }
}
