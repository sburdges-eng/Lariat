import Foundation

// GRDB-free port of the B1 recipe-level cost-variance computation:
//   lib/costingBenchmarks.mjs → computeCostVariance (L141) + resolveMergedCost (L60)
//
// theoretical = recipe_costs.cost_per_yield_unit (yield-adjusted, T3 output)
// actual      = batch cost re-priced with the most-recently-imported
//               vendor_prices row per ingredient (normalized-key join, or — T7 —
//               per master_id via resolveMergedCost), divided by recipe yield.
// variance    = (|actual − theoretical| / theoretical) × 100, rounded 2dp
//               (JS Math.round semantics — see jsRound2).
//
// D6 gate: lines with NO vendor match are `unmatched` and do NOT contribute;
// a recipe whose unmatched ratio EXCEEDS `unmatchedThreshold` (default 0.30,
// strictly greater-than — exactly 0.30 stays included) is excluded from the
// aggregates. T10: an unmatched line whose ingredient slug resolves to another
// recipe_costs row is priced from that sub-recipe's batch_cost / yield.
//
// All inputs are caller-supplied value types; no I/O is performed here.
// CostingRepository (LariatDB) runs the SELECTs the web function embeds and
// MUST pass vendorPrices sorted `imported_at DESC, id DESC` (the web ORDER BY):
// both the per-key "latest" pick and resolveMergedCost's latest-per-vendor
// mean depend on that order.
//
// T1 decision (A4 plan): DishCostBridge.computeDishCost is NOT reusable here —
// it prices dishes from dish_components × unit_price and has no bom_lines
// re-pricing, no resolveMergedCost merge, no pack→line-unit conversion, no
// sub-recipe fallback, and no unmatched gate. This focused re-pricing helper
// reuses UnitConvert (normalizeUnit / convertQty / bridgeCount /
// convertPackSizeToLineUnit) and IngredientKey (normalize / deriveMasterId).

// MARK: - Input row types

/// `recipe_costs` row subset. The compute applies the web main-query filters
/// (`cost_per_yield_unit IS NOT NULL AND yield IS NOT NULL AND yield > 0`)
/// internally, so the repository passes ALL rows for the location — the same
/// unfiltered set also feeds the T10 sub-recipe map (web reads it twice).
public struct CostVarianceRecipeRow: Sendable, Equatable {
    public let recipeId: String
    public let recipeName: String?
    public let costPerYieldUnit: Double?
    public let yield: Double?
    public let yieldUnit: String?
    public let batchCost: Double?

    public init(recipeId: String, recipeName: String?, costPerYieldUnit: Double?,
                yield: Double?, yieldUnit: String?, batchCost: Double?) {
        self.recipeId = recipeId; self.recipeName = recipeName
        self.costPerYieldUnit = costPerYieldUnit
        self.yield = yield; self.yieldUnit = yieldUnit; self.batchCost = batchCost
    }
}

/// `bom_lines` row subset. The web SELECT also pulls pack_price / pack_size but
/// never reads them post-D6 (the silent BOM-price fallback was removed), so
/// they are not carried here.
public struct CostVarianceBomLine: Sendable, Equatable {
    public let recipeId: String
    public let ingredient: String?
    public let masterId: String?
    public let qty: Double?
    public let unit: String?
    public let yieldPct: Double?
    public let lossFactor: Double?

    public init(recipeId: String, ingredient: String?, masterId: String?,
                qty: Double?, unit: String?, yieldPct: Double?, lossFactor: Double?) {
        self.recipeId = recipeId; self.ingredient = ingredient; self.masterId = masterId
        self.qty = qty; self.unit = unit
        self.yieldPct = yieldPct; self.lossFactor = lossFactor
    }
}

/// `vendor_prices` row subset. Caller MUST supply rows sorted
/// `imported_at DESC, id DESC` (see module header).
public struct CostVarianceVendorPrice: Sendable, Equatable {
    public let ingredient: String?
    public let masterId: String?
    public let vendor: String?
    public let packPrice: Double?
    public let packSize: Double?
    public let packUnit: String?

