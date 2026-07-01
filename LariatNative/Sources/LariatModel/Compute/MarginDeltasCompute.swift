import Foundation

/// Pure port of `lib/marginDeltas.ts#listMarginDeltas` — per-dish per-serving
/// cost deltas over a lookback window. GRDB-free: the repository queries
/// `dish_components` + `vendor_prices_history` and hands the rows in.
///
/// `snapshots` MUST arrive sorted (ingredient, vendor, sku, snapshot_at ASC)
/// so first-seen == baseline and last == latest, matching the SQL ORDER BY.

public struct MarginDishComponent: Sendable {
    public let dishName: String
    public let componentType: String       // "recipe" | "vendor_item"
    public let recipeSlug: String?
    public let vendorIngredient: String?
    public let qtyPerServing: Double
    public init(dishName: String, componentType: String, recipeSlug: String?, vendorIngredient: String?, qtyPerServing: Double) {
        self.dishName = dishName; self.componentType = componentType
        self.recipeSlug = recipeSlug; self.vendorIngredient = vendorIngredient
        self.qtyPerServing = qtyPerServing
    }
}

public struct MarginSnapshot: Sendable {
    public let vendor: String
    public let sku: String
    public let ingredient: String
    public let snapshotAt: String
    public let unitPrice: Double
    public init(vendor: String, sku: String, ingredient: String, snapshotAt: String, unitPrice: Double) {
        self.vendor = vendor; self.sku = sku; self.ingredient = ingredient
        self.snapshotAt = snapshotAt; self.unitPrice = unitPrice
    }
}

public struct MarginDeltaOptions: Sendable {
    public let locationId: String
    public let windowDays: Int
    public let minPctMove: Double
    public let limit: Int
    /// Raw-in, clamped-out — mirrors the web option normalization
    /// (`lib/marginDeltas.ts` lines 103–124).
    public init(locationId: String = "default", windowDays: Int? = nil, minPctMove: Double? = nil, limit: Int? = nil) {
        let loc = locationId.trimmingCharacters(in: .whitespaces)
        self.locationId = loc.isEmpty ? "default" : loc
        if let w = windowDays, w > 0 { self.windowDays = min(90, max(1, w)) } else { self.windowDays = 7 }
        if let m = minPctMove, m >= 0 { self.minPctMove = min(1000, m) } else { self.minPctMove = 5 }
        if let l = limit, l > 0 { self.limit = min(500, l) } else { self.limit = 50 }
    }
}

public struct MarginContributor: Sendable, Equatable {
    public let vendor: String
    public let sku: String
    public let ingredient: String
    public let contributionPct: Double
    public init(vendor: String, sku: String, ingredient: String, contributionPct: Double) {
        self.vendor = vendor; self.sku = sku; self.ingredient = ingredient
        self.contributionPct = contributionPct
    }
}

public enum MarginDirection: String, Sendable, Equatable { case up, down }

public struct MarginDeltaRow: Sendable, Equatable {
    public let dishName: String
    public let baselineCost: Double
    public let baselineAt: String
    public let latestCost: Double
    public let latestAt: String
    public let deltaPct: Double
    public let direction: MarginDirection
    public let topContributors: [MarginContributor]
    public init(dishName: String, baselineCost: Double, baselineAt: String, latestCost: Double, latestAt: String, deltaPct: Double, direction: MarginDirection, topContributors: [MarginContributor]) {
        self.dishName = dishName; self.baselineCost = baselineCost; self.baselineAt = baselineAt
        self.latestCost = latestCost; self.latestAt = latestAt; self.deltaPct = deltaPct
        self.direction = direction; self.topContributors = topContributors
    }
}

public enum MarginDeltasCompute {
    private struct SkuGroup {
        let vendor: String; let sku: String; let ingredient: String
        let baselineUnitPrice: Double; let baselineAt: String
        var latestUnitPrice: Double; var latestAt: String
    }
    private struct Resolution {
        let vendor: String; let sku: String; let ingredient: String
        let qtyPerServing: Double
        let baselineUnitPrice: Double; let baselineAt: String
        let latestUnitPrice: Double; let latestAt: String
    }

