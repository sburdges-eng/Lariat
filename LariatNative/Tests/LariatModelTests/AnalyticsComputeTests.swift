import XCTest
@testable import LariatModel

// Parity tests for AnalyticsCompute against the T5 fixture known values.
//
// Derived values (arithmetic shown):
//   daily cg=1 rows: 4200 + 3900 = 8100.0  → dailyCurrentTotal
//   priorRev = 3800.0
//   yoyDelta = ((8100 - 3800) / 3800) * 100 = 4300/3800 * 100 ≈ 113.1578947...%
//   avgCheck  = 8100 / (180 + 165) = 8100 / 345 ≈ 23.4782608...
//   tradingDays = 2
//   totalSpend  = 14200 + 13500 = 27700
//   periodLabel = "2026-06-09 to 2026-06-15"

final class AnalyticsComputeTests: XCTestCase {

    // ── Helpers ────────────────────────────────────────────────────────────

    private func makeBundle() -> AnalyticsBundle {
        let daily: [AnalyticsDailyRow] = [
            AnalyticsDailyRow(shiftDate: "2026-06-14", netSales: 3900.0, orders: 165, guests: 205),
            AnalyticsDailyRow(shiftDate: "2026-06-15", netSales: 4200.0, orders: 180, guests: 230),
        ]
        let dowCurrent: [AnalyticsDowRow] = [
            AnalyticsDowRow(dayOfWeek: "Sun", netSales: 4200.0, orders: 180, guests: 230),
        ]
        let dowPrior: [AnalyticsDowRow] = [
            AnalyticsDowRow(dayOfWeek: "Sun", netSales: 3800.0, orders: 160, guests: 198),
        ]
        let hourlyCurrent: [AnalyticsHourlyRow] = [
            AnalyticsHourlyRow(hour24: 18, label: "6 PM", netSales: 1200.0, orders: 52, guests: 68),
        ]
        let hourlyPrior: [AnalyticsHourlyRow] = [
            AnalyticsHourlyRow(hour24: 18, label: "6 PM", netSales: 1100.0, orders: 48, guests: 62),
        ]
        let spend: [AnalyticsSpendRow] = [
            AnalyticsSpendRow(month: "2026-04", shamrockTotalSpend: 13500.0),
            AnalyticsSpendRow(month: "2026-05", shamrockTotalSpend: 14200.0),
        ]
        let top: [AnalyticsTopItem] = [
            AnalyticsTopItem(itemName: "Burger",   qty: 40.0, rev: 600.0),
            AnalyticsTopItem(itemName: "Tacos",    qty: 25.0, rev: 375.0),
            AnalyticsTopItem(itemName: "MysteryX", qty:  5.0, rev:  75.0),
        ]
        return AnalyticsBundle(
            daily: daily,
            dowCurrent: dowCurrent,
            dowPrior: dowPrior,
            hourlyCurrent: hourlyCurrent,
            hourlyPrior: hourlyPrior,
            spend: spend,
            top: top,
            dailyPriorRev: 3800.0,
            dateRange: "2026-06-09 to 2026-06-15"
        )
    }

    // ── dailyCurrentTotal ──────────────────────────────────────────────────

    func testDailyCurrentTotal() {
        let kpis = AnalyticsCompute.summarize(bundle: makeBundle())
        XCTAssertEqual(kpis.dailyCurrentTotal, 8100.0, accuracy: 0.001)
    }

    // ── yoyDelta ───────────────────────────────────────────────────────────

    func testYoyDelta() {
        let kpis = AnalyticsCompute.summarize(bundle: makeBundle())
        let expected = ((8100.0 - 3800.0) / 3800.0) * 100.0
        let actual = kpis.yoyDelta
        XCTAssertNotNil(actual, "yoyDelta should be non-nil when priorRev > 0")
        XCTAssertEqual(actual ?? -1, expected, accuracy: 0.001)
    }

    func testYoyDeltaNilWhenNoPrior() {
        var bundle = makeBundle()
        bundle = AnalyticsBundle(
            daily: bundle.daily,
            dowCurrent: bundle.dowCurrent,
            dowPrior: bundle.dowPrior,
            hourlyCurrent: bundle.hourlyCurrent,
            hourlyPrior: bundle.hourlyPrior,
            spend: bundle.spend,
            top: bundle.top,
            dailyPriorRev: 0.0,    // zero-guard: priorRev == 0 → nil
            dateRange: bundle.dateRange
        )
        let kpis = AnalyticsCompute.summarize(bundle: bundle)
        XCTAssertNil(kpis.yoyDelta, "yoyDelta must be nil when priorRev == 0")
    }

    func testYoyDeltaNilWhenNegativePrior() {
        // priorRev guard is `> 0`, so a negative prior must also yield nil.
        var bundle = makeBundle()
        bundle = AnalyticsBundle(
            daily: bundle.daily,
            dowCurrent: bundle.dowCurrent,
            dowPrior: bundle.dowPrior,
            hourlyCurrent: bundle.hourlyCurrent,
            hourlyPrior: bundle.hourlyPrior,
            spend: bundle.spend,
            top: bundle.top,
            dailyPriorRev: -1.0,   // negative prior: not > 0, must produce nil
            dateRange: bundle.dateRange
        )
        let kpis = AnalyticsCompute.summarize(bundle: bundle)
        XCTAssertNil(kpis.yoyDelta, "yoyDelta must be nil when priorRev <= 0")
    }

    // ── avgCheck ───────────────────────────────────────────────────────────

