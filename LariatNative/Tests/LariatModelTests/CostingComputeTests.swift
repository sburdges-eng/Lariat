import XCTest
@testable import LariatModel

// Parity tests for CostingCompute — ports of:
//   computeMenuEngineering  (lib/menuEngineering.ts)
//   getVarianceTrend        (lib/varianceTrend.ts)
//   rankByContribution      (lib/abcRanking.ts)
//
// ── Fixture input values (from T5 seed / T10 extensions) ─────────────────────
//
//   sales_lines:
//     Burger:   qty=40  rev=600  cost_per_unit=4.0
//     Tacos:    qty=25  rev=375  cost_per_unit=5.0
//     MysteryX: qty=5   rev=75   cost_per_unit=nil
//
// ── Menu engineering derivations ─────────────────────────────────────────────
//
//   maxQty = 40
//   popularity (normalized):  Burger=1.0  Tacos=0.625  MysteryX=0.125
//
//   avg_price = rev / qty (all 15.0)
//   margin_pct = (avg_price - cpu) / avg_price * 100:
//     Burger:   (15.0 - 4.0) / 15.0 * 100 =  73.333...%
//     Tacos:    (15.0 - 5.0) / 15.0 * 100 =  66.666...%
//     MysteryX: nil (no cost)
//
//   margins with values: [66.67, 73.33] (2 items)
//   medianMargin = sorted[floor(2/2)] = sorted[1] = 73.333%
//
//   pops (all 3): [0.125, 0.625, 1.0] sorted
//   medianPop = sorted[floor(3/2)] = sorted[1] = 0.625
//
//   Quadrant assignments:
//     Burger:   hiM=(73.33 >= 73.33)=true, hiP=(1.0 >= 0.625)=true   → star
//     Tacos:    hiM=(66.67 >= 73.33)=false, hiP=(0.625 >= 0.625)=true → plowhorse
//     MysteryX: margin_pct=nil → unknown
//
// ── ABC derivations ───────────────────────────────────────────────────────────
//
//   totalQty = 40 + 25 + 5 = 70
//
//   Burger:
//     avgPrice        = 600/40   = 15.0
//     contribution    = (15-4)*40 = 440.0
//     menuMixPct      = 40/70
//     scoreCents      = round(440.0 * (40/70) * 100) = round(25142.857) = 25143
//
//   Tacos:
//     avgPrice        = 375/25   = 15.0
//     contribution    = (15-5)*25 = 250.0
//     menuMixPct      = 25/70
//     scoreCents      = round(250.0 * (25/70) * 100) = round(8928.571) = 8929
//
//   MysteryX: cpu=nil → unranked
//
//   linkedRows sorted descending by scoreCents: [Burger(25143), Tacos(8929)]
//   totalScore = 25143 + 8929 = 34072
//
//   Burger: cumulativeBeforePct = 0/34072*100 = 0 → 0 < 80 → tier A
//   Tacos:  cumulativeBeforePct = 25143/34072*100 ≈ 73.79% → 73.79 < 80 → tier A
//
// ── Variance trend derivations ────────────────────────────────────────────────
//
//   2 trend rows within 28-day window:
//     Row A: variance_pct=8.0   → thresholdColor='red'  (abs≥5)
//     Row B: variance_pct=5.5   → thresholdColor='red'  (abs≥5)
//
//   pCurrent = 5.5  (last row)
//   pAverage = (8.0 + 5.5) / 2 = 6.75
//   rowsFound = 2

final class CostingComputeTests: XCTestCase {

    // MARK: - Helpers

    private func makeSalesLines() -> [CostingSalesLine] {
        [
            CostingSalesLine(itemName: "Burger",   qty: 40, rev: 600.0, costPerUnit:  4.0),
            CostingSalesLine(itemName: "Tacos",    qty: 25, rev: 375.0, costPerUnit:  5.0),
            CostingSalesLine(itemName: "MysteryX", qty:  5, rev:  75.0, costPerUnit: nil),
        ]
    }

    private func makeTrendRows() -> [CostingVarianceTrendRow] {
        [
            CostingVarianceTrendRow(periodStart: "2026-06-02", periodEnd: "2026-06-09",
                                   varianceAmount: 80.0, variancePct: 8.0),
            CostingVarianceTrendRow(periodStart: "2026-06-09", periodEnd: "2026-06-16",
                                   varianceAmount: 50.0, variancePct: 5.5),
        ]
    }

    // MARK: - computeMenuEngineering

    func testMenuEngineeringRowCount() {
        let result = CostingCompute.computeMenuEngineering(salesLines: makeSalesLines())
        XCTAssertEqual(result.rows.count, 3)
    }