    public static func compute(components: [MarginDishComponent], snapshots: [MarginSnapshot], options: MarginDeltaOptions) -> [MarginDeltaRow] {
        if components.isEmpty { return [] }

        // Group snapshots by NUL-joined (ingredient, vendor, sku), preserving
        // first-seen order. Snapshots arrive ORDER BY … snapshot_at ASC, so the
        // first row per key is baseline and each later row overwrites latest.
        var skuGroups: [String: SkuGroup] = [:]
        var groupOrder: [String] = []
        for s in snapshots {
            let key = "\(s.ingredient)\u{0}\(s.vendor)\u{0}\(s.sku)"
            if var g = skuGroups[key] {
                g.latestUnitPrice = s.unitPrice; g.latestAt = s.snapshotAt
                skuGroups[key] = g
            } else {
                skuGroups[key] = SkuGroup(vendor: s.vendor, sku: s.sku, ingredient: s.ingredient,
                                          baselineUnitPrice: s.unitPrice, baselineAt: s.snapshotAt,
                                          latestUnitPrice: s.unitPrice, latestAt: s.snapshotAt)
                groupOrder.append(key)
            }
        }

        // Index by ingredient → SkuGroups (insertion order).
        var byIngredient: [String: [SkuGroup]] = [:]
        for key in groupOrder {
            let g = skuGroups[key]!
            byIngredient[g.ingredient, default: []].append(g)
        }

        // Resolve each dish's vendor_item components, preserving dish insertion order.
        var dishOrder: [String] = []
        var dishComps: [String: [Resolution]] = [:]
        for c in components {
            if c.componentType == "recipe" { continue }
            guard let ingredient = c.vendorIngredient, !ingredient.isEmpty else { continue }
            guard let candidates = byIngredient[ingredient], !candidates.isEmpty else { continue }

            // Pick the SKU whose latest snapshot is most recent. Ties: lexical
            // order on (vendor, sku).
            var pick: SkuGroup?
            for cand in candidates {
                if let p = pick {
                    if cand.latestAt > p.latestAt ||
                        (cand.latestAt == p.latestAt && (cand.vendor < p.vendor || (cand.vendor == p.vendor && cand.sku < p.sku))) {
                        pick = cand
                    }
                } else { pick = cand }
            }
            guard let picked = pick else { continue }
            if picked.baselineAt == picked.latestAt { continue }
            if picked.baselineUnitPrice <= 0 { continue }
            let qty = c.qtyPerServing
            if !qty.isFinite || qty <= 0 { continue }

            if dishComps[c.dishName] == nil { dishOrder.append(c.dishName) }
            dishComps[c.dishName, default: []].append(Resolution(
                vendor: picked.vendor, sku: picked.sku, ingredient: picked.ingredient, qtyPerServing: qty,
                baselineUnitPrice: picked.baselineUnitPrice, baselineAt: picked.baselineAt,
                latestUnitPrice: picked.latestUnitPrice, latestAt: picked.latestAt))
        }

        var out: [MarginDeltaRow] = []
        for dish in dishOrder {
            let comps = dishComps[dish]!
            if comps.isEmpty { continue }
            var baselineCost = 0.0, latestCost = 0.0
            var baselineAt = comps[0].baselineAt, latestAt = comps[0].latestAt
            for r in comps {
                baselineCost += r.baselineUnitPrice * r.qtyPerServing
                latestCost += r.latestUnitPrice * r.qtyPerServing
                if r.baselineAt < baselineAt { baselineAt = r.baselineAt }
                if r.latestAt > latestAt { latestAt = r.latestAt }
            }
            if baselineCost <= 0 { continue }
            let totalDelta = latestCost - baselineCost
            let deltaPct = (totalDelta / baselineCost) * 100
            if abs(deltaPct) < options.minPctMove { continue }

            var contributors = comps.map { r -> MarginContributor in
                let compDelta = (r.latestUnitPrice - r.baselineUnitPrice) * r.qtyPerServing
                let pct = totalDelta == 0 ? 0 : (compDelta / totalDelta) * 100
                return MarginContributor(vendor: r.vendor, sku: r.sku, ingredient: r.ingredient, contributionPct: pct)
            }
            // Stable sort contributors by |contribution| DESC (preserve
            // insertion order on ties, matching JS's stable Array.sort).
            contributors = contributors.enumerated().sorted { a, b in
                let ca = abs(a.element.contributionPct), cb = abs(b.element.contributionPct)
                if ca != cb { return ca > cb }
                return a.offset < b.offset
            }.map(\.element)
            contributors = Array(contributors.prefix(3))

            out.append(MarginDeltaRow(
                dishName: dish, baselineCost: baselineCost, baselineAt: baselineAt,
                latestCost: latestCost, latestAt: latestAt, deltaPct: deltaPct,
                direction: deltaPct > 0 ? .up : .down, topContributors: contributors))
        }

        // Stable sort by |deltaPct| DESC (preserve insertion order on ties, so
        // equal-delta dishes keep first-seen order — parity with JS stable sort
        // + Map insertion order).
        let sorted = out.enumerated().sorted { a, b in
            let da = abs(a.element.deltaPct), db = abs(b.element.deltaPct)
            if da != db { return da > db }
            return a.offset < b.offset
        }.map(\.element)
        return Array(sorted.prefix(options.limit))
    }
}
