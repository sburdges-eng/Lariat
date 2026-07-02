import Foundation
import GRDB

// Record types for the /bar surface (A6.2) — parity with `app/bar/page.jsx`
// and `app/bar/par/page.jsx`. Money columns here are REAL on the web schema
// (`recipe_costs.cost_per_yield_unit`, `batch_cost`) and menu prices are JSON
// numbers in recipes.json → all `Double` (dollars), never cents.

/// One `menu_items[]` entry from `data/cache/recipes.json`.
///
/// The web shape is `string[]` today with a forward-spec of
/// `{name, price, size_oz}[]` (page.jsx L65-66). A bare string decodes as
/// `name` with no price; an object decodes its fields, ignoring non-numeric
/// prices exactly like the web's `typeof mi.price === 'number'` check.
public struct BarMenuItemRef: Codable, Sendable, Equatable {
    public let name: String?
    public let price: Double?
    public let sizeOz: Double?

    public init(name: String?, price: Double?, sizeOz: Double?) {
        self.name = name
        self.price = price
        self.sizeOz = sizeOz
    }

    enum CodingKeys: String, CodingKey {
        case name, price
        case sizeOz = "size_oz"
    }

    public init(from decoder: Decoder) throws {
        if let single = try? decoder.singleValueContainer(), let s = try? single.decode(String.self) {
            self.name = s
            self.price = nil
            self.sizeOz = nil
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.name = try? c.decodeIfPresent(String.self, forKey: .name)
        // `typeof mi.price === 'number'` — a string price is ignored, not coerced.
        self.price = try? c.decodeIfPresent(Double.self, forKey: .price)
        self.sizeOz = try? c.decodeIfPresent(Double.self, forKey: .sizeOz)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(name, forKey: .name)
        try c.encodeIfPresent(price, forKey: .price)
        try c.encodeIfPresent(sizeOz, forKey: .sizeOz)
    }
}

/// `lib/data.ts Recipe` subset the /bar dashboard needs. Wider than
/// `BridgeRecipe` (which only carries slug/name/menu_items) because pour-cost
/// derivation also reads category + yield.
public struct BarRecipe: Codable, Sendable, Equatable {
    public let slug: String
    public let name: String
    public let category: String?
    public let yieldQty: Double?
    public let yieldUnit: String?
    public let menuItems: [BarMenuItemRef]?

    enum CodingKeys: String, CodingKey {
        case slug, name, category
        case yieldQty = "yield_qty"
        case yieldUnit = "yield_unit"
        case menuItems = "menu_items"
    }

    public init(slug: String, name: String, category: String?,
                yieldQty: Double?, yieldUnit: String?, menuItems: [BarMenuItemRef]?) {
        self.slug = slug
        self.name = name
        self.category = category
        self.yieldQty = yieldQty
        self.yieldUnit = yieldUnit
        self.menuItems = menuItems
    }
}

/// `recipe_costs` row subset (`SELECT recipe_id, cost_per_yield_unit,
/// batch_cost, yield, yield_unit` — page.jsx L129-135).
public struct BarCostRow: Sendable, Equatable, FetchableRecord {
    public let recipeId: String
    public let costPerYieldUnit: Double?
    public let batchCost: Double?
    public let yield: Double?
    public let yieldUnit: String?

    public init(recipeId: String, costPerYieldUnit: Double?, batchCost: Double?,
                yield: Double?, yieldUnit: String?) {
        self.recipeId = recipeId
        self.costPerYieldUnit = costPerYieldUnit
        self.batchCost = batchCost
        self.yield = yield
        self.yieldUnit = yieldUnit
    }

    public init(row: Row) {
        recipeId = row["recipe_id"]
        costPerYieldUnit = row["cost_per_yield_unit"]
        batchCost = row["batch_cost"]
        yield = row["yield"]
        yieldUnit = row["yield_unit"]
    }
}

/// Pour-cost tone — parity with `toneFor` + `TONE_RANK` (page.jsx L38-52).
public enum BarTone: String, Sendable, Equatable, CaseIterable {
    case red, yellow, green, gray