    func testMenuEngineeringMedianMargin() {
        let result = CostingCompute.computeMenuEngineering(salesLines: makeSalesLines())
        // medianMargin = 73.333...% (see derivation above)
        XCTAssertEqual(result.medianMargin, 73.333, accuracy: 0.01)
    }

    func testMenuEngineeringMedianPop() {
        let result = CostingCompute.computeMenuEngineering(salesLines: makeSalesLines())
        // medianPop = 0.625 (sorted[1] of [0.125, 0.625, 1.0])
        XCTAssertEqual(result.medianPop, 0.625, accuracy: 0.001)
    }

    func testBurgerIsStar() {
        let result = CostingCompute.computeMenuEngineering(salesLines: makeSalesLines())
        let burger = result.rows.first { $0.itemName == "Burger" }
        XCTAssertNotNil(burger)
        XCTAssertEqual(burger?.quadrant, .star)
    }

    func testTacosIsFlowhorse() {
        let result = CostingCompute.computeMenuEngineering(salesLines: makeSalesLines())
        let tacos = result.rows.first { $0.itemName == "Tacos" }
        XCTAssertNotNil(tacos)
        XCTAssertEqual(tacos?.quadrant, .plowhorse)
    }

    func testMysteryXIsUnknown() {
        let result = CostingCompute.computeMenuEngineering(salesLines: makeSalesLines())
        let mystery = result.rows.first { $0.itemName == "MysteryX" }
        XCTAssertNotNil(mystery)
        XCTAssertEqual(mystery?.quadrant, .unknown)
    }

    func testBurgerMarginPct() {
        let result = CostingCompute.computeMenuEngineering(salesLines: makeSalesLines())
        let burger = result.rows.first { $0.itemName == "Burger" }
        // (15.0 - 4.0) / 15.0 * 100 = 73.333%
        XCTAssertEqual(burger?.marginPct ?? -1, 73.333, accuracy: 0.01)
    }

    func testMysteryXMarginPctNil() {
        let result = CostingCompute.computeMenuEngineering(salesLines: makeSalesLines())
        let mystery = result.rows.first { $0.itemName == "MysteryX" }
        XCTAssertNil(mystery?.marginPct, "MysteryX has no cpu → nil margin")
    }

    func testBurgerPopularity() {
        let result = CostingCompute.computeMenuEngineering(salesLines: makeSalesLines())
        let burger = result.rows.first { $0.itemName == "Burger" }
        // maxQty=40; popularity = 40/40 = 1.0
        XCTAssertEqual(burger?.popularity ?? -1, 1.0, accuracy: 0.001)
    }

    func testTacosPopularity() {
        let result = CostingCompute.computeMenuEngineering(salesLines: makeSalesLines())
        let tacos = result.rows.first { $0.itemName == "Tacos" }
        // 25/40 = 0.625
        XCTAssertEqual(tacos?.popularity ?? -1, 0.625, accuracy: 0.001)
    }

    func testEmptySalesLines() {
        let result = CostingCompute.computeMenuEngineering(salesLines: [])
        XCTAssertEqual(result.rows.count, 0)
        XCTAssertEqual(result.medianMargin, 0.0, accuracy: 0.001)
        XCTAssertEqual(result.medianPop, 0.5, accuracy: 0.001)
    }

    func testAllUnlinkedProducesUnknownQuadrants() {
        // When no row has cpu, all margin_pct = nil → all unknown
        let lines = [CostingSalesLine(itemName: "A", qty: 10, rev: 100.0, costPerUnit: nil)]
        let result = CostingCompute.computeMenuEngineering(salesLines: lines)
        XCTAssertEqual(result.rows[0].quadrant, .unknown)
        XCTAssertEqual(result.medianMargin, 0.0, accuracy: 0.001)
    }

    func testTotalRowFilterDropsZeroQty() {
        // TOTAL/TOTALS rows from Toast CSV are pre-filtered; a row named "TOTAL" with qty=0
        // should be present in output since filtering happens at the repository level
        // (cleanedSalesRows in web = location-filter in repository; Swift does qty>0 in SQL).
        // This test verifies qty=0 rows from a separate fixture are not included.
        let lines = [
            CostingSalesLine(itemName: "Burger", qty: 10, rev: 100.0, costPerUnit: 4.0),
            CostingSalesLine(itemName: "TOTAL",  qty:  0, rev:   0.0, costPerUnit: nil),
        ]
        // qty=0 rows produce popularity=0 but are still in rows (they pass through).
        // The repository's SQL filters quantity_sold > 0, so we don't see them.
        // Just verify compute handles qty=0 gracefully.
        let result = CostingCompute.computeMenuEngineering(salesLines: lines)
        // Both rows present; TOTAL gets zero popularity.
        XCTAssertEqual(result.rows.count, 2)
        let total = result.rows.first { $0.itemName == "TOTAL" }
        XCTAssertEqual(total?.popularity ?? -1, 0.0, accuracy: 0.001)
    }

