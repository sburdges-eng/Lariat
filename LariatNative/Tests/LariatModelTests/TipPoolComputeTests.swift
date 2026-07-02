import XCTest
@testable import LariatModel

// Value-parity port of `tests/js/test-tip-pool-rules.mjs` — COMPS #39 §3.3/§3.4
// + FLSA tip credit. Every JS case has a 1:1 native test below. The
// `2410¢/8h → 8¢` makeup case is the asymmetric floor/ceil rounding tripwire.
final class TipPoolComputeTests: XCTestCase {

    // ── COMPS #39 / FLSA constants ─────────────────────────────────────

    func testStandardMinWage() {
        XCTAssertEqual(TipPoolCompute.stdMinWageCents2026, 1481)
    }
    func testTippedMinWage() {
        XCTAssertEqual(TipPoolCompute.tippedMinWageCents2026, 1179)
    }
    func testTipCredit() {
        XCTAssertEqual(TipPoolCompute.tipCreditCents2026, 302)
    }
    func testTippedPlusCreditEqualsStandard() {
        XCTAssertEqual(TipPoolCompute.tippedMinWageCents2026 + TipPoolCompute.tipCreditCents2026,
                       TipPoolCompute.stdMinWageCents2026)
    }
    func testCitationReferencesCompsAnd531() {
        XCTAssertTrue(TipPoolCompute.citation.contains("COMPS"))
        XCTAssertTrue(TipPoolCompute.citation.contains("531"))
        XCTAssertEqual(TipPoolCompute.citation, "7 CCR 1103-1 §3.3 / §3.4 (COMPS Order #39); 29 CFR 531.52")
    }

    // ── isPoolEligible ─────────────────────────────────────────────────

    func testTippedServerNoFlagsEligible() {
        XCTAssertTrue(TipPoolCompute.isPoolEligible([], role: "server"))
    }
    func testManagerRoleExcluded() {
        XCTAssertFalse(TipPoolCompute.isPoolEligible([], role: "manager"))
    }
    func testOwnerRoleExcluded() {
        XCTAssertFalse(TipPoolCompute.isPoolEligible([], role: "owner"))
    }
    func testActiveManagerFlagExcludes() {
        XCTAssertFalse(TipPoolCompute.isPoolEligible(
            [StaffFlag(cookId: "a", flag: "manager", effectiveTo: nil)], role: "server"))
    }
    func testExpiredManagerFlagDoesNotExclude() {
        XCTAssertTrue(TipPoolCompute.isPoolEligible(
            [StaffFlag(cookId: "a", flag: "manager", effectiveTo: "2025-12-31")], role: "server"))
    }
    func testCaseInsensitiveRoleMatch() {
        XCTAssertFalse(TipPoolCompute.isPoolEligible([], role: "MANAGER"))
        XCTAssertFalse(TipPoolCompute.isPoolEligible([], role: "Owner"))
    }
    func testExemptFlagExcludes() {
        XCTAssertFalse(TipPoolCompute.isPoolEligible(
            [StaffFlag(cookId: "a", flag: "exempt", effectiveTo: nil)], role: "server"))
    }

    // ── validateTipCreditPeriod ────────────────────────────────────────

    private func base(hourlyWageCents: Int, tipsReceivedCents: Int, hoursWorked: Double) -> TipCreditPeriodInput {
        TipCreditPeriodInput(
            tippedMinWageCents: TipPoolCompute.tippedMinWageCents2026,
            tipCreditCents: TipPoolCompute.tipCreditCents2026,
            hourlyWageCents: hourlyWageCents,
            tipsReceivedCents: tipsReceivedCents,
            hoursWorked: hoursWorked
        )
    }

    func testCleanCompliantPeriodTipsWellAboveCredit() {
        let r = TipPoolCompute.validateTipCreditPeriod(
            base(hourlyWageCents: 1179, tipsReceivedCents: 5000, hoursWorked: 8))
        XCTAssertTrue(r.ok)
        XCTAssertEqual(r.makeupCents, 0)
        XCTAssertGreaterThanOrEqual(r.effectiveHourlyCents, 1481)
    }

    func testExactFloorPeriodCompliant() {
        let r = TipPoolCompute.validateTipCreditPeriod(
            base(hourlyWageCents: 1179, tipsReceivedCents: 302 * 10, hoursWorked: 10))
        XCTAssertTrue(r.ok)
        XCTAssertEqual(r.makeupCents, 0)
    }

