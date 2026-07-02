import XCTest
@testable import LariatModel

// Parity port of the COMPUTATION cases in `tests/js/test-settlement-pdf.mjs`
// (renderSettlementHtml section). Web-transport cases — DOCTYPE/HTML shell,
// XSS escaping, @media print, window.print(), CSP headers — have no native
// analog (the native preview is plain monospaced text; macOS print = H6).
final class SettlementPrintComputeTests: XCTestCase {

    // The exact `sampleSummary` fixture from the web test.
    private func sampleSummary(
        netDoorCents: Int = 32500,
        toastRows: Int = 1
    ) -> SettlementSummary {
        SettlementSummary(
            show: .init(id: 1, bandName: "Bob's Heavy Sounds", date: "2026-05-01", locationId: "default"),
            deal: DealPoint(
                guaranteeCents: 100000, vsPctAfterCosts: 0.85,
                costsOffTop: [DealCost(label: "Sound", cents: 5000)], buyoutCents: 0
            ),
            ticketing: .init(
                grossCents: 250000, feesCents: 25000, netCents: 225000,
                bySource: [
                    .dice: .init(qty: 100, grossCents: 250000),
                    .walkup: .init(qty: 0, grossCents: 0),
                    .comp: .init(qty: 0, grossCents: 0),
                    .will_call: .init(qty: 0, grossCents: 0),
                    .guestlist: .init(qty: 0, grossCents: 0),
                ]
            ),
            toast: .init(totalCents: 123456, ordersCount: 87, guestsCount: 142,
                         attributionDate: "2026-05-01", rowsFound: toastRows),
            talent: TalentPayout(guaranteeCents: 100000, vsBonusCents: 87500,
                                 buyoutCents: 0, totalCents: 187500),
            costsOffTopCents: 5000,
            netDoorCents: netDoorCents,
            computedAt: "2026-05-13T00:00:00.000Z"
        )
    }

    func testContainsBandName() {
        XCTAssertTrue(SettlementPrintCompute.renderText(sampleSummary()).contains("Bob's Heavy Sounds"))
    }

    func testFormatsMoneyWithGrouping() {
        let text = SettlementPrintCompute.renderText(sampleSummary())
        XCTAssertTrue(text.contains("$2,500.00"), "gross 250000 cents")
        XCTAssertTrue(text.contains("$1,875.00"), "talent total 187500 cents")
        XCTAssertTrue(text.contains("$325.00"), "net door 32500 cents")
    }

    func testRendersNegativeAmountsWithLeadingMinus() {
        let text = SettlementPrintCompute.renderText(sampleSummary(netDoorCents: -12345))
        XCTAssertTrue(text.contains("-$123.45"))
    }

    func testListsEveryTicketSourceWithNonZeroQty() {
        let text = SettlementPrintCompute.renderText(sampleSummary())
        XCTAssertTrue(text.contains("DICE"))
        XCTAssertTrue(text.contains("100")) // qty
    }

    func testHidesTicketSourcesWithZeroQty() {
        let text = SettlementPrintCompute.renderText(sampleSummary())
        XCTAssertFalse(text.contains("Walk-up"), "walk-up has qty 0, should not appear")
    }

    func testShowsCostsOffTopLineItems() {
        let text = SettlementPrintCompute.renderText(sampleSummary())
        XCTAssertTrue(text.contains("Sound"))
        XCTAssertTrue(text.contains("$50.00"))
        XCTAssertTrue(text.contains("Total costs off top"))
    }

    func testRendersShowDateInIsoForm() {
        XCTAssertTrue(SettlementPrintCompute.renderText(sampleSummary()).contains("2026-05-01"))
    }

    func testWarningRowWhenToastHasNoRows() {
        let text = SettlementPrintCompute.renderText(sampleSummary(toastRows: 0))
        XCTAssertTrue(text.lowercased().contains("no toast rows"))
        XCTAssertNil(SettlementPrintCompute.toastWarning(sampleSummary(toastRows: 1)))
    }

    func testEmptyStatesForTicketsAndCosts() {
        var s = sampleSummary()
        s = SettlementSummary(
            show: s.show,
            deal: DealPoint(guaranteeCents: 0, vsPctAfterCosts: nil, costsOffTop: [], buyoutCents: 0),
            ticketing: .init(grossCents: 0, feesCents: 0, netCents: 0,
                             bySource: [:]),
            toast: s.toast, talent: TalentPayout(guaranteeCents: 0, vsBonusCents: 0, buyoutCents: 0, totalCents: 0),
            costsOffTopCents: 0, netDoorCents: 0, computedAt: s.computedAt
        )
        let text = SettlementPrintCompute.renderText(s)
        XCTAssertTrue(text.contains("No ticket lines yet."))
        XCTAssertTrue(text.contains("No costs off top."))
    }

    func testVsPctLabel() {
        XCTAssertEqual(SettlementPrintCompute.vsPctLabel(0.85), "85%")
        XCTAssertEqual(SettlementPrintCompute.vsPctLabel(nil), "—")
        XCTAssertEqual(SettlementPrintCompute.vsPctLabel(0.655), "66%") // toFixed(0) of 65.5 → 66
    }

    func testDollarsFormatting() {
        XCTAssertEqual(SettlementPrintCompute.dollars(0), "$0.00")
        XCTAssertEqual(SettlementPrintCompute.dollars(5), "$0.05")
        XCTAssertEqual(SettlementPrintCompute.dollars(123456789), "$1,234,567.89")
        XCTAssertEqual(SettlementPrintCompute.dollars(-12345), "-$123.45")
    }

    func testSourceLabelsMatchWeb() {
        XCTAssertEqual(SettlementPrintCompute.sourceLabel("dice"), "DICE")
        XCTAssertEqual(SettlementPrintCompute.sourceLabel("walkup"), "Walk-up")
        XCTAssertEqual(SettlementPrintCompute.sourceLabel("will_call"), "Will call")
        XCTAssertEqual(SettlementPrintCompute.sourceLabel("guestlist"), "Guest list")
        XCTAssertEqual(SettlementPrintCompute.sourceLabel("mystery"), "mystery")
    }
}