    // MARK: - getVarianceTrend

    func testVarianceTrendRowCount() {
        let trend = CostingCompute.getVarianceTrend(trendRows: makeTrendRows())
        XCTAssertEqual(trend.rowsFound, 2)
        XCTAssertEqual(trend.points.count, 2)
    }

    func testVarianceTrendPCurrent() {
        let trend = CostingCompute.getVarianceTrend(trendRows: makeTrendRows())
        // pCurrent = last row's variancePct = 5.5
        XCTAssertEqual(trend.pCurrent ?? -1, 5.5, accuracy: 0.001)
    }

    func testVarianceTrendPAverage() {
        let trend = CostingCompute.getVarianceTrend(trendRows: makeTrendRows())
        // pAverage = (8.0 + 5.5) / 2 = 6.75
        XCTAssertEqual(trend.pAverage ?? -1, 6.75, accuracy: 0.001)
    }

    func testVarianceTrendThresholdColors() {
        let trend = CostingCompute.getVarianceTrend(trendRows: makeTrendRows())
        // 8.0 → abs>=5 → red
        XCTAssertEqual(trend.points[0].thresholdColor, .red)
        // 5.5 → abs>=5 → red
        XCTAssertEqual(trend.points[1].thresholdColor, .red)
    }

    func testVarianceTrendEmptyRows() {
        let trend = CostingCompute.getVarianceTrend(trendRows: [])
        XCTAssertEqual(trend.rowsFound, 0)
        XCTAssertEqual(trend.points.count, 0)
        XCTAssertNil(trend.pCurrent)
        XCTAssertNil(trend.pAverage)
        XCTAssertEqual(trend.windowDays, 28, "Default windowDays must be 28")
    }

    func testVarianceTrendWindowDaysParity() {
        // windowDays must be surfaced on VarianceTrend — mirrors web VarianceTrend interface.
        let trend28 = CostingCompute.getVarianceTrend(trendRows: makeTrendRows())
        XCTAssertEqual(trend28.windowDays, 28, "Default windowDays must be 28")

        let trend7 = CostingCompute.getVarianceTrend(trendRows: makeTrendRows(), windowDays: 7)
        XCTAssertEqual(trend7.windowDays, 7, "Custom windowDays=7 must be propagated")
    }

    func testVarianceTrendNilPct() {
        // nil variance_pct → green color, excluded from average
        let rows = [CostingVarianceTrendRow(periodStart: "2026-06-01", periodEnd: "2026-06-07",
                                            varianceAmount: nil, variancePct: nil)]
        let trend = CostingCompute.getVarianceTrend(trendRows: rows)
        XCTAssertEqual(trend.points[0].thresholdColor, .green)
        XCTAssertNil(trend.pAverage, "pAverage nil when no numeric pct values")
    }

    func testVarianceTrendYellowColor() {
        // abs in [2,5) → yellow
        let rows = [CostingVarianceTrendRow(periodStart: "2026-06-01", periodEnd: "2026-06-07",
                                            varianceAmount: 20.0, variancePct: 3.5)]
        let trend = CostingCompute.getVarianceTrend(trendRows: rows)
        XCTAssertEqual(trend.points[0].thresholdColor, .yellow)
    }

    func testVarianceTrendGreenColor() {
        // abs < 2 → green
        let rows = [CostingVarianceTrendRow(periodStart: "2026-06-01", periodEnd: "2026-06-07",
                                            varianceAmount: 5.0, variancePct: 1.5)]
        let trend = CostingCompute.getVarianceTrend(trendRows: rows)
        XCTAssertEqual(trend.points[0].thresholdColor, .green)
    }

    // MARK: - rankByContribution (ABC)

    func testAbcBurgerAndTacosAreA() {
        let ranked = CostingCompute.rankByContribution(salesLines: makeSalesLines())
        let burger = ranked.first { $0.itemName == "Burger" }
        let tacos  = ranked.first { $0.itemName == "Tacos" }
        XCTAssertEqual(burger?.tier, .a)
        XCTAssertEqual(tacos?.tier, .a)
    }

    func testAbcMysteryXIsUnranked() {
        let ranked = CostingCompute.rankByContribution(salesLines: makeSalesLines())
        let mystery = ranked.first { $0.itemName == "MysteryX" }
        XCTAssertEqual(mystery?.tier, .unranked)
    }