    public init(ingredient: String?, masterId: String?, vendor: String?,
                packPrice: Double?, packSize: Double?, packUnit: String?) {
        self.ingredient = ingredient; self.masterId = masterId; self.vendor = vendor
        self.packPrice = packPrice; self.packSize = packSize; self.packUnit = packUnit
    }
}

/// `ingredient_densities` seed row (global table — no location_id, matching web).
public struct CostVarianceDensityRow: Sendable, Equatable {
    public let ingredientKey: String
    public let gPerMl: Double

    public init(ingredientKey: String, gPerMl: Double) {
        self.ingredientKey = ingredientKey; self.gPerMl = gPerMl
    }
}

/// `ingredient_unit_weights` seed row (global table — no location_id, matching web).
public struct CostVarianceUnitWeightRow: Sendable, Equatable {
    public let ingredientKey: String
    public let unit: String?
    public let gPerUnit: Double?

    public init(ingredientKey: String, unit: String?, gPerUnit: Double?) {
        self.ingredientKey = ingredientKey; self.unit = unit; self.gPerUnit = gPerUnit
    }
}

// MARK: - Output type

/// The recipe cost-variance card payload: headline aggregates + top-5 offenders
/// + the coverage counts the card's "no empty-state lie" note renders.
/// Mirrors the web `{max_variance_pct, mean_variance_pct, recipes_over_5pct}`
/// aggregate plus the top of its variance-sorted `rows`.
public struct RecipeCostVariance: Sendable, Equatable {
    public struct Offender: Sendable, Equatable {
        public let recipeId: String
        public let name: String
        public let variancePct: Double

        public init(recipeId: String, name: String, variancePct: Double) {
            self.recipeId = recipeId; self.name = name; self.variancePct = variancePct
        }
    }

    /// `max_variance_pct` — max of the per-recipe 2dp-rounded variances (0 when none).
    public let max: Double
    /// `mean_variance_pct` — mean of the per-recipe 2dp-rounded variances (0 when none).
    public let mean: Double
    /// `recipes_over_5pct` — count of eligible recipes with variance >= 5 (web `v >= 5`).
    public let over5pctCount: Int
    /// Recipes that produced a numeric variance (web `included.length`).
    public let eligibleCount: Int
    /// Top-5 eligible recipes by variance desc (web rows sort, stable on ties).
    public let topOffenders: [Offender]
    /// Recipes passing the web main-query filter (cost_per_yield_unit NOT NULL,
    /// yield NOT NULL, yield > 0) — the coverage-note denominator. Candidates
    /// that are neither eligible nor high-unmatched were dropped for
    /// theoretical <= 0 or an unpriceable BOM (web silent `continue`s).
    public let candidateCount: Int
    /// Recipes excluded by the D6 unmatched-ratio gate (`high_unmatched_ratio`).
    public let excludedHighUnmatchedCount: Int

    public init(max: Double, mean: Double, over5pctCount: Int, eligibleCount: Int,
                topOffenders: [Offender], candidateCount: Int, excludedHighUnmatchedCount: Int) {
        self.max = max; self.mean = mean
        self.over5pctCount = over5pctCount; self.eligibleCount = eligibleCount
        self.topOffenders = topOffenders
        self.candidateCount = candidateCount
        self.excludedHighUnmatchedCount = excludedHighUnmatchedCount
    }

    public static let empty = RecipeCostVariance(
        max: 0, mean: 0, over5pctCount: 0, eligibleCount: 0,
        topOffenders: [], candidateCount: 0, excludedHighUnmatchedCount: 0)
}

// MARK: - Compute

public enum CostVarianceCompute {

    /// `DEFAULT_UNMATCHED_THRESHOLD` (lib/costingBenchmarks.mjs L139).
    public static let defaultUnmatchedThreshold = 0.30

