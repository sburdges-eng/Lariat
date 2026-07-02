import Foundation

// GRDB-free port of the dish → recipe → ingredient → vendor cost bridge:
//   lib/dishCostBridge.ts   → normalizeDishName, buildDishComponentMap,
//                             computeDishCost, cleanedSalesRows, computeDishCoverage
//   lib/menuEngineering.ts  → computeMenuEngineering (bridged variant with
//                             link_state + components + coverage)
//
// All inputs are caller-supplied value types; no I/O is performed here. The
// repository runs the SELECTs the web module embeds:
//   - recipeCosts     ← recipe_costs WHERE location_id=? AND recipe_id != 'TOTAL'
//   - vendorPrices    ← the latest-imported_at join over vendor_prices
//   - orderGuideItems ← order_guide_items WHERE COALESCE(is_placeholder,0)=0
//   - dishComponents  ← dish_components WHERE location_id=?
//   - recipes         ← data/cache/recipes.json (lib/data.ts getRecipes())
//
// Unit conversion reuses `UnitConvert.convertQty` (the existing byte-exact
// port of lib/unitConvert.mjs) with gPerMl=nil, exactly as the web bridge
// calls `convertQty(qty, unit, base_unit, null)`.

// MARK: - Input row types

/// `lib/data.ts Recipe` subset the bridge needs (slug, name, menu_items[]).
/// Codable with snake_case keys so `DishBridgeRecipeLoader` can decode
/// `data/cache/recipes.json` directly.
public struct BridgeRecipe: Codable, Sendable, Equatable {
    public let slug: String
    public let name: String
    public let menuItems: [String]?

    enum CodingKeys: String, CodingKey {
        case slug, name
        case menuItems = "menu_items"
    }

    public init(slug: String, name: String, menuItems: [String]?) {
        self.slug = slug; self.name = name; self.menuItems = menuItems
    }
}

/// `recipe_costs` row subset (lib/db.ts RecipeCost).
public struct BridgeRecipeCost: Sendable, Equatable {
    public let recipeId: String
    public let recipeName: String?
    public let costPerYieldUnit: Double?
    public let yieldUnit: String?

    public init(recipeId: String, recipeName: String?, costPerYieldUnit: Double?, yieldUnit: String?) {
        self.recipeId = recipeId; self.recipeName = recipeName
        self.costPerYieldUnit = costPerYieldUnit; self.yieldUnit = yieldUnit
    }
}

/// Vendor pricing lookup row — either a `vendor_prices` latest row or an
/// `order_guide_items` fallback row (`unit AS pack_unit`).
public struct BridgeVendorPrice: Sendable, Equatable {
    public let ingredient: String
    public let unitPrice: Double?
    public let packUnit: String?

    public init(ingredient: String, unitPrice: Double?, packUnit: String?) {
        self.ingredient = ingredient; self.unitPrice = unitPrice; self.packUnit = packUnit
    }
}

/// `dish_components` row subset the bridge consumes.
public struct BridgeDishComponent: Sendable, Equatable {
    public let dishName: String
    public let componentType: String        // "recipe" | "vendor_item"
    public let recipeSlug: String?
    public let vendorIngredient: String?
    public let qtyPerServing: Double?
    public let unit: String?

    public init(dishName: String, componentType: String, recipeSlug: String?,
                vendorIngredient: String?, qtyPerServing: Double?, unit: String?) {
        self.dishName = dishName; self.componentType = componentType
        self.recipeSlug = recipeSlug; self.vendorIngredient = vendorIngredient
        self.qtyPerServing = qtyPerServing; self.unit = unit
    }
}

/// Aggregated sales row (`SELECT item_name, SUM(quantity_sold) qty, SUM(net_sales) rev`).
public struct BridgeSalesRow: Sendable, Equatable {
    public let itemName: String
    public let qty: Double
    public let rev: Double

    public init(itemName: String, qty: Double, rev: Double) {
        self.itemName = itemName; self.qty = qty; self.rev = rev
    }
}

// MARK: - Output types

/// Mirrors `DishComponentResolved['status']` in lib/dishCostBridge.ts.
public enum DishComponentStatus: String, Sendable, Equatable {
    case ok
    case noDishComponent = "no_dish_component"
    case noRecipeCost = "no_recipe_cost"
    case noVendorPrice = "no_vendor_price"
    case unitConvertFailed = "unit_convert_failed"
}

/// Mirrors `DishCostResult['link_state']`.
public enum DishLinkState: String, Sendable, Equatable {
    case unlinked
    case declaredOnly = "declared_only"
    case partial
    case fullyLinked = "fully_linked"
}

