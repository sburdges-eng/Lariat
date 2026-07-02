import Foundation

// GRDB-free port of the costing KPI computations from:
//   lib/menuEngineering.ts   → computeMenuEngineering  (quadrant classification)
//   lib/varianceTrend.ts     → getVarianceTrend         (trend point derivation)
//   lib/abcRanking.ts        → rankByContribution       (ABC Pareto tiers)
//
// All inputs are caller-supplied value types; no I/O is performed here.
// CostingRepository (LariatDB) runs the SELECTs and packs rows into CostingBundle.
//
// ── Web thresholds mirrored exactly ──────────────────────────────────────────
//   Quadrant: hiMargin = margin_pct >= medianMargin; hiPop = popularity >= medianPop
//   ABC:      tier A = cumulative before < 80%; B = 80–<95%; C = 95%+
//   Color:    abs(pct) >= 5 → red; >= 2 → yellow; < 2 → green

// MARK: - Output types

public enum Quadrant: String, Equatable {
    case star       = "star"
    case puzzle     = "puzzle"
    case plowhorse  = "plowhorse"
    case dog        = "dog"
    case unknown    = "unknown"
}

public struct MenuEngineeringRow: Equatable {
    public let itemName: String
    public let qty: Double
    public let netSales: Double
    public let avgPrice: Double
    public let costPerUnit: Double?
    public let marginPct: Double?
    public let popularity: Double
    public let quadrant: Quadrant
}

public struct MenuEngineeringResult {
    public let rows: [MenuEngineeringRow]
    public let medianMargin: Double
    public let medianPop: Double
}

public enum ThresholdColor: String, Equatable {
    case green  = "green"
    case yellow = "yellow"
    case red    = "red"
}

public struct VarianceTrendPoint: Equatable {
    /// Optional — a partially-migrated production row may have period_start NULL.
    public let periodStart: String?
    public let periodEnd: String
    public let variancePct: Double?
    public let varianceAmount: Double?
    public let thresholdColor: ThresholdColor
}

public struct VarianceTrend {
    public let points: [VarianceTrendPoint]
    public let pCurrent: Double?
    public let pAverage: Double?
    public let rowsFound: Int
    /// Number of days in the rolling window used to select trend rows.
    /// Mirrors the `windowDays` field on the web `VarianceTrend` interface (lib/varianceTrend.ts).
    public let windowDays: Int
}

public enum AbcTier: String, Equatable {
    case a        = "A"
    case b        = "B"
    case c        = "C"
    case unranked = "unranked"
}

public struct AbcRankedRow: Equatable {
    public let itemName: String
    public let qty: Double
    public let costPerUnit: Double?
    public let marginPct: Double?
    public let netSales: Double
    public let contributionDollars: Double
    public let menuMixPct: Double
    public let scoreCents: Int
    public let cumulativePct: Double
    public let tier: AbcTier
}

// MARK: - Compute

public enum CostingCompute {

    // MARK: computeMenuEngineering
    //
    // Port of computeMenuEngineering() in lib/menuEngineering.ts.
    //
    // cost_per_unit arrives on each CostingSalesLine from CostingRepository,
    // which since A4.3 T1 derives it via the real dish-cost bridge
    // (DishCostBridge: dish_components → recipe_costs / vendor_prices /
    // order_guide_items) — the former CAST(NULL AS REAL) staging column is
    // gone and the T10/T14 parity gap is RESOLVED. Items the bridge cannot
    // cost still fall to quadrant 'unknown' (web-identical).
    // The bridged variant with link_state + components + coverage lives in
    // DishCostBridge.computeMenuEngineering (used by costing.menuEngineering).
    //
    // Null/zero guards mirrored exactly:
    //   qty=0 → avg_price=0 (not excluded; repository SQL filters quantity_sold > 0)
    //   cpu=nil → margin_pct=nil → quadrant=unknown
    //   margins empty → medianMargin=0
    //   pops empty → medianPop=0.5