    /// Sort rank: red 0 < yellow 1 < green 2 < gray 3.
    public var rank: Int {
        switch self {
        case .red: return 0
        case .yellow: return 1
        case .green: return 2
        case .gray: return 3
        }
    }
}

/// One dashboard row (page.jsx L158-167).
public struct BarPourCostRow: Sendable, Equatable, Identifiable {
    public let slug: String
    public let name: String
    public let category: String?
    public let costPerPour: Double?
    public let menuPrice: Double?
    public let pourCostPct: Double?
    public let grayReason: String?
    public let tone: BarTone

    public var id: String { slug }

    public init(slug: String, name: String, category: String?, costPerPour: Double?,
                menuPrice: Double?, pourCostPct: Double?, grayReason: String?, tone: BarTone) {
        self.slug = slug
        self.name = name
        self.category = category
        self.costPerPour = costPerPour
        self.menuPrice = menuPrice
        self.pourCostPct = pourCostPct
        self.grayReason = grayReason
        self.tone = tone
    }
}

/// One /bar/par row — the inventory_par ⟕ latest-count join scoped to the
/// beverage categories (bar/par/page.jsx L57-84).
public struct BarParRow: Sendable, Equatable, Identifiable, FetchableRecord {
    public let id: Int64
    public let vendor: String?
    public let ingredient: String
    public let sku: String?
    public let parQty: Double?
    public let parUnit: String?
    public let packSize: String?
    public let packUnit: String?
    public let category: String?
    public let onHandQty: Double?
    public let onHandUnit: String?
    public let countedAt: String?
    public let countedBy: String?

    /// Below par — `par_qty != null && on_hand_qty != null && on_hand < par`
    /// (bar/par/page.jsx L86-91). Never-counted rows are NOT low.
    public var isLow: Bool {
        guard let parQty, let onHandQty else { return false }
        return onHandQty < parQty
    }

    public init(id: Int64, vendor: String?, ingredient: String, sku: String?,
                parQty: Double?, parUnit: String?, packSize: String?, packUnit: String?,
                category: String?, onHandQty: Double?, onHandUnit: String?,
                countedAt: String?, countedBy: String?) {
        self.id = id
        self.vendor = vendor
        self.ingredient = ingredient
        self.sku = sku
        self.parQty = parQty
        self.parUnit = parUnit
        self.packSize = packSize
        self.packUnit = packUnit
        self.category = category
        self.onHandQty = onHandQty
        self.onHandUnit = onHandUnit
        self.countedAt = countedAt
        self.countedBy = countedBy
    }

    public init(row: Row) {
        id = row["id"]
        vendor = row["vendor"]
        ingredient = row["ingredient"]
        sku = row["sku"]
        parQty = row["par_qty"]
        parUnit = row["par_unit"]
        packSize = row["pack_size"]
        packUnit = row["pack_unit"]
        category = row["category"]
        onHandQty = row["on_hand_qty"]
        onHandUnit = row["on_hand_unit"]
        countedAt = row["counted_at"]
        countedBy = row["counted_by"]
    }
}

/// Loads `data/cache/recipes.json` for the bar dashboard — same source
/// `lib/data.ts getRecipes()` reads on the web; follows the
/// `DishBridgeRecipeLoader` precedent (file I/O, so NOT in `Compute/`).
/// Web parity: `getRecipes()` returns `[]` when the cache file is missing
/// or malformed.
public enum BarRecipeLoader {
    public static func load(
        env: [String: String] = ProcessInfo.processInfo.environment,
        cwd: String = FileManager.default.currentDirectoryPath
    ) -> [BarRecipe] {
        let cacheDir = resolveCacheDirectory(env: env, cwd: cwd)
        let path = (cacheDir as NSString).appendingPathComponent("recipes.json")
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
              let recipes = try? JSONDecoder().decode([BarRecipe].self, from: data)
        else { return [] }
        return recipes
    }
}