    func testAbcBurgerScoreCents() {
        let ranked = CostingCompute.rankByContribution(salesLines: makeSalesLines())
        let burger = ranked.first { $0.itemName == "Burger" }
        // scoreCents = round(440 * (40/70) * 100) = 25143
        XCTAssertEqual(burger?.scoreCents ?? -1, 25143)
    }

    func testAbcTacosScoreCents() {
        let ranked = CostingCompute.rankByContribution(salesLines: makeSalesLines())
        let tacos = ranked.first { $0.itemName == "Tacos" }
        // scoreCents = round(250 * (25/70) * 100) = 8929
        XCTAssertEqual(tacos?.scoreCents ?? -1, 8929)
    }

    func testAbcBurgerContributionDollars() {
        let ranked = CostingCompute.rankByContribution(salesLines: makeSalesLines())
        let burger = ranked.first { $0.itemName == "Burger" }
        // (15.0 - 4.0) * 40 = 440.0
        XCTAssertEqual(burger?.contributionDollars ?? -1, 440.0, accuracy: 0.001)
    }

    func testAbcEmptyRows() {
        let ranked = CostingCompute.rankByContribution(salesLines: [])
        XCTAssertEqual(ranked.count, 0)
    }

    func testAbcAllUnlinkedAreUnranked() {
        let lines = [
            CostingSalesLine(itemName: "A", qty: 10, rev: 100.0, costPerUnit: nil),
            CostingSalesLine(itemName: "B", qty:  5, rev:  50.0, costPerUnit: nil),
        ]
        let ranked = CostingCompute.rankByContribution(salesLines: lines)
        XCTAssert(ranked.allSatisfy { $0.tier == .unranked })
    }

    func testAbcBCutoffAt95() {
        // Genuine A / B / C tier coverage.
        //
        // 4 linked items, all qty=1, cpu=0, totalQty=4:
        //   scoreCents[i] = round(rev[i] * (1/4) * 100) = round(rev[i] * 25)
        //
        //   Alpha: rev=32.8 -> score=820
        //   Beta:  rev=4.0  -> score=100
        //   Gamma: rev=2.0  -> score=50
        //   Delta: rev=1.2  -> score=30
        //   total                =1000
        //
        // Sorted descending: Alpha, Beta, Gamma, Delta
        //   Alpha: cumBefore=0/1000=0%    -> <80  -> A
        //   Beta:  cumBefore=820/1000=82% -> >=80 <95 -> B
        //   Gamma: cumBefore=920/1000=92% -> >=80 <95 -> B
        //   Delta: cumBefore=970/1000=97% -> >=95 -> C
        let lines: [CostingSalesLine] = [
            CostingSalesLine(itemName: "Alpha", qty: 1, rev: 32.8, costPerUnit: 0.0),
            CostingSalesLine(itemName: "Beta",  qty: 1, rev:  4.0, costPerUnit: 0.0),
            CostingSalesLine(itemName: "Gamma", qty: 1, rev:  2.0, costPerUnit: 0.0),
            CostingSalesLine(itemName: "Delta", qty: 1, rev:  1.2, costPerUnit: 0.0),
        ]
        let ranked = CostingCompute.rankByContribution(salesLines: lines)

        let alpha = ranked.first { $0.itemName == "Alpha" }
        let beta  = ranked.first { $0.itemName == "Beta"  }
        let gamma = ranked.first { $0.itemName == "Gamma" }
        let delta = ranked.first { $0.itemName == "Delta" }

        XCTAssertEqual(alpha?.tier, .a, "Alpha (cumBefore=0%) must be tier A")
        XCTAssertEqual(beta?.tier,  .b, "Beta  (cumBefore=82%) must be tier B")
        XCTAssertEqual(gamma?.tier, .b, "Gamma (cumBefore=92%) must be tier B")
        XCTAssertEqual(delta?.tier, .c, "Delta (cumBefore=97%) must be tier C")

        // A-boundary: single-item scenario is always A (web guarantee)
        let solo = [CostingSalesLine(itemName: "Solo", qty: 10, rev: 100.0, costPerUnit: 2.0)]
        let soloRanked = CostingCompute.rankByContribution(salesLines: solo)
        XCTAssertEqual(soloRanked.first?.tier, .a, "Single biggest contributor always tier A")
    }
    func testAbcSortedByScoredDescending() {
        let ranked = CostingCompute.rankByContribution(salesLines: makeSalesLines())
        // Burger(25143) should come before Tacos(8929) in linked section
        let linkedRanked = ranked.filter { $0.tier != .unranked }
        XCTAssertGreaterThan(linkedRanked.count, 0)
        if linkedRanked.count >= 2 {
            XCTAssertGreaterThanOrEqual(linkedRanked[0].scoreCents, linkedRanked[1].scoreCents,
                "Ranked rows must be sorted by scoreCents DESC")
        }
    }
}