    public static func computeMenuEngineering(
        salesLines: [CostingSalesLine]
    ) -> MenuEngineeringResult {
        guard !salesLines.isEmpty else {
            return MenuEngineeringResult(rows: [], medianMargin: 0.0, medianPop: 0.5)
        }

        // Normalize popularity by maxQty (mirrors JS: r.qty / maxQty or 0)
        let maxQty = salesLines.map { $0.qty }.max() ?? 0.0

        var rows: [MenuEngineeringRow] = salesLines.map { s in
            let qty    = s.qty
            let rev    = s.rev
            let avg    = qty > 0 ? rev / qty : 0.0
            let cpu    = s.costPerUnit
            let margin: Double? = (cpu != nil && avg > 0)
                ? ((avg - cpu!) / avg) * 100.0
                : nil
            let popularity = maxQty > 0 ? qty / maxQty : 0.0
            return MenuEngineeringRow(
                itemName:    s.itemName,
                qty:         qty,
                netSales:    rev,
                avgPrice:    avg,
                costPerUnit: cpu,
                marginPct:   margin,
                popularity:  popularity,
                quadrant:    .unknown    // assigned below
            )
        }

        // Compute medianMargin from rows that have a margin_pct
        let margins = rows
            .compactMap { $0.marginPct }
            .filter { !$0.isNaN }
            .sorted()
        let medianMargin: Double = margins.isEmpty
            ? 0.0
            : margins[margins.count / 2]

        // Compute medianPop from all rows
        let pops = rows.map { $0.popularity }.sorted()
        let medianPop: Double = pops.isEmpty ? 0.5 : pops[pops.count / 2]

        // Assign quadrants (mirrors JS exactly)
        rows = rows.map { r in
            let hiM = r.marginPct != nil && r.marginPct! >= medianMargin
            let hiP = r.popularity >= medianPop
            let q: Quadrant
            if r.marginPct == nil     { q = .unknown }
            else if  hiM &&  hiP      { q = .star }
            else if  hiM && !hiP      { q = .puzzle }
            else if !hiM &&  hiP      { q = .plowhorse }
            else                      { q = .dog }
            return MenuEngineeringRow(
                itemName:    r.itemName,
                qty:         r.qty,
                netSales:    r.netSales,
                avgPrice:    r.avgPrice,
                costPerUnit: r.costPerUnit,
                marginPct:   r.marginPct,
                popularity:  r.popularity,
                quadrant:    q
            )
        }

        return MenuEngineeringResult(rows: rows, medianMargin: medianMargin, medianPop: medianPop)
    }

    // MARK: getVarianceTrend
    //
    // Port of getVarianceTrend() in lib/varianceTrend.ts.
    //
    // The web version does its own MAX(period_end) + window SQL.
    // Here the caller (CostingRepository) has already applied the 28-day window
    // and passes the resulting rows in period_end ASC order.
    // This function derives the trend points, pCurrent, pAverage, and colors.
    //
    // Color thresholds (T9 dashboard-consistent, mirrored from web colorFor()):
    //   abs(pct) >= 5  → red
    //   abs(pct) >= 2  → yellow
    //   otherwise / nil → green

    public static func getVarianceTrend(
        trendRows: [CostingVarianceTrendRow],
        windowDays: Int = 28
    ) -> VarianceTrend {
        guard !trendRows.isEmpty else {
            return VarianceTrend(points: [], pCurrent: nil, pAverage: nil, rowsFound: 0, windowDays: windowDays)
        }

        let points: [VarianceTrendPoint] = trendRows.map { r in
            VarianceTrendPoint(
                periodStart:    r.periodStart,
                periodEnd:      r.periodEnd,
                variancePct:    r.variancePct,
                varianceAmount: r.varianceAmount,
                thresholdColor: colorFor(r.variancePct)
            )
        }

        let numericPcts = points.compactMap { $0.variancePct }
        let pAverage: Double? = numericPcts.isEmpty
            ? nil
            : numericPcts.reduce(0.0, +) / Double(numericPcts.count)

        let pCurrent = points.last?.variancePct

        return VarianceTrend(
            points:    points,
            pCurrent:  pCurrent,
            pAverage:  pAverage,
            rowsFound: trendRows.count,
            windowDays: windowDays
        )
    }

    // MARK: rankByContribution (ABC)
    //
    // Port of rankByContribution() in lib/abcRanking.ts.
    //
    // Thresholds: A = top 80%, B = 80–<95%, C = 95%+.
    // Rows with no cpu (unlinked) are appended as 'unranked'.
    // Tier assignment uses cumulativeBefore (cumulative BEFORE adding the row)
    // so the single biggest item is always A.