public struct DishComponentResolved: Sendable, Equatable {
    public let componentType: String        // "recipe" | "vendor_item"
    public let recipeSlug: String?
    public let vendorIngredient: String?
    public let displayName: String
    public let qtyPerServing: Double?       // nil = no dish_components row yet
    public let unit: String?
    public let unitPrice: Double?
    public let baseUnit: String?
    public let perServingCost: Double?
    public let status: DishComponentStatus
}

public struct DishCostResult: Sendable {
    public let dishName: String
    public let dishNameNormalized: String
    public let components: [DishComponentResolved]
    public let totalCost: Double?
    public let fullyCosted: Bool
    public let linkState: DishLinkState
}

/// Mirrors `DishCoverageReport` in lib/dishCostBridge.ts.
public struct DishCoverageReport: Sendable {
    public struct UnlinkedDish: Sendable, Equatable {
        public let itemName: String
        public let qty: Double
        public let netSales: Double
    }
    public struct DeclaredOnlyDish: Sendable, Equatable {
        public let itemName: String
        public let componentCount: Int
    }

    public let totalSalesDishes: Int
    public let fullyLinked: Int
    public let partial: Int
    public let declaredOnly: Int
    public let unlinked: Int
    public let unlinkedDishes: [UnlinkedDish]
    public let declaredOnlyDishes: [DeclaredOnlyDish]
}

/// Full menu-engineering row (lib/menuEngineering.ts MenuEngineeringRow) —
/// the bridged variant that also carries link_state + components. `Quadrant`
/// is shared with `CostingCompute` (identical classification thresholds).
/// Not `Sendable` because `Quadrant` isn't (matches the `CostingBundle` /
/// `MenuEngineeringResult` precedent).
public struct BridgedMenuEngineeringRow {
    public let itemName: String
    public let qty: Double
    public let netSales: Double
    public let avgPrice: Double
    public let costPerUnit: Double?
    public let marginPct: Double?
    public let popularity: Double
    public let quadrant: Quadrant
    public let linkState: DishLinkState
    public let components: [DishComponentResolved]
}

public struct BridgedMenuEngineeringCoverage: Sendable, Equatable {
    public let fullyLinked: Int
    public let partial: Int
    public let declaredOnly: Int
    public let unlinked: Int
    public let total: Int

    public init(fullyLinked: Int, partial: Int, declaredOnly: Int, unlinked: Int, total: Int) {
        self.fullyLinked = fullyLinked; self.partial = partial
        self.declaredOnly = declaredOnly; self.unlinked = unlinked; self.total = total
    }
}

public struct BridgedMenuEngineeringResult {
    public let rows: [BridgedMenuEngineeringRow]
    public let medianMargin: Double
    public let medianPop: Double
    public let coverage: BridgedMenuEngineeringCoverage
}

// MARK: - Compute

public enum DishCostBridge {

    static let salesNoiseDishNames: Set<String> = ["total", "totals"]

    // MARK: normalizeDishName
    //
    // Lowercase, collapse non-alphanumerics ([^a-z0-9]+) to a single space,
    // trim. The "&"/"and" gap is intentionally NOT closed (per-dish alias
    // decision — web comment L40-48).
    public static func normalizeDishName(_ s: String?) -> String {
        guard let s, !s.isEmpty else { return "" }
        var out = ""
        var pendingSpace = false
        for ch in s.lowercased() {
            if ("a"..."z").contains(ch) || ("0"..."9").contains(ch) {
                if pendingSpace && !out.isEmpty { out.append(" ") }
                pendingSpace = false
                out.append(ch)
            } else {
                pendingSpace = true
            }
        }
        return out
    }

    // MARK: cleanedSalesRows
    //
    // Drops literal 'TOTAL' / 'TOTALS' Toast CSV footer rows and empty /
    // whitespace-only item names (web L383-388).
    public static func cleanedSalesRows(_ rows: [BridgeSalesRow]) -> [BridgeSalesRow] {
        rows.filter { r in
            let k = r.itemName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            return !k.isEmpty && !salesNoiseDishNames.contains(k)
        }
    }

