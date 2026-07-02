import XCTest
@testable import LariatModel

// Value-parity port of `tests/js/test-settlement-deal-parser.mjs` plus the
// validation cases of `tests/js/test-settlement-route.mjs` (the 422 deal
// contract). Money-critical: USD→cents rounds at the boundary; the vs bonus
// floors (venue-favorable) — asserted in the payout section.
final class DealPointsComputeTests: XCTestCase {

    // ── parseDealTerms: valid shapes ───────────────────────────────────

    func testGuaranteeOnlyDeal() throws {
        let terms = try DealPointsCompute.parseDealTerms(["guarantee_usd": 1500])
        XCTAssertEqual(terms.guaranteeUsd, 1500)
        XCTAssertNil(terms.vsPctAfterCosts)   // key absent
        XCTAssertNil(terms.costsOffTop)
        XCTAssertNil(terms.buyoutUsd)
    }

    func testVsPctDeal() throws {
        let terms = try DealPointsCompute.parseDealTerms([
            "guarantee_usd": 1000, "vs_pct_after_costs": 0.85,
        ])
        XCTAssertEqual(terms.guaranteeUsd, 1000)
        XCTAssertEqual(terms.vsPctAfterCosts, .some(.some(0.85)))
    }

    func testCostsOffTopDeal() throws {
        let terms = try DealPointsCompute.parseDealTerms([
            "guarantee_usd": 800,
            "vs_pct_after_costs": 0.80,
            "costs_off_top": [
                ["label": "Sound", "amount_usd": 50],
                ["label": "Backline", "amount_usd": 75],
            ],
        ])
        XCTAssertEqual(terms.guaranteeUsd, 800)
        XCTAssertEqual(terms.costsOffTop?.count, 2)
        XCTAssertEqual(terms.costsOffTop?[0].label, "Sound")
        XCTAssertEqual(terms.costsOffTop?[0].amountUsd, 50)
    }

    func testFullDeal() throws {
        let terms = try DealPointsCompute.parseDealTerms([
            "guarantee_usd": 2500,
            "vs_pct_after_costs": 0.65,
            "costs_off_top": [["label": "Hospitality", "amount_usd": 200]],
            "buyout_usd": 250,
        ])
        XCTAssertEqual(terms.guaranteeUsd, 2500)
        XCTAssertEqual(terms.vsPctAfterCosts, .some(.some(0.65)))
        XCTAssertEqual(terms.buyoutUsd, 250)
    }

    func testExplicitNullVsPctIsFlatDeal() throws {
        let terms = try DealPointsCompute.parseDealTerms([
            "guarantee_usd": 1000, "vs_pct_after_costs": NSNull(),
        ])
        XCTAssertEqual(terms.guaranteeUsd, 1000)
        XCTAssertEqual(terms.vsPctAfterCosts, .some(.none))
    }

    func testZeroGuaranteeIsValid() throws {
        XCTAssertEqual(try DealPointsCompute.parseDealTerms(["guarantee_usd": 0]).guaranteeUsd, 0)
    }

    // ── parseDealTerms: rejection cases ────────────────────────────────

    private func assertInvalidShape(_ json: Any?, contains fragment: String,
                                    file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertThrowsError(try DealPointsCompute.parseDealTerms(json), file: file, line: line) { err in
            guard case SettlementError.invalidDealShape(let msg) = err else {
                XCTFail("expected invalidDealShape, got \(err)", file: file, line: line)
                return
            }
            XCTAssertTrue(msg.contains("InvalidDealShape"), msg, file: file, line: line)
            XCTAssertTrue(msg.contains(fragment), msg, file: file, line: line)
        }
    }

    func testMissingGuaranteeThrows() {
        assertInvalidShape([String: Any](), contains: "guarantee_usd")
    }

    func testNonNumericGuaranteeThrows() {
        assertInvalidShape(["guarantee_usd": "one thousand"], contains: "guarantee_usd")
    }

    func testNaNGuaranteeThrows() {
        assertInvalidShape(["guarantee_usd": Double.nan], contains: "guarantee_usd")
    }

