import Foundation

/// When a component is made, relative to the event.
public enum PrepTiming: String, Sendable, Equatable, Codable, Hashable {
    case overnight
    case dayBefore = "day_before"
    case dayOf = "day_of"

    /// Kitchen-facing label.
    public var label: String {
        switch self {
        case .overnight: return "Overnight"
        case .dayBefore: return "Day before"
        case .dayOf: return "Day of"
        }
    }

    /// Sort order — earliest prep first.
    public var order: Int {
        switch self {
        case .overnight: return 0
        case .dayBefore: return 1
        case .dayOf: return 2
        }
    }
}

/// A purchased leaf ingredient (not itself a recipe).
public struct RecipeLeafIngredient: Sendable, Equatable, Identifiable {
    public let id = UUID()
    public let item: String
    public let qty: Double
    public let unit: String

    public init(item: String, qty: Double, unit: String) {
        self.item = item
        self.qty = qty
        self.unit = unit
    }

    /// "5 lb red cabbage" / "red cabbage" when unquantified.
    public var summary: String {
        guard qty > 0 else { return item }
        let q = qty.rounded() == qty ? String(Int(qty)) : String(qty)
        return unit.isEmpty ? "\(q) \(item)" : "\(q) \(unit) \(item)"
    }
}

/// One node in a menu item's make-ahead tree: an in-house recipe, its purchased
/// ingredients, and any sub-recipes nested beneath it (Mexi Slaw → Chipotle
/// Aioli → mayo + adobo).
public struct RecipeTreeNode: Sendable, Equatable, Identifiable {
    public let id: String        // stable path (parent slugs + this slug)
    public let slug: String
    public let name: String
    public let station: String
    public let timing: PrepTiming
    public let leaves: [RecipeLeafIngredient]
    public let children: [RecipeTreeNode]

    public init(id: String, slug: String, name: String, station: String,
                timing: PrepTiming, leaves: [RecipeLeafIngredient], children: [RecipeTreeNode]) {
        self.id = id
        self.slug = slug
        self.name = name
        self.station = station
        self.timing = timing
        self.leaves = leaves
        self.children = children
    }
}

/// Loads `data/cache/beo_recipe_tree.json` (produced by
/// `scripts/ingest_beo_recipe_tree.py`) and builds the make-ahead tree for a
/// BEO line item. File I/O, so not in `Compute/`; missing/corrupt cache → an
/// empty catalog that yields no trees (the board falls back gracefully).
public struct RecipeTreeCatalog: Sendable {
    struct RawIngredient: Codable {
        let item: String
        let qty: Double
        let unit: String
        let recipe: String?
    }
    struct RawRecipe: Codable {
        let name: String
        let station: String
        let timing: PrepTiming
        let ingredients: [RawIngredient]

        enum CodingKeys: String, CodingKey {
            case name, station, ingredients
            case timing = "prep_timing"
        }
    }
    struct RawTree: Codable {
        let menuItems: [String: [String]]
        let recipes: [String: RawRecipe]
        enum CodingKeys: String, CodingKey {
            case menuItems = "menu_items"
            case recipes
        }
    }

    private let menuItems: [String: [String]]
    private let recipes: [String: RawRecipe]

    init(menuItems: [String: [String]], recipes: [String: RawRecipe]) {
        self.menuItems = menuItems
        self.recipes = recipes
    }

    public static func load(
        env: [String: String] = ProcessInfo.processInfo.environment,
        cwd: String = FileManager.default.currentDirectoryPath
    ) -> RecipeTreeCatalog {
        load(cacheDir: resolveCacheDirectory(env: env, cwd: cwd))
    }

    /// Testable core.
    public static func load(cacheDir: String) -> RecipeTreeCatalog {
        let path = (cacheDir as NSString).appendingPathComponent("beo_recipe_tree.json")
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
              let raw = try? JSONDecoder().decode(RawTree.self, from: data)
        else { return RecipeTreeCatalog(menuItems: [:], recipes: [:]) }
        return RecipeTreeCatalog(menuItems: raw.menuItems, recipes: raw.recipes)
    }

    public var isEmpty: Bool { menuItems.isEmpty }

    /// Match key shared with the Python ingest.
    static func normalize(_ name: String) -> String {
        name.lowercased()
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
    }

    /// The top-level component recipes for a BEO line item, each fully
    /// expanded. `[]` when the item isn't mapped (self-mapped items with no
    /// component breakdown, or off-menu items).
    public func tree(for menuItemName: String) -> [RecipeTreeNode] {
        guard let slugs = menuItems[Self.normalize(menuItemName)] else { return [] }
        return slugs.compactMap { node(slug: $0, path: "", seen: []) }
    }

    /// Every distinct timing present in an item's tree — powers the summary
    /// chips ("Overnight · Day before").
    public func timings(for menuItemName: String) -> [PrepTiming] {
        var set: Set<PrepTiming> = []
        func walk(_ n: RecipeTreeNode) { set.insert(n.timing); n.children.forEach(walk) }
        tree(for: menuItemName).forEach(walk)
        return set.sorted { $0.order < $1.order }
    }

    private func node(slug: String, path: String, seen: Set<String>) -> RecipeTreeNode? {
        guard let r = recipes[slug], !seen.contains(slug) else { return nil }
        let id = path.isEmpty ? slug : "\(path)/\(slug)"
        let nextSeen = seen.union([slug])
        var leaves: [RecipeLeafIngredient] = []
        var children: [RecipeTreeNode] = []
        for ing in r.ingredients {
            if let sub = ing.recipe, let child = node(slug: sub, path: id, seen: nextSeen) {
                children.append(child)
            } else {
                leaves.append(RecipeLeafIngredient(item: ing.item, qty: ing.qty, unit: ing.unit))
            }
        }
        return RecipeTreeNode(
            id: id, slug: slug, name: r.name, station: r.station,
            timing: r.timing, leaves: leaves, children: children
        )
    }
}