    // MARK: buildDishComponentMap
    //
    // Two-stage bridge (web L107-298):
    //   Stage 1 — declared recipe links from recipes.menu_items[] (discovery).
    //   Stage 2 — dish_components rows overlay (authoritative once populated;
    //             JS Map.set replaces the value but keeps insertion position,
    //             mirrored here by the ordered per-dish component list).
    //   Stage 3 — per-component cost resolution.
    //
    // Vendor index precedence: vendorPrices rows first (later rows overwrite,
    // mirroring JS Map.set), then orderGuideItems only where absent. The
    // latest-imported_at pick and the is_placeholder skip happen in the
    // repository SQL, exactly where the web module embeds them.
    public static func buildDishComponentMap(
        recipes: [BridgeRecipe],
        recipeCosts: [BridgeRecipeCost],
        vendorPrices: [BridgeVendorPrice],
        orderGuideItems: [BridgeVendorPrice],
        dishComponents: [BridgeDishComponent]
    ) -> [String: [DishComponentResolved]] {

        // ── Recipe pricing index (web L127-153) ──
        struct RecipeMeta { var name: String; var costPerYieldUnit: Double?; var yieldUnit: String? }
        var recipeIndex: [String: RecipeMeta] = [:]
        for r in recipes {
            recipeIndex[r.slug] = RecipeMeta(name: r.name, costPerYieldUnit: nil, yieldUnit: nil)
        }
        for c in recipeCosts {
            var existing = recipeIndex[c.recipeId] ?? RecipeMeta(
                name: c.recipeName ?? c.recipeId, costPerYieldUnit: nil, yieldUnit: nil)
            existing.costPerYieldUnit = c.costPerYieldUnit
            existing.yieldUnit = c.yieldUnit
            if existing.name.isEmpty, let n = c.recipeName { existing.name = n }
            recipeIndex[c.recipeId] = existing
        }

        // ── Vendor pricing index (web L155-201) ──
        var vendorIndex: [String: BridgeVendorPrice] = [:]
        for vp in vendorPrices {
            vendorIndex[vp.ingredient.lowercased().trimmingCharacters(in: .whitespaces)] = vp
        }
        for og in orderGuideItems {
            let key = og.ingredient.lowercased().trimmingCharacters(in: .whitespaces)
            if vendorIndex[key] == nil { vendorIndex[key] = og }
        }

        // Ordered per-dish component map. compKey mirrors web L203-209:
        // 'recipe:<slug>' or 'vendor:<ingredient lowered+trimmed>'.
        func compKey(componentType: String, recipeSlug: String?, vendorIngredient: String?) -> String {
            componentType == "recipe"
                ? "recipe:\(recipeSlug ?? "")"
                : "vendor:\((vendorIngredient ?? "").lowercased().trimmingCharacters(in: .whitespaces))"
        }
        var dishKeys: [String: [String]] = [:]                         // dish → ordered comp keys
        var dishComps: [String: [String: DishComponentResolved]] = [:] // dish → key → component
        func set(dish: String, key: String, _ value: DishComponentResolved) {
            if dishComps[dish]?[key] == nil {
                dishKeys[dish, default: []].append(key)
            }
            dishComps[dish, default: [:]][key] = value
        }

        // Stage 1: declared recipe links from recipes.menu_items[] (web L211-240).
        for r in recipes {
            let recipeName = recipeIndex[r.slug]?.name ?? r.name
            for mi in r.menuItems ?? [] {
                if mi.isEmpty { continue }
                let key = normalizeDishName(mi)
                if key.isEmpty { continue }
                let ck = compKey(componentType: "recipe", recipeSlug: r.slug, vendorIngredient: nil)
                if dishComps[key]?[ck] != nil { continue }
                set(dish: key, key: ck, DishComponentResolved(
                    componentType: "recipe",
                    recipeSlug: r.slug,
                    vendorIngredient: nil,
                    displayName: recipeName,
                    qtyPerServing: nil,
                    unit: nil,
                    unitPrice: recipeIndex[r.slug]?.costPerYieldUnit,
                    baseUnit: recipeIndex[r.slug]?.yieldUnit,
                    perServingCost: nil,
                    status: .noDishComponent))
            }
        }

        // Stage 2: overlay dish_components rows (web L242-286).
        for dc in dishComponents {
            let key = normalizeDishName(dc.dishName)
            if key.isEmpty { continue }
            let ck = compKey(componentType: dc.componentType, recipeSlug: dc.recipeSlug,
                             vendorIngredient: dc.vendorIngredient)
            if dc.componentType == "vendor_item" {
                let lookup = vendorIndex[(dc.vendorIngredient ?? "").lowercased()
                    .trimmingCharacters(in: .whitespaces)]
                set(dish: key, key: ck, DishComponentResolved(
                    componentType: "vendor_item",
                    recipeSlug: nil,
                    vendorIngredient: dc.vendorIngredient,
                    displayName: lookup?.ingredient ?? dc.vendorIngredient ?? "",
                    qtyPerServing: dc.qtyPerServing,
                    unit: dc.unit,
                    unitPrice: lookup?.unitPrice,
                    baseUnit: lookup?.packUnit,
                    perServingCost: nil,
                    status: .ok))
            } else {
                let recipeMeta = dc.recipeSlug.flatMap { recipeIndex[$0] }
                set(dish: key, key: ck, DishComponentResolved(
                    componentType: "recipe",
                    recipeSlug: dc.recipeSlug,
                    vendorIngredient: nil,
                    displayName: recipeMeta?.name ?? dc.recipeSlug ?? "",
                    qtyPerServing: dc.qtyPerServing,
                    unit: dc.unit,
                    unitPrice: recipeMeta?.costPerYieldUnit,
                    baseUnit: recipeMeta?.yieldUnit,
                    perServingCost: nil,
                    status: .ok))
            }
        }

        // Stage 3: compute per_serving_cost per component (web L288-297).
        var out: [String: [DishComponentResolved]] = [:]
        for (dish, keys) in dishKeys {
            out[dish] = keys.compactMap { dishComps[dish]?[$0] }.map(resolveComponentCost)
        }
        return out
    }