    /// How many offenders the card lists (web card's top-5 slice).
    public static let topOffenderLimit = 5

    // MARK: resolveMergedCost (web L60-104)

    public struct MergedCost: Sendable, Equatable {
        public enum Source: String, Sendable {
            case preferredVendor = "preferred_vendor"
            case mean
        }
        public let packPrice: Double
        public let packSize: Double
        public let packUnit: String?
        public let source: Source
    }

    /// T7 merged-cost resolver for a master_id across vendor_prices rows:
    ///   1. preferred vendor's row when one matches (caller order = most recent
    ///      first, `usable.find` picks the latest row from that vendor);
    ///   2. else simple mean of unit costs across the latest row per distinct
    ///      vendor ("latest" = first occurrence in caller order).
    /// Returns nil when no non-degenerate (finite, > 0) priced row exists.
    public static func resolveMergedCost(
        rows: [CostVarianceVendorPrice], preferredVendor: String?
    ) -> MergedCost? {
        // Filter degenerate rows up-front so both branches see the same data.
        let usable = rows.filter { r in
            guard let pp = r.packPrice, let ps = r.packSize else { return false }
            return pp > 0 && ps > 0 && pp.isFinite && ps.isFinite
        }
        if usable.isEmpty { return nil }

        // JS `if (preferredVendor)` — empty string is falsy.
        if let pv = preferredVendor, !pv.isEmpty {
            if let hit = usable.first(where: { $0.vendor == pv }) {
                return MergedCost(packPrice: hit.packPrice!, packSize: hit.packSize!,
                                  packUnit: hit.packUnit, source: .preferredVendor)
            }
        }

        // Latest-per-vendor mean — first-seen row per vendor is the most recent
        // when the caller passes rows sorted imported_at DESC.
        var seen = Set<String>()
        var latest: [CostVarianceVendorPrice] = []
        for r in usable {
            let v = r.vendor ?? ""
            if seen.contains(v) { continue }
            seen.insert(v)
            latest.append(r)
        }
        let n = latest.count
        if n == 0 { return nil }
        let meanUnitCost = latest.reduce(0.0) { $0 + $1.packPrice! / $1.packSize! } / Double(n)
        // The mean's unit is only meaningful when every contributing row prices
        // in the same canonical unit; otherwise nil (identity fallback).
        let canon = UnitConvert.normalizeUnit(latest[0].packUnit)
        let uniformUnit: String? =
            (!canon.isEmpty && latest.allSatisfy { UnitConvert.normalizeUnit($0.packUnit) == canon })
                ? latest[0].packUnit
                : nil
        return MergedCost(packPrice: meanUnitCost, packSize: 1, packUnit: uniformUnit, source: .mean)
    }

    // MARK: computeCostVariance (web L141-452)