    func testShortfallNoTipsOwesFullCreditTimesHours() {
        let r = TipPoolCompute.validateTipCreditPeriod(
            base(hourlyWageCents: 1179, tipsReceivedCents: 0, hoursWorked: 10))
        XCTAssertFalse(r.ok)
        XCTAssertEqual(r.makeupCents, 302 * 10)
        XCTAssertTrue(r.reason?.range(of: "below.*floor", options: .regularExpression) != nil,
                      "reason should match /below.*floor/, got \(r.reason ?? "nil")")
    }

    /// The asymmetric floor/ceil tripwire: tips_per_hour = floor(2410/8) = 301,
    /// cash 1179, effective 1480; floor 1481, shortfall 1; makeup = ceil(1*8) = 8.
    func testPartialShortfall2410Over8Yields8() {
        let r = TipPoolCompute.validateTipCreditPeriod(
            base(hourlyWageCents: 1179, tipsReceivedCents: 2410, hoursWorked: 8))
        XCTAssertFalse(r.ok)
        XCTAssertEqual(r.makeupCents, 8)
    }

    func testCashWageAboveStandardMinNoShortfall() {
        let r = TipPoolCompute.validateTipCreditPeriod(
            base(hourlyWageCents: 1500, tipsReceivedCents: 0, hoursWorked: 8))
        XCTAssertTrue(r.ok)
        XCTAssertEqual(r.makeupCents, 0)
    }

    /// JS passes `tips_received_cents: 50.5` (a float) → rejected with
    /// `/integer cents/`. In Swift the money fields are typed `Int`, so a float
    /// literal cannot be constructed — the integer-cents invariant is enforced by
    /// the type system. This test documents that boundary: an integer amount is
    /// accepted normally (the float path is structurally unrepresentable).
    func testIntegerCentsInvariantEnforcedByType() {
        // Nearest integer equivalent (50) is accepted — floats can't reach here.
        let r = TipPoolCompute.validateTipCreditPeriod(
            base(hourlyWageCents: 1179, tipsReceivedCents: 50, hoursWorked: 8))
        // 50/8 = 6.25 → floor 6; eff 1185; floor 1481; shortfall 296; makeup ceil(296*8)=2368.
        XCTAssertFalse(r.ok)
        XCTAssertEqual(r.makeupCents, 2368)
    }