    // web L300-316. Note the web's falsy check on base_unit (`!c.base_unit`)
    // treats '' the same as null — mirrored via isEmpty. unit_price==0 is a
    // VALID price (0 is falsy in JS but the web checks `== null`, not `!`).
    private static func resolveComponentCost(_ c: DishComponentResolved) -> DishComponentResolved {
        func rebuilt(cost: Double?, status: DishComponentStatus) -> DishComponentResolved {
            DishComponentResolved(
                componentType: c.componentType, recipeSlug: c.recipeSlug,
                vendorIngredient: c.vendorIngredient, displayName: c.displayName,
                qtyPerServing: c.qtyPerServing, unit: c.unit,
                unitPrice: c.unitPrice, baseUnit: c.baseUnit,
                perServingCost: cost, status: status)
        }
        guard let qty = c.qtyPerServing, let unit = c.unit else {
            return rebuilt(cost: nil, status: .noDishComponent)
        }
        guard let unitPrice = c.unitPrice, let baseUnit = c.baseUnit, !baseUnit.isEmpty else {
            let missing: DishComponentStatus =
                c.componentType == "vendor_item" ? .noVendorPrice : .noRecipeCost
            return rebuilt(cost: nil, status: missing)
        }
        guard let qtyInBase = UnitConvert.convertQty(qty, from: unit, to: baseUnit, gPerMl: nil),
              qtyInBase.isFinite else {
            return rebuilt(cost: nil, status: .unitConvertFailed)
        }
        return rebuilt(cost: qtyInBase * unitPrice, status: .ok)
    }

    // MARK: computeDishCost (web L327-369)

    public static func computeDishCost(
        dishName: String,
        map: [String: [DishComponentResolved]]
    ) -> DishCostResult {
        let norm = normalizeDishName(dishName)
        let components = map[norm] ?? []

        var total = 0.0
        var allOk = !components.isEmpty
        var anyOk = false
        for c in components {
            if let cost = c.perServingCost {
                total += cost
                anyOk = true
            } else {
                allOk = false
            }
        }

        let linkState: DishLinkState
        if components.isEmpty { linkState = .unlinked }
        else if allOk { linkState = .fullyLinked }
        else if anyOk { linkState = .partial }
        else { linkState = .declaredOnly }

        return DishCostResult(
            dishName: dishName,
            dishNameNormalized: norm,
            components: components,
            totalCost: anyOk ? total : nil,
            fullyCosted: allOk,
            linkState: linkState)
    }

    // MARK: computeMenuEngineering (lib/menuEngineering.ts L56-124)
    //
    // Sales are cleaned internally (cleanedSalesRows) exactly as the web
    // module does after its SQL aggregate.

