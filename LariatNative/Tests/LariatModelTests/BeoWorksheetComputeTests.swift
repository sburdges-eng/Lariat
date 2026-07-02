import XCTest
@testable import LariatModel

/// Value-parity tests for `BeoWorksheetCompute` — the prep-sheet money math
/// embedded in `app/beo/BeoBoard.tsx` (`roundMoney`, per-line totals, the
/// subtotal → tax → service-fee → total footer, and the consecutive-category
/// GROUP-NOTE row grouping). The web keeps this math inline in the component
/// (no lib module, no dedicated JS unit tests) — cases are authored against
/// the component code and pinned here.
final class BeoWorksheetComputeTests: XCTestCase {

    // ── roundMoney = Math.round(n * 100) / 100 ──────────────────────────

    func testRoundMoney() {
        // IEEE-754 parity with JS Math.round(n*100)/100 — the binary
        // representation puts these *.x5 inputs just under the boundary:
        XCTAssertEqual(BeoWorksheetCompute.roundMoney(1.005), 1.0)   // 1.005*100 = 100.49999… → 100
        XCTAssertEqual(BeoWorksheetCompute.roundMoney(1.015), 1.01)  // 1.015*100 = 101.49999… → 101
        XCTAssertEqual(BeoWorksheetCompute.roundMoney(2.675), 2.68)  // 2.675*100 = 267.50000…06 → 268
        XCTAssertEqual(BeoWorksheetCompute.roundMoney(1.125), 1.13)  // 1.125*100 = 112.5 exactly → half-up 113
        XCTAssertEqual(BeoWorksheetCompute.roundMoney(0), 0)
        XCTAssertEqual(BeoWorksheetCompute.roundMoney(14.5 * 40), 580)
    }

    // ── line totals + footer (values mirror test-beo-worksheet seeds) ────

    func testLineTotal() {
        XCTAssertEqual(BeoWorksheetCompute.lineTotal(unitCost: 14.5, quantity: 40), 580.0)
        XCTAssertEqual(BeoWorksheetCompute.lineTotal(unitCost: 6.5, quantity: 30), 195.0)
        XCTAssertEqual(BeoWorksheetCompute.lineTotal(unitCost: 0, quantity: 1), 0.0)
    }

    func testTotalsWithDefaultRates() {
        // Enchiladas 14.5×40 + Queso 6.5×30 → subtotal 775
        // tax  = round(775 × 0.0675) = 52.31
        // fee  = round(775 × 20/100) = 155
        // total = round(775 + 52.31 + 155) = 982.31
        let t = BeoWorksheetCompute.totals(
            lines: [.init(unitCost: 14.5, quantity: 40), .init(unitCost: 6.5, quantity: 30)],
            taxRate: 0.0675,
            serviceFeePct: 20
        )
        XCTAssertEqual(t.subtotal, 775.0)
        XCTAssertEqual(t.tax, 52.31)
        XCTAssertEqual(t.fee, 155.0)
        XCTAssertEqual(t.total, 982.31)
    }

    func testTotalsTreatNilRatesAsZero() {
        // Web: Number(event.tax_rate || 0) — null/undefined → 0.
        let t = BeoWorksheetCompute.totals(
            lines: [.init(unitCost: 10, quantity: 2)],
            taxRate: nil,
            serviceFeePct: nil
        )
        XCTAssertEqual(t.subtotal, 20.0)
        XCTAssertEqual(t.tax, 0.0)
        XCTAssertEqual(t.fee, 0.0)
        XCTAssertEqual(t.total, 20.0)
    }

    func testEmptySheetTotals() {
        let t = BeoWorksheetCompute.totals(lines: [], taxRate: 0.0675, serviceFeePct: 20)
        XCTAssertEqual(t.subtotal, 0)
        XCTAssertEqual(t.tax, 0)
        XCTAssertEqual(t.fee, 0)
        XCTAssertEqual(t.total, 0)
    }

    // ── consecutive-category grouping (merged-A-column behavior) ─────────

    func testCategoryRunsGroupConsecutiveRowsOnly() {
        // Entree, Entree, Starter, Entree → three runs (non-adjacent Entree
        // rows do NOT merge — mirrors the xlsx merged-column semantics).
        let runs = BeoWorksheetCompute.categoryRuns(["Entree", "Entree", "Starter", "Entree"])
        XCTAssertEqual(runs.map(\.category), ["Entree", "Starter", "Entree"])
        XCTAssertEqual(runs.map(\.indices), [0..<2, 2..<3, 3..<4])
    }

    func testCategoryRunsTreatNilAsEmptyString() {
        let runs = BeoWorksheetCompute.categoryRuns([nil, nil, "Sides"])
        XCTAssertEqual(runs.map(\.category), ["", "Sides"])
        XCTAssertEqual(runs.map(\.indices), [0..<2, 2..<3])
    }

    func testCategoryRunsEmpty() {
        XCTAssertTrue(BeoWorksheetCompute.categoryRuns([]).isEmpty)
    }
}
