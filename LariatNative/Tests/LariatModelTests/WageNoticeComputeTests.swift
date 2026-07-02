import XCTest
@testable import LariatModel

/// Value-parity port of `tests/js/test-wage-notices-rules.mjs` — the pure rules
/// from `lib/wageNotices.ts` (validateNoticeShape, requiresNewNotice with the
/// 365-inclusive / 366-required boundary, summarizeFreshness). Money is Int cents.
final class WageNoticeComputeTests: XCTestCase {

    private func prev(
        cook: String = "alice",
        reason: WageNoticeReason = .hire,
        wage: Int = 1500,
        basis: WageNoticePayBasis = .hourly,
        tip: Int? = nil,
        signedOn: String = "2025-01-01"
    ) -> WageNoticeRow {
        WageNoticeRow(
            id: 1, locationId: "default", cookId: cook, reason: reason,
            wageRateCents: wage, payBasis: basis, tipCreditCents: tip,
            documentPath: nil, signedOn: signedOn, createdAt: nil
        )
    }

    private func shape(
        reason: String? = "hire", basis: String? = "hourly", wage: Int? = 1500,
        tip: Int? = nil, signedOn: String? = "2026-01-01", doc: String? = nil
    ) -> WageNoticeShape {
        WageNoticeShape(reason: reason, payBasis: basis, wageRateCents: wage, tipCreditCents: tip, signedOn: signedOn, documentPath: doc)
    }

    // ── constants ──────────────────────────────────────────────────────

    func testRefreshDaysAndCitation() {
        XCTAssertEqual(WageNoticeCompute.refreshDays, 365)
        XCTAssertTrue(WageNoticeCompute.citation.contains("8-4-103"))
        XCTAssertFalse(WageNoticeCompute.citation.contains("8-4-120"))  // NOT the schema-comment value
    }

    // ── validateNoticeShape ────────────────────────────────────────────