    public static func rankByContribution(
        salesLines: [CostingSalesLine],
        aPct: Double = 0.80,
        bPct: Double = 0.95
    ) -> [AbcRankedRow] {
        guard !salesLines.isEmpty else { return [] }

        let totalQty = salesLines.reduce(0.0) { $0 + ($1.qty) }

        struct Enriched {
            let itemName: String
            let qty: Double
            let costPerUnit: Double?
            let marginPct: Double?
            let netSales: Double
            let contributionDollars: Double
            let menuMixPct: Double
            let scoreCents: Int
            let linked: Bool
        }

        let enriched: [Enriched] = salesLines.map { s in
            // Web gates: linked = costPerUnit != nil && marginPct != nil.
            // Swift gates only costPerUnit != nil — equivalent in practice because marginPct
            // is derived from costPerUnit+avgPrice, and avgPrice > 0 is guaranteed by the
            // repository's quantity_sold > 0 filter. No behavior change.
            let linked   = s.costPerUnit != nil
            let avgPrice = s.qty > 0 ? s.rev / s.qty : 0.0
            let cpu      = s.costPerUnit ?? 0.0

            // marginPct from sales line (same formula as menuEngineering)
            let marginPct: Double? = (s.costPerUnit != nil && avgPrice > 0)
                ? ((avgPrice - cpu) / avgPrice) * 100.0
                : nil

            let contribution = linked
                ? max(0.0, (avgPrice - cpu) * s.qty)
                : 0.0
            let menuMix = totalQty > 0 ? s.qty / totalQty : 0.0
            let scoreCents = linked
                ? Int((contribution * menuMix * 100.0).rounded())
                : 0
            return Enriched(
                itemName:             s.itemName,
                qty:                  s.qty,
                costPerUnit:          s.costPerUnit,
                marginPct:            marginPct,
                netSales:             s.rev,
                contributionDollars:  contribution,
                menuMixPct:           menuMix,
                scoreCents:           scoreCents,
                linked:               linked
            )
        }

        // Only rows that are linked AND have positive score participate in ranking
        var linkedRows = enriched.filter { $0.linked && $0.scoreCents > 0 }
        let totalScore = linkedRows.reduce(0) { $0 + $1.scoreCents }

        // Sort descending by scoreCents (mirrors JS sort)
        linkedRows.sort { $0.scoreCents > $1.scoreCents }

        var ranked: [AbcRankedRow] = []
        var running = 0
        for r in linkedRows {
            // Tier based on cumulative BEFORE this row (web comment: "single biggest → A")
            let cumulativeBeforePct = totalScore > 0
                ? (Double(running) / Double(totalScore)) * 100.0
                : 0.0
            running += r.scoreCents
            let cumulativePct = totalScore > 0
                ? min(100.0, (Double(running) / Double(totalScore)) * 100.0)
                : 100.0

            let tier: AbcTier
            if cumulativeBeforePct < aPct * 100.0      { tier = .a }
            else if cumulativeBeforePct < bPct * 100.0 { tier = .b }
            else                                        { tier = .c }

            ranked.append(AbcRankedRow(
                itemName:             r.itemName,
                qty:                  r.qty,
                costPerUnit:          r.costPerUnit,
                marginPct:            r.marginPct,
                netSales:             r.netSales,
                contributionDollars:  r.contributionDollars,
                menuMixPct:           r.menuMixPct,
                scoreCents:           r.scoreCents,
                cumulativePct:        cumulativePct,
                tier:                 tier
            ))
        }

        // Append unlinked rows as 'unranked'
        for r in enriched {
            if !r.linked || r.scoreCents == 0 {
                ranked.append(AbcRankedRow(
                    itemName:             r.itemName,
                    qty:                  r.qty,
                    costPerUnit:          r.costPerUnit,
                    marginPct:            r.marginPct,
                    netSales:             r.netSales,
                    contributionDollars:  0.0,
                    menuMixPct:           r.menuMixPct,
                    scoreCents:           0,
                    cumulativePct:        0.0,
                    tier:                 .unranked
                ))
            }
        }

        return ranked
    }
}

// MARK: - Private helpers

// internal (not private) so VarianceAttributionCompute.thresholdColor(_:) can reuse it
// without re-deriving the threshold buckets — see A4.2 Board 2 plan.
func colorFor(_ pct: Double?) -> ThresholdColor {
    guard let pct else { return .green }
    let abs = Swift.abs(pct)
    if abs >= 5.0 { return .red }
    if abs >= 2.0 { return .yellow }
    return .green
}