    public static func computeMenuEngineering(
        sales salesRaw: [BridgeSalesRow],
        map: [String: [DishComponentResolved]]
    ) -> BridgedMenuEngineeringResult {
        let sales = cleanedSalesRows(salesRaw)

        struct Working {
            let itemName: String
            let qty: Double
            let rev: Double
            let avg: Double
            let cpu: Double?
            let marginPct: Double?
            let linkState: DishLinkState
            let components: [DishComponentResolved]
        }

        var counts = (fullyLinked: 0, partial: 0, declaredOnly: 0, unlinked: 0, total: 0)
        var working: [Working] = []
        for s in sales {
            counts.total += 1
            // Number(s.qty) || 0 guards (web L79-80).
            let qty = s.qty.isFinite ? s.qty : 0
            let rev = s.rev.isFinite ? s.rev : 0
            let avg = qty > 0 ? rev / qty : 0
            let dishCost = computeDishCost(dishName: s.itemName, map: map)
            let cpu = dishCost.totalCost
            let marginPct: Double? = (cpu != nil && avg > 0) ? ((avg - cpu!) / avg) * 100 : nil
            switch dishCost.linkState {
            case .fullyLinked: counts.fullyLinked += 1
            case .partial: counts.partial += 1
            case .declaredOnly: counts.declaredOnly += 1
            case .unlinked: counts.unlinked += 1
            }
            working.append(Working(
                itemName: s.itemName, qty: qty, rev: rev, avg: avg, cpu: cpu,
                marginPct: marginPct, linkState: dishCost.linkState,
                components: dishCost.components))
        }

        let maxQty = max(0, working.map(\.qty).max() ?? 0)

        let margins = working.compactMap(\.marginPct).filter { !$0.isNaN }.sorted()
        let medianMargin = margins.isEmpty ? 0.0 : margins[margins.count / 2]
        let pops = working.map { maxQty > 0 ? $0.qty / maxQty : 0 }.sorted()
        let medianPop = pops.isEmpty ? 0.5 : pops[pops.count / 2]

        let rows: [BridgedMenuEngineeringRow] = working.map { w in
            let popularity = maxQty > 0 ? w.qty / maxQty : 0
            let hiM = w.marginPct != nil && w.marginPct! >= medianMargin
            let hiP = popularity >= medianPop
            let q: Quadrant
            if w.marginPct == nil { q = .unknown }
            else if hiM && hiP { q = .star }
            else if hiM && !hiP { q = .puzzle }
            else if !hiM && hiP { q = .plowhorse }
            else { q = .dog }
            return BridgedMenuEngineeringRow(
                itemName: w.itemName, qty: w.qty, netSales: w.rev, avgPrice: w.avg,
                costPerUnit: w.cpu, marginPct: w.marginPct, popularity: popularity,
                quadrant: q, linkState: w.linkState, components: w.components)
        }

        return BridgedMenuEngineeringResult(
            rows: rows,
            medianMargin: medianMargin,
            medianPop: medianPop,
            coverage: BridgedMenuEngineeringCoverage(
                fullyLinked: counts.fullyLinked, partial: counts.partial,
                declaredOnly: counts.declaredOnly, unlinked: counts.unlinked,
                total: counts.total))
    }

    // MARK: computeDishCoverage (web L407-460)

    public static func computeDishCoverage(
        sales salesRaw: [BridgeSalesRow],
        map: [String: [DishComponentResolved]]
    ) -> DishCoverageReport {
        let sales = cleanedSalesRows(salesRaw)

        var fully = 0, partial = 0, declaredOnly = 0, unlinked = 0
        var unlinkedDishes: [DishCoverageReport.UnlinkedDish] = []
        var declaredOnlyDishes: [DishCoverageReport.DeclaredOnlyDish] = []
        for s in sales {
            let r = computeDishCost(dishName: s.itemName, map: map)
            switch r.linkState {
            case .fullyLinked:
                fully += 1
            case .partial:
                partial += 1
            case .declaredOnly:
                declaredOnly += 1
                declaredOnlyDishes.append(.init(itemName: s.itemName, componentCount: r.components.count))
            case .unlinked:
                unlinked += 1
                unlinkedDishes.append(.init(
                    itemName: s.itemName,
                    qty: s.qty.isFinite ? s.qty : 0,
                    netSales: s.rev.isFinite ? s.rev : 0))
            }
        }

        // Biggest revenue dishes first (web L448) — stable sort mirrors JS.
        unlinkedDishes = unlinkedDishes.enumerated().sorted { a, b in
            if a.element.netSales != b.element.netSales { return a.element.netSales > b.element.netSales }
            return a.offset < b.offset
        }.map(\.element)
        declaredOnlyDishes.sort { $0.itemName < $1.itemName }

        return DishCoverageReport(
            totalSalesDishes: sales.count,
            fullyLinked: fully,
            partial: partial,
            declaredOnly: declaredOnly,
            unlinked: unlinked,
            unlinkedDishes: unlinkedDishes,
            declaredOnlyDishes: declaredOnlyDishes)
    }
}