    func testRejectsCashWageBelowTippedMinimum() {
        let r = TipPoolCompute.validateTipCreditPeriod(
            base(hourlyWageCents: 1100, tipsReceivedCents: 5000, hoursWorked: 8))
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.reason?.contains("below tipped minimum") == true,
                      "reason should match /below tipped minimum/, got \(r.reason ?? "nil")")
    }

    func testHoursZeroReturnsOkZeroMakeup() {
        let r = TipPoolCompute.validateTipCreditPeriod(
            base(hourlyWageCents: 1179, tipsReceivedCents: 0, hoursWorked: 0))
        XCTAssertTrue(r.ok)
        XCTAssertEqual(r.makeupCents, 0)
    }

    /// Extra guard: non-finite / negative hours are rejected (JS `isFiniteNonNeg`).
    func testRejectsNonFiniteOrNegativeHours() {
        let neg = TipPoolCompute.validateTipCreditPeriod(
            base(hourlyWageCents: 1179, tipsReceivedCents: 0, hoursWorked: -1))
        XCTAssertFalse(neg.ok)
        let nan = TipPoolCompute.validateTipCreditPeriod(
            base(hourlyWageCents: 1179, tipsReceivedCents: 0, hoursWorked: .nan))
        XCTAssertFalse(nan.ok)
    }

    // ── summarizePool ──────────────────────────────────────────────────

    private var summaryRows: [TipDistributionRow] {
        [
            TipDistributionRow(id: 1, shiftDate: "2026-04-20", locationId: "default", poolRef: "P1", cookId: "alice", role: nil, kind: .tip_pool, amountCents: 5000, note: nil, createdAt: nil),
            TipDistributionRow(id: 2, shiftDate: "2026-04-20", locationId: "default", poolRef: "P1", cookId: "bob", role: nil, kind: .tip_pool, amountCents: 3000, note: nil, createdAt: nil),
            TipDistributionRow(id: 3, shiftDate: "2026-04-20", locationId: "default", poolRef: "P1", cookId: "alice", role: nil, kind: .service_charge, amountCents: 1500, note: nil, createdAt: nil),
            TipDistributionRow(id: 4, shiftDate: "2026-04-20", locationId: "default", poolRef: "P1", cookId: "carol", role: nil, kind: .direct_tip, amountCents: 800, note: nil, createdAt: nil),
        ]
    }

    func testSumsTotalInCents() {
        let s = TipPoolCompute.summarizePool(summaryRows)
        XCTAssertEqual(s.totalCents, 5000 + 3000 + 1500 + 800)
    }
    func testAggregatesByCook() {
        let s = TipPoolCompute.summarizePool(summaryRows)
        XCTAssertEqual(s.byCook["alice"], 6500)
        XCTAssertEqual(s.byCook["bob"], 3000)
        XCTAssertEqual(s.byCook["carol"], 800)
    }
    func testAggregatesByKind() {
        let s = TipPoolCompute.summarizePool(summaryRows)
        XCTAssertEqual(s.byKind[.tip_pool], 8000)
        XCTAssertEqual(s.byKind[.service_charge], 1500)
        XCTAssertEqual(s.byKind[.direct_tip], 800)
    }
    /// JS skips rows with non-integer `amount_cents` (defense in depth). In Swift
    /// `amountCents` is `Int` — a float is structurally unrepresentable — so a
    /// single integer row sums correctly and no phantom cook appears. The
    /// semantic guard/test is preserved per the plan.
    func testSkipsNonIntegerAmountsSemanticGuard() {
        let s = TipPoolCompute.summarizePool([
            TipDistributionRow(id: 1, shiftDate: "2026-04-20", locationId: "default", poolRef: "P1", cookId: "alice", role: nil, kind: .tip_pool, amountCents: 100, note: nil, createdAt: nil),
        ])
        XCTAssertEqual(s.totalCents, 100)
        XCTAssertNil(s.byCook["bob"])
    }
    func testEmptyInputZeros() {
        let s = TipPoolCompute.summarizePool([])
        XCTAssertEqual(s.totalCents, 0)
        XCTAssertEqual(s.byCook, [:])
        XCTAssertEqual(s.byKind, [.tip_pool: 0, .service_charge: 0, .direct_tip: 0])
    }

    // ── validateDistributionShape ──────────────────────────────────────

    private func shapeRow(
        shiftDate: String? = "2026-04-20",
        poolRef: String? = "POOL-1",
        cookId: String? = "alice",
        kind: String? = "tip_pool",
        amountCents: Int? = 1000
    ) -> DistributionShape {
        DistributionShape(shiftDate: shiftDate, poolRef: poolRef, cookId: cookId, kind: kind, amountCents: amountCents)
    }

    func testShapeHappyPathOk() {
        XCTAssertTrue(TipPoolCompute.validateDistributionShape(shapeRow()).ok)
    }
    func testShapeRejectsMalformedShiftDate() {
        let r = TipPoolCompute.validateDistributionShape(shapeRow(shiftDate: "4/20/2026"))
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.reason?.contains("YYYY-MM-DD") == true)
    }
    func testShapeRejectsMissingPoolRef() {
        XCTAssertFalse(TipPoolCompute.validateDistributionShape(shapeRow(poolRef: "")).ok)
    }
    func testShapeRejectsMissingCookId() {
        XCTAssertFalse(TipPoolCompute.validateDistributionShape(shapeRow(cookId: "")).ok)
    }
    func testShapeRejectsUnknownKind() {
        XCTAssertFalse(TipPoolCompute.validateDistributionShape(shapeRow(kind: "bonus")).ok)
    }
    /// JS passes `amount_cents: 12.5` (float) → rejected `/integer/`. In Swift the
    /// field is `Int`; the negative-integer and nil paths are the reachable
    /// rejections. We assert a nil amount is rejected as the structural analog.
    func testShapeRejectsNilAmount() {
        let r = TipPoolCompute.validateDistributionShape(shapeRow(amountCents: nil))
        XCTAssertFalse(r.ok)
    }
    func testShapeRejectsNegativeAmount() {
        XCTAssertFalse(TipPoolCompute.validateDistributionShape(shapeRow(amountCents: -100)).ok)
    }
    func testShapeZeroAmountAllowed() {
        XCTAssertTrue(TipPoolCompute.validateDistributionShape(shapeRow(amountCents: 0)).ok)
    }
}