    func testValidShapePasses() {
        XCTAssertTrue(WageNoticeCompute.validateNoticeShape(shape()).ok)
    }
    func testRejectsBadReason() {
        XCTAssertFalse(WageNoticeCompute.validateNoticeShape(shape(reason: "promotion")).ok)
    }
    func testRejectsBadPayBasis() {
        XCTAssertFalse(WageNoticeCompute.validateNoticeShape(shape(basis: "piece_rate")).ok)
    }
    func testRejectsNegativeWage() {
        XCTAssertFalse(WageNoticeCompute.validateNoticeShape(shape(wage: -1)).ok)
    }
    func testRejectsTipCreditOnNonTipped() {
        let r = WageNoticeCompute.validateNoticeShape(shape(basis: "hourly", tip: 302))
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.reason?.contains("tipped") ?? false)
    }
    func testAllowsZeroTipCreditOnAnyBasis() {
        XCTAssertTrue(WageNoticeCompute.validateNoticeShape(shape(basis: "salary", tip: 0)).ok)
    }
    func testAllowsTipCreditOnTipped() {
        XCTAssertTrue(WageNoticeCompute.validateNoticeShape(shape(basis: "tipped", tip: 302)).ok)
    }
    func testRejectsNegativeTipCredit() {
        XCTAssertFalse(WageNoticeCompute.validateNoticeShape(shape(basis: "tipped", tip: -1)).ok)
    }
    func testRejectsMalformedSignedOn() {
        XCTAssertFalse(WageNoticeCompute.validateNoticeShape(shape(signedOn: "2026-1-1")).ok)
    }

    // ── requiresNewNotice ──────────────────────────────────────────────

    func testRequiredWhenNoPrev() {
        let n = WageNoticeNext(reason: .hire, wageRateCents: 1500, payBasis: .hourly, tipCreditCents: nil, signedOn: "2026-01-01")
        XCTAssertTrue(WageNoticeCompute.requiresNewNotice(prev: nil, next: n).required)
    }
    func testRequiredOnRateChangeReason() {
        let n = WageNoticeNext(reason: .rate_change, wageRateCents: 1500, payBasis: .hourly, tipCreditCents: nil, signedOn: "2025-06-01")
        XCTAssertTrue(WageNoticeCompute.requiresNewNotice(prev: prev(), next: n).required)
    }
    func testRequiredOnPayBasisChange() {
        let n = WageNoticeNext(reason: .other, wageRateCents: 1500, payBasis: .tipped, tipCreditCents: nil, signedOn: "2025-06-01")
        XCTAssertTrue(WageNoticeCompute.requiresNewNotice(prev: prev(basis: .hourly), next: n).required)
    }
    func testRequiredOnWageChange() {
        let n = WageNoticeNext(reason: .other, wageRateCents: 1600, payBasis: .hourly, tipCreditCents: nil, signedOn: "2025-06-01")
        XCTAssertTrue(WageNoticeCompute.requiresNewNotice(prev: prev(wage: 1500), next: n).required)
    }
    func testRequiredOnTipCreditToggle() {
        // prev has no tip credit; next introduces one → §3.3 event.
        let n = WageNoticeNext(reason: .other, wageRateCents: 1500, payBasis: .tipped, tipCreditCents: 302, signedOn: "2025-06-01")
        XCTAssertTrue(WageNoticeCompute.requiresNewNotice(prev: prev(basis: .tipped, tip: nil), next: n).required)
    }
    func testAnnualBoundary365NotRequired() {
        // 2025-01-01 → 2026-01-01 is exactly 365 days (2025 is not a leap year).
        let n = WageNoticeNext(reason: .annual, wageRateCents: 1500, payBasis: .hourly, tipCreditCents: nil, signedOn: "2026-01-01")
        let r = WageNoticeCompute.requiresNewNotice(prev: prev(signedOn: "2025-01-01"), next: n, today: "2026-01-01")
        XCTAssertFalse(r.required, "exactly 365 days must NOT require a new notice")
    }
    func testAnnualBoundary366Required() {
        let n = WageNoticeNext(reason: .annual, wageRateCents: 1500, payBasis: .hourly, tipCreditCents: nil, signedOn: "2026-01-02")
        let r = WageNoticeCompute.requiresNewNotice(prev: prev(signedOn: "2025-01-01"), next: n, today: "2026-01-02")
        XCTAssertTrue(r.required, "366 days must require a new notice")
    }
    func testNotRequiredWithinWindowNoChange() {
        let n = WageNoticeNext(reason: .annual, wageRateCents: 1500, payBasis: .hourly, tipCreditCents: nil, signedOn: "2025-03-01")
        XCTAssertFalse(WageNoticeCompute.requiresNewNotice(prev: prev(signedOn: "2025-01-01"), next: n, today: "2025-03-01").required)
    }

    // ── summarizeFreshness ─────────────────────────────────────────────

    func testSummarizeFreshnessDaysAndNeedsNew() {
        let rows = [prev(cook: "alice", signedOn: "2025-01-01"), prev(cook: "bob", signedOn: "2026-06-30")]
        let f = WageNoticeCompute.summarizeFreshness(rows, today: "2026-07-01")
        XCTAssertEqual(f.count, 2)
        let alice = f.first { $0.cookId == "alice" }!
        XCTAssertTrue(alice.needsNew)                 // way over 365
        XCTAssertEqual(alice.daysSince, WageNoticeCompute.daysBetween("2025-01-01", "2026-07-01"))
        let bob = f.first { $0.cookId == "bob" }!
        XCTAssertFalse(bob.needsNew)                  // 1 day
        XCTAssertEqual(bob.daysSince, 1)
    }

    func testSummarizeFreshnessEmpty() {
        XCTAssertTrue(WageNoticeCompute.summarizeFreshness([], today: "2026-07-01").isEmpty)
    }
}
