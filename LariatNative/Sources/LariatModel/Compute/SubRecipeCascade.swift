import Foundation

/// Recipe unavailable because a sub-recipe was 86'd — mirrors `lib/subRecipeGraph.ts`.
public struct CascadedRecipe: Equatable, Sendable {
    public let slug: String
    public let name: String
    public let via: String
    public let rootSlug: String

    public init(slug: String, name: String, via: String, rootSlug: String) {
        self.slug = slug
        self.name = name
        self.via = via
        self.rootSlug = rootSlug
    }
}

public enum SubRecipeCascadeCompute {
    /// Port of `cascadedFromEightySix(itemsEightySixed, recipes)`.
    public static func cascadedFromEightySix(
        itemsEightySixed: [String],
        recipes: [RecipeCatalogEntry]
    ) -> [CascadedRecipe] {
        guard !itemsEightySixed.isEmpty, !recipes.isEmpty else { return [] }
        let parents = buildParentIndex(recipes: recipes)
        let bySlug = Dictionary(uniqueKeysWithValues: recipes.map { ($0.slug, $0) })
        var out: [String: CascadedRecipe] = [:]

        for item in itemsEightySixed where !item.isEmpty {
            let rootSlugs = recipes.filter { itemMatchesRecipe(item: item, recipe: $0) }.map(\.slug)
            guard !rootSlugs.isEmpty else { continue }

            for rootSlug in rootSlugs {
                var queue = [rootSlug]
                var visited: Set<String> = [rootSlug]
                while !queue.isEmpty {
                    let cur = queue.removeFirst()
                    guard let curParents = parents[cur] else { continue }
                    for parent in curParents where !visited.contains(parent) {
                        visited.insert(parent)
                        queue.append(parent)
                    }
                }
                visited.remove(rootSlug)

                for slug in visited {
                    guard out[slug] == nil, let recipe = bySlug[slug] else { continue }
                    out[slug] = CascadedRecipe(slug: slug, name: recipe.name, via: item, rootSlug: rootSlug)
                }
            }
        }
        return Array(out.values)
    }

    private static func buildParentIndex(recipes: [RecipeCatalogEntry]) -> [String: Set<String>] {
        var parents: [String: Set<String>] = [:]
        for recipe in recipes {
            for child in recipe.subRecipes ?? [] {
                parents[child, default: []].insert(recipe.slug)
            }
        }
        return parents
    }

    /// Mirrors `lib/subRecipeGraph.ts` `tokens()` — ASCII `[a-z0-9]` only; accents are separators.
    private static let asciiAlphanumeric = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789")

    private static func tokens(_ s: String?) -> [String] {
        guard let s, !s.isEmpty else { return [] }
        return s
            .lowercased()
            .replacingOccurrences(of: "_", with: " ")
            .components(separatedBy: asciiAlphanumeric.inverted)
            .filter { !$0.isEmpty }
    }

    private static func subsetOf(_ a: [String], _ b: [String]) -> Bool {
        guard !a.isEmpty else { return false }
        let bSet = Set(b)
        return a.allSatisfy { bSet.contains($0) }
    }

    private static func itemMatchesRecipe(item: String, recipe: RecipeCatalogEntry) -> Bool {
        let slugForm = item.trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "[^a-z0-9]+", with: "_", options: .regularExpression)
        if slugForm == recipe.slug { return true }

        let itemToks = tokens(item)
        guard !itemToks.isEmpty else { return false }
        let nameToks = tokens(recipe.name)
        let slugToks = tokens(recipe.slug)
        if itemToks.count == nameToks.count,
           subsetOf(itemToks, nameToks),
           subsetOf(nameToks, itemToks) { return true }
        if subsetOf(itemToks, nameToks) { return true }
        if subsetOf(itemToks, slugToks) { return true }
        return false
    }
}
