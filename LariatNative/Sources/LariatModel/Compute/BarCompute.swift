import Foundation

/// Pure port of the /bar pour-cost dashboard derivations (`app/bar/page.jsx`).
/// No I/O — the repository supplies `recipe_costs` rows and `BarRecipeLoader`
/// supplies recipes. Thresholds are authoritative in the web page:
/// industry-standard cocktail pour-cost target ~18 %, "out of whack" at 22 %.
public enum BarCompute {

    // ── thresholds (page.jsx L35-36) ────────────────────────────────────
    public static let pourCostGreenMax: Double = 18   // ≤ 18 % green
    public static let pourCostYellowMax: Double = 22  // 18–22 % yellow, > 22 % red

    /// Bar-category filter for /bar/par (bar/par/page.jsx L27) — lowercased,
    /// matched against `lower(category)`.
    public static let barParCategories = ["beer", "wine", "liquor", "spirit", "cocktail", "bar", "beverage"]

    // ── toneFor (L38-43) ────────────────────────────────────────────────
    public static func tone(for pct: Double?) -> BarTone {
        guard let pct, pct.isFinite else { return .gray }
        if pct > pourCostYellowMax { return .red }
        if pct > pourCostGreenMax { return .yellow }
        return .green
    }

    // ── isBarRecipe (L54-73) ────────────────────────────────────────────
    // Permissive OR: under-collecting is worse than over-collecting.
    private static let barCategoryRegex = try! NSRegularExpression(
        pattern: "cocktail|drink|beverage|spirit|liquor",
        options: [.caseInsensitive]
    )

    public static func isBarRecipe(_ r: BarRecipe) -> Bool {
        if let category = r.category {
            let range = NSRange(category.startIndex..., in: category)
            if barCategoryRegex.firstMatch(in: category, range: range) != nil { return true }
        }
        if r.slug.hasPrefix("cocktail_") || r.slug.hasPrefix("drink_") { return true }
        // Any object menu_items entry with numeric price > 0 → bar menu.
        if let items = r.menuItems, items.contains(where: { ($0.price ?? 0) > 0 }) {
            return true
        }
        return false
    }

    // ── firstMenuPrice (L78-86) ─────────────────────────────────────────
    // FIRST menu_item with a numeric price > 0; string entries carry none.
    public static func firstMenuPrice(_ r: BarRecipe) -> BarMenuItemRef? {
        for mi in r.menuItems ?? [] {
            if let price = mi.price, price > 0 { return mi }
        }
        return nil
    }

    // ── computePourCost (L89-113) ───────────────────────────────────────
    public static func computePourCost(
        costRow: BarCostRow?,
        recipe: BarRecipe,
        menuRef: BarMenuItemRef?
    ) -> Double? {
        guard let costRow else { return nil }
        guard let cpu = costRow.costPerYieldUnit, cpu.isFinite else { return nil }

        let yieldQty = costRow.yield ?? recipe.yieldQty
        let yieldUnit = (costRow.yieldUnit ?? recipe.yieldUnit ?? "").lowercased()

        if yieldUnit == "oz" {
            // Prefer an explicit menu pour size; otherwise assume the recipe
            // yield is one pour.
            let pourOz: Double?
            if let sizeOz = menuRef?.sizeOz, sizeOz.isFinite, sizeOz > 0 {
                pourOz = sizeOz
            } else if let yieldQty, yieldQty.isFinite, yieldQty > 0 {
                pourOz = yieldQty
            } else {
                pourOz = nil
            }
            if let pourOz { return cpu * pourOz }
        }
        if yieldUnit == "each" {
            return cpu
        }
        // qt/gal/ml/etc. — without a declared serves count we can't portion.
        return nil
    }

    // ── page row assembly (L139-177) ────────────────────────────────────
    public static func buildRows(recipes: [BarRecipe], costRows: [BarCostRow]) -> [BarPourCostRow] {
        var costByRecipe: [String: BarCostRow] = [:]
        for row in costRows { costByRecipe[row.recipeId] = row }

        let rows = recipes.filter(isBarRecipe).map { r -> BarPourCostRow in
            let costRow = costByRecipe[r.slug]
            let menuRef = firstMenuPrice(r)
            let costPerPour = computePourCost(costRow: costRow, recipe: r, menuRef: menuRef)
            let menuPrice = menuRef?.price
            let pourCostPct: Double?
            if let costPerPour, let menuPrice, menuPrice > 0 {
                pourCostPct = (costPerPour / menuPrice) * 100
            } else {
                pourCostPct = nil
            }
            // Why a gray row has no pour cost (L150-157).
            let grayReason: String?
            if pourCostPct != nil {
                grayReason = nil
            } else if costRow == nil {
                grayReason = "add recipe cost"
            } else if costPerPour == nil {
                grayReason = "yield not portionable"
            } else {
                grayReason = "add menu price"
            }
            return BarPourCostRow(
                slug: r.slug,
                name: r.name.isEmpty ? r.slug : r.name,
                category: r.category,
                costPerPour: costPerPour,
                menuPrice: menuPrice,
                pourCostPct: pourCostPct,
                grayReason: grayReason,
                tone: tone(for: pourCostPct)
            )
        }

        // Sort: red > yellow > green > gray, then pour_cost_pct desc within
        // each (L171-177). Stable, mirroring JS Array.prototype.sort.
        return rows.enumerated().sorted { a, b in
            let tr = a.element.tone.rank - b.element.tone.rank
            if tr != 0 { return tr < 0 }
            let ap = a.element.pourCostPct ?? -.infinity
            let bp = b.element.pourCostPct ?? -.infinity
            if ap != bp { return ap > bp }
            return a.offset < b.offset
        }.map(\.element)
    }

    // ── tone counts (L179-185) ──────────────────────────────────────────
    public static func toneCounts(_ rows: [BarPourCostRow]) -> [BarTone: Int] {
        var counts: [BarTone: Int] = [.red: 0, .yellow: 0, .green: 0, .gray: 0]
        for r in rows { counts[r.tone, default: 0] += 1 }
        return counts
    }
}