    func testAvgCheck() {
        let kpis = AnalyticsCompute.summarize(bundle: makeBundle())
        let expected = 8100.0 / (180.0 + 165.0)  // 8100 / 345 ≈ 23.478
        let actual = try? XCTUnwrap(kpis.avgCheck)
        XCTAssertNotNil(actual, "avgCheck should be non-nil when there are orders")
        if let a = actual { XCTAssertEqual(a, expected, accuracy: 0.001) }
    }

    func testAvgCheckNilWhenNoOrders() {
        let emptyDaily = [AnalyticsDailyRow(shiftDate: "2026-06-14", netSales: 500.0, orders: 0, guests: 0)]
        let bundle = AnalyticsBundle(
            daily: emptyDaily,
            dowCurrent: [], dowPrior: [],
            hourlyCurrent: [], hourlyPrior: [],
            spend: [], top: [],
            dailyPriorRev: 0.0, dateRange: nil
        )
        let kpis = AnalyticsCompute.summarize(bundle: bundle)
        XCTAssertNil(kpis.avgCheck, "avgCheck must be nil when total orders == 0")
    }

    func testAvgCheckNilWhenNoDailyRows() {
        let bundle = AnalyticsBundle(
            daily: [],
            dowCurrent: [], dowPrior: [],
            hourlyCurrent: [], hourlyPrior: [],
            spend: [], top: [],
            dailyPriorRev: 0.0, dateRange: nil
        )
        let kpis = AnalyticsCompute.summarize(bundle: bundle)
        XCTAssertNil(kpis.avgCheck, "avgCheck must be nil when daily is empty")
    }

    // ── periodLabel ────────────────────────────────────────────────────────

    func testPeriodLabel() {
        let kpis = AnalyticsCompute.summarize(bundle: makeBundle())
        XCTAssertEqual(kpis.periodLabel, "2026-06-09 to 2026-06-15")
    }

    func testPeriodLabelEmptyWhenNil() {
        let bundle = AnalyticsBundle(
            daily: [], dowCurrent: [], dowPrior: [],
            hourlyCurrent: [], hourlyPrior: [],
            spend: [], top: [],
            dailyPriorRev: 0.0, dateRange: nil
        )
        let kpis = AnalyticsCompute.summarize(bundle: bundle)
        XCTAssertEqual(kpis.periodLabel, "")
    }

    // ── tradingDays ────────────────────────────────────────────────────────

    func testTradingDays() {
        let kpis = AnalyticsCompute.summarize(bundle: makeBundle())
        XCTAssertEqual(kpis.tradingDays, 2)
    }

    // ── totalSpend ─────────────────────────────────────────────────────────

    func testTotalSpend() {
        let kpis = AnalyticsCompute.summarize(bundle: makeBundle())
        XCTAssertEqual(kpis.totalSpend, 27700.0, accuracy: 0.001)
    }

    // ── DOW pairing ────────────────────────────────────────────────────────

    func testDowPairsBuilt() {
        let kpis = AnalyticsCompute.summarize(bundle: makeBundle())
        XCTAssertEqual(kpis.dowPairs.count, 1)
        XCTAssertEqual(kpis.dowPairs[0].dayOfWeek, "Sun")
        XCTAssertEqual(kpis.dowPairs[0].current.netSales ?? -1, 4200.0, accuracy: 0.001)
        XCTAssertNotNil(kpis.dowPairs[0].prior)
        XCTAssertEqual(kpis.dowPairs[0].prior?.netSales ?? -1, 3800.0, accuracy: 0.001)
    }


    func testDowPairsDedupeAndSort() {
        let bundle = AnalyticsBundle(
            daily: [],
            dowCurrent: [
                AnalyticsDowRow(dayOfWeek: "Mon", netSales: 100.0, orders: 10, guests: 12),
                AnalyticsDowRow(dayOfWeek: "Mon", netSales: 200.0, orders: 20, guests: 24),
                AnalyticsDowRow(dayOfWeek: "Wed", netSales: 50.0, orders: 5, guests: 6),
            ],
            dowPrior: [],
            hourlyCurrent: [], hourlyPrior: [],
            spend: [], top: [],
            dailyPriorRev: nil, dateRange: nil
        )
        let kpis = AnalyticsCompute.summarize(bundle: bundle)
        XCTAssertEqual(kpis.dowPairs.map(\.dayOfWeek), ["Mon", "Wed"])
        XCTAssertEqual(kpis.dowPairs[0].current.netSales ?? -1, 200.0, accuracy: 0.001)
    }

    // ── Hourly pairing ─────────────────────────────────────────────────────

    func testHourlyPairsBuilt() {
        let kpis = AnalyticsCompute.summarize(bundle: makeBundle())
        XCTAssertEqual(kpis.hourlyPairs.count, 1)
        XCTAssertEqual(kpis.hourlyPairs[0].hour24, 18)
        XCTAssertEqual(kpis.hourlyPairs[0].current.netSales ?? -1, 1200.0, accuracy: 0.001)
        XCTAssertNotNil(kpis.hourlyPairs[0].prior)
        XCTAssertEqual(kpis.hourlyPairs[0].prior?.netSales ?? -1, 1100.0, accuracy: 0.001)
    }

    // ── Top items passthrough ──────────────────────────────────────────────

    func testTopItemsPassthrough() {
        let kpis = AnalyticsCompute.summarize(bundle: makeBundle())
        XCTAssertEqual(kpis.topItems.count, 3)
        XCTAssertEqual(kpis.topItems[0].itemName, "Burger")
        XCTAssertEqual(kpis.topItems[0].rev ?? -1, 600.0, accuracy: 0.001)
    }
}