    func testVsPctAboveOneThrows() {
        assertInvalidShape(["guarantee_usd": 1000, "vs_pct_after_costs": 1.5],
                           contains: "vs_pct_after_costs")
    }

    func testVsPctBelowZeroThrows() {
        assertInvalidShape(["guarantee_usd": 1000, "vs_pct_after_costs": -0.1],
                           contains: "vs_pct_after_costs")
    }

    func testCostItemMissingAmountThrows() {
        assertInvalidShape(
            ["guarantee_usd": 1000, "costs_off_top": [["label": "Sound"]]],
            contains: "costs_off_top[0].amount_usd"
        )
    }

    func testCostItemMissingLabelThrows() {
        assertInvalidShape(
            ["guarantee_usd": 1000, "costs_off_top": [["amount_usd": 50]]],
            contains: "costs_off_top[0].label"
        )
    }

    func testCostsNotAnArrayThrows() {
        assertInvalidShape(
            ["guarantee_usd": 1000, "costs_off_top": #"[{label:"Sound"}]"#],
            contains: "array"
        )
    }

    func testNilInputThrows() {
        assertInvalidShape(nil, contains: "InvalidDealShape")
    }

    func testArrayInputThrows() {
        assertInvalidShape([Any](), contains: "InvalidDealShape")
    }

    // ── dealTermsToDealPoint: USD → cents ──────────────────────────────

    func testConvertsFlatGuaranteeToCents() {
        let pt = DealPointsCompute.dealTermsToDealPoint(DealTerms(guaranteeUsd: 1500))
        XCTAssertEqual(pt.guaranteeCents, 150000)
        XCTAssertNil(pt.vsPctAfterCosts)
        XCTAssertEqual(pt.costsOffTop, [])
        XCTAssertEqual(pt.buyoutCents, 0)
    }

    func testConvertsCostItemsToCents() {
        let pt = DealPointsCompute.dealTermsToDealPoint(DealTerms(
            guaranteeUsd: 800,
            costsOffTop: [DealTermsCostItem(label: "Sound", amountUsd: 50.50)]
        ))
        XCTAssertEqual(pt.costsOffTop[0].cents, 5050)
    }

    func testPreservesVsPctAsIs() {
        let pt = DealPointsCompute.dealTermsToDealPoint(DealTerms(
            guaranteeUsd: 1000, vsPctAfterCosts: .some(.some(0.85))
        ))
        XCTAssertEqual(pt.vsPctAfterCosts, 0.85)
    }

    // ── parseDeal (show_deals row → DealPoint) ─────────────────────────

    func testParseDealRoundTripsRow() throws {
        let deal = try DealPointsCompute.parseDeal(ShowDealRow(
            guaranteeCents: 100000, vsPctAfterCosts: 0.85,
            costsOffTopJson: #"[{"label":"Sound","cents":5000}]"#, buyoutCents: 0
        ))
        XCTAssertEqual(deal.guaranteeCents, 100000)
        XCTAssertEqual(deal.vsPctAfterCosts, 0.85)
        XCTAssertEqual(deal.costsOffTop, [DealCost(label: "Sound", cents: 5000)])
        XCTAssertEqual(deal.buyoutCents, 0)
    }

    func testParseDealThrowsOnBadCostsJson() {
        XCTAssertThrowsError(try DealPointsCompute.parseDeal(ShowDealRow(
            guaranteeCents: 0, vsPctAfterCosts: nil,
            costsOffTopJson: #"{"not":"an array"}"#, buyoutCents: 0
        ))) { err in
            XCTAssertTrue("\(err.localizedDescription)".contains("parseDeal: bad costs_off_top_json"))
        }
        XCTAssertThrowsError(try DealPointsCompute.parseDeal(ShowDealRow(
            guaranteeCents: 0, vsPctAfterCosts: nil,
            costsOffTopJson: #"[{"label":"Sound"}]"#, buyoutCents: 0
        ))) { err in
            XCTAssertTrue("\(err.localizedDescription)".contains("costs_off_top_json[0] missing label/cents"))
        }
    }

    // ── computeTalentPayout (venue-favorable floor) ────────────────────

    func testPayoutGuaranteeOnly() {
        let p = DealPointsCompute.computeTalentPayout(
            deal: DealPoint(guaranteeCents: 100000, vsPctAfterCosts: nil, costsOffTop: [], buyoutCents: 0),
            ticketRevenueCents: 300000
        )
        XCTAssertEqual(p.vsBonusCents, 0)
        XCTAssertEqual(p.totalCents, 100000)
    }

    func testPayoutVsBonusFloorsFractionalCent() {
        // The web parity anchor from test-settlement-repo:
        // overage = 300000 − 5000 − 100000 = 195000; floor(195000 × 0.85) = 165750.
        let p = DealPointsCompute.computeTalentPayout(
            deal: DealPoint(
                guaranteeCents: 100000, vsPctAfterCosts: 0.85,
                costsOffTop: [DealCost(label: "Sound", cents: 5000)], buyoutCents: 0
            ),
            ticketRevenueCents: 300000
        )
        XCTAssertEqual(p.vsBonusCents, 165750)
        XCTAssertEqual(p.totalCents, 265750)

        // Non-clean overage: 1_000_001 × 0.65 = 650_000.65 → floors to 650_000
        // (talent loses the fractional cent — venue-favorable convention).
        let q = DealPointsCompute.computeTalentPayout(
            deal: DealPoint(guaranteeCents: 0, vsPctAfterCosts: 0.65, costsOffTop: [], buyoutCents: 0),
            ticketRevenueCents: 1_000_001
        )
        XCTAssertEqual(q.vsBonusCents, 650_000)
    }

    func testPayoutNoNegativeOverage() {
        let p = DealPointsCompute.computeTalentPayout(
            deal: DealPoint(guaranteeCents: 100000, vsPctAfterCosts: 0.85, costsOffTop: [], buyoutCents: 2500),
            ticketRevenueCents: 50000
        )
        XCTAssertEqual(p.vsBonusCents, 0)
        XCTAssertEqual(p.totalCents, 102500)
    }

    // ── validateDeal (route 422 contract) ──────────────────────────────

    func testValidateRejectsNegativeGuarantee() {
        XCTAssertEqual(
            DealPointsCompute.validateDeal(DealPoint(
                guaranteeCents: -100, vsPctAfterCosts: nil, costsOffTop: [], buyoutCents: 0
            )),
            "guaranteeCents: non-negative integer required"
        )
    }

    func testValidateRejectsVsPctAboveOne() {
        XCTAssertEqual(
            DealPointsCompute.validateDeal(DealPoint(
                guaranteeCents: 0, vsPctAfterCosts: 1.5, costsOffTop: [], buyoutCents: 0
            )),
            "vsPctAfterCosts: null or 0-1"
        )
    }

    func testValidateRejectsNegativeBuyoutAndCostCents() {
        XCTAssertEqual(
            DealPointsCompute.validateDeal(DealPoint(
                guaranteeCents: 0, vsPctAfterCosts: nil, costsOffTop: [], buyoutCents: -1
            )),
            "buyoutCents: non-negative integer required"
        )
        XCTAssertEqual(
            DealPointsCompute.validateDeal(DealPoint(
                guaranteeCents: 0, vsPctAfterCosts: nil,
                costsOffTop: [DealCost(label: "Sound", cents: -5)], buyoutCents: 0
            )),
            "costsOffTop[0].cents: non-negative integer required"
        )
    }

    func testValidateAcceptsValidDeal() {
        XCTAssertNil(DealPointsCompute.validateDeal(DealPoint(
            guaranteeCents: 120000, vsPctAfterCosts: 0.8,
            costsOffTop: [DealCost(label: "Sound", cents: 4000)], buyoutCents: 0
        )))
        XCTAssertEqual(DealPointsCompute.validateDeal(nil), "deal: must be an object")
    }
}