    /// `preferredVendorByMaster` mirrors the web's `ingredient_masters`
    /// preferred_vendor lookup (master_id → preferred_vendor; NULL rows may be
    /// omitted — an absent key and a stored null behave identically, web
    /// `preferredByMaster.get(id) ?? null`).
    public static func computeCostVariance(
        recipes: [CostVarianceRecipeRow],
        bomLines: [CostVarianceBomLine],
        vendorPrices: [CostVarianceVendorPrice],
        densities: [CostVarianceDensityRow] = [],
        unitWeights: [CostVarianceUnitWeightRow] = [],
        preferredVendorByMaster: [String: String] = [:],
        unmatchedThreshold: Double = defaultUnmatchedThreshold
    ) -> RecipeCostVariance {

        // ── Lookup maps (web L177-235) ──────────────────────────────────────
        // ingredient_key → latest vendor row (first-seen in DESC order) AND
        // master_id → ALL rows (resolveMergedCost needs every vendor's rows).
        var vpByKey: [String: CostVarianceVendorPrice] = [:]
        var vpByMaster: [String: [CostVarianceVendorPrice]] = [:]
        for r in vendorPrices {
            let key = IngredientKey.normalize(r.ingredient ?? "")
            if !key.isEmpty, vpByKey[key] == nil { vpByKey[key] = r }
            if let m = r.masterId, !m.isEmpty {                       // JS truthy
                vpByMaster[m, default: []].append(r)
            }
        }

        var densityByKey: [String: Double] = [:]
        for row in densities { densityByKey[row.ingredientKey] = row.gPerMl }

        var unitWeightByKey: [String: [String: Double]] = [:]
        for row in unitWeights {
            let canon = UnitConvert.normalizeUnit(row.unit)
            guard !canon.isEmpty, let g = row.gPerUnit else { continue }
            unitWeightByKey[row.ingredientKey, default: [:]][canon] = g
        }

        // T10 sub-recipe map: recipe_id → row, built from ALL rows (no filters;
        // web's second unfiltered recipe_costs read). Last row wins (Map.set).
        var subRecipeById: [String: CostVarianceRecipeRow] = [:]
        for r in recipes { subRecipeById[r.recipeId] = r }

        var bomByRecipe: [String: [CostVarianceBomLine]] = [:]
        for l in bomLines { bomByRecipe[l.recipeId, default: []].append(l) }

        // Web main-query filter, applied here so the repository passes one
        // unfiltered rowset (see CostVarianceRecipeRow doc).
        let candidates = recipes.filter { r in
            r.costPerYieldUnit != nil && r.yield != nil && r.yield! > 0
        }

        // ── Per-recipe re-pricing loop (web L237-414) ───────────────────────
        var included: [(recipeId: String, name: String, variancePct: Double)] = []
        var excludedHighUnmatched = 0

        for r in candidates {
            let theoretical = r.costPerYieldUnit!
            guard theoretical > 0 else { continue }        // JS !(theoretical > 0)
            let lines = bomByRecipe[r.recipeId] ?? []

            var actualBatch = 0.0
            var contributed = 0
            var totalLines = 0          // cost-eligible lines only (D6 denominator)
            var unmatchedLines = 0

            for line in lines {
                guard let qty = line.qty, qty > 0, qty.isFinite else { continue }
                guard let adj = yieldAdjustment(line.yieldPct, line.lossFactor) else { continue }
                totalLines += 1

                // T7: master_id merge first; fall back to the normalized-key
                // path when either side lacks a master (partial backfill).
                var packPrice: Double?
                var packSize: Double?
                var packUnit: String?
                var matched = false
                if let m = line.masterId, !m.isEmpty, let masterRows = vpByMaster[m],
                   let merged = resolveMergedCost(rows: masterRows,
                                                  preferredVendor: preferredVendorByMaster[m]) {
                    packPrice = merged.packPrice
                    packSize = merged.packSize
                    packUnit = merged.packUnit
                    matched = true
                }
                if !matched {
                    let key = IngredientKey.normalize(line.ingredient ?? "")
                    if !key.isEmpty, let vp = vpByKey[key],
                       vp.packPrice != nil, vp.packSize != nil {
                        packPrice = vp.packPrice
                        packSize = vp.packSize
                        packUnit = vp.packUnit
                        matched = true
                    }
                }

                if !matched {
                    // T10 sub-recipe fallback: slug → recipe_costs row; price the
                    // line from batch_cost / yield in the child's yield_unit.
                    // convertQty returns nil on cross-dim without density → the
                    // line stays unmatched so the D6 ratio gate fires.
                    if let slug = IngredientKey.deriveMasterId(line.ingredient ?? ""),
                       let child = subRecipeById[slug],
                       let childBatchCost = child.batchCost, childBatchCost > 0,
                       let childYield = child.yield, childYield > 0 {
                        let unitCost = childBatchCost / childYield
                        if let qtyConverted = UnitConvert.convertQty(
                               qty, from: line.unit ?? "", to: child.yieldUnit ?? "", gPerMl: nil),
                           qtyConverted.isFinite {
                            actualBatch += qtyConverted * unitCost * adj
                            contributed += 1
                            continue
                        }
                    }
                    unmatchedLines += 1
                    continue
                }

                guard let pp = packPrice, let ps = packSize,
                      pp > 0, ps > 0, pp.isFinite, ps.isFinite else {
                    // Matched row with degenerate numerics — as misleading as a
                    // missing row; counts unmatched for D6 purposes.
                    unmatchedLines += 1
                    continue
                }

                // T4 parity: convert pack_size into the line's unit before the
                // ratio. A line whose conversion cannot complete counts as
                // unmatched rather than reporting a made-up number.
                let lineKey = IngredientKey.normalize(line.ingredient ?? "")
                let conv = UnitConvert.convertPackSizeToLineUnit(
                    ps, packUnit: packUnit, lineUnit: line.unit,
                    density: lineKey.isEmpty ? nil : densityByKey[lineKey],
                    unitWeights: lineKey.isEmpty ? nil : unitWeightByKey[lineKey])
                guard let packSizeInLineUnit = conv.value else {
                    unmatchedLines += 1
                    continue
                }
                actualBatch += (qty * pp / packSizeInLineUnit) * adj
                contributed += 1
            }

            // Nothing cost-eligible: drop the recipe entirely (web pre-D6 behavior).
            if totalLines == 0 { continue }

            let unmatchedRatio = Double(unmatchedLines) / Double(totalLines)
            if unmatchedRatio > unmatchedThreshold {       // STRICT > (web parity)
                excludedHighUnmatched += 1
                continue
            }

            if contributed == 0 { continue }
            let actual = actualBatch / r.yield!
            let variancePct = jsRound2(abs(actual - theoretical) / theoretical * 100.0)
            included.append((r.recipeId, r.recipeName ?? r.recipeId, variancePct))
        }

        // ── Aggregates over the 2dp-rounded per-recipe variances (web L417-427) ──
        let variances = included.map(\.variancePct)
        let maxV = variances.max() ?? 0
        let meanV = variances.isEmpty ? 0 : variances.reduce(0, +) / Double(variances.count)
        let over5 = variances.filter { $0 >= 5 }.count

        // Variance-desc, stable on ties (JS Array.sort is stable; Swift's is not
        // guaranteed, so tie-break on original index).
        let topOffenders = included.enumerated()
            .sorted { a, b in
                if a.element.variancePct != b.element.variancePct {
                    return a.element.variancePct > b.element.variancePct
                }
                return a.offset < b.offset
            }
            .prefix(topOffenderLimit)
            .map { RecipeCostVariance.Offender(
                recipeId: $0.element.recipeId, name: $0.element.name,
                variancePct: $0.element.variancePct) }

        return RecipeCostVariance(
            max: jsRound2(maxV),
            mean: jsRound2(meanV),
            over5pctCount: over5,
            eligibleCount: included.count,
            topOffenders: Array(topOffenders),
            candidateCount: candidates.count,
            excludedHighUnmatchedCount: excludedHighUnmatched)
    }

    // MARK: - Private helpers

    /// T3-identical adjustment factor: 1 / (yield × (1 − loss)) with null defaults
    /// (web `yieldAdjustment`, L18-24). nil when the denominator is <= 0 / non-finite.
    static func yieldAdjustment(_ yieldPct: Double?, _ lossFactor: Double?) -> Double? {
        let y = yieldPct ?? 1.0
        let l = lossFactor ?? 0.0
        let denom = y * (1 - l)
        guard denom > 0, denom.isFinite else { return nil }
        return 1 / denom
    }

    /// JS `Math.round(x * 100) / 100` for the non-negative values this module
    /// rounds (variance percentages). ES Math.round is floor(x + 0.5), which
    /// matches Swift's away-from-zero rounding everywhere except pathological
    /// half-way float dust — floor(x + 0.5) is used for byte parity.
    static func jsRound2(_ x: Double) -> Double {
        ((x * 100) + 0.5).rounded(.down) / 100
    }
}
