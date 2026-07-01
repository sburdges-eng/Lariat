import XCTest
@testable import LariatModel

/// Value-parity port of `tests/js/test-sick-leave-rules.mjs` — the pure HFWA
/// accrual/use/cap rules from `lib/sickLeave.ts`. Every JS case maps 1:1 to a
/// method here (constants, accrual ratio, cap enforcement incl. carryover
/// exclusion, useHours, hoursAvailable, summarizeBalance). Rounding is
/// away-from-zero (Math.round parity); hours are Double, never Decimal.
final class SickLeaveComputeTests: XCTestCase {

    /// Mirror of the JS `row(over)` helper — defaults + overrides.
    private func row(
        cookId: String = "alice",
        accrualYear: Int = 2026,
        hoursAccrued: Double = 0,
        hoursUsed: Double = 0,
        capHours: Double = SickLeaveCompute.hfwaAnnualCapHours,
        carryoverHours: Double = 0
    ) -> SickLeaveState {
        SickLeaveState(
            cookId: cookId, accrualYear: accrualYear, hoursAccrued: hoursAccrued,
            hoursUsed: hoursUsed, capHours: capHours, carryoverHours: carryoverHours
        )
    }

    // ── HFWA constants ─────────────────────────────────────────────────

    func testConstant30HoursWorkedPerHourEarned() {
        XCTAssertEqual(SickLeaveCompute.hfwaAccrualHoursWorkedPerHourEarned, 30)
    }

    func testConstant48HourAnnualCap() {
        XCTAssertEqual(SickLeaveCompute.hfwaAnnualCapHours, 48)
    }

    func testCitationReferencesStatute() {
        // JS: assert.match(HFWA_CITATION, /8-13\.3-401/)
        XCTAssertTrue(SickLeaveCompute.hfwaCitation.contains("8-13.3-401"))
        XCTAssertEqual(SickLeaveCompute.hfwaCitation, "C.R.S. §8-13.3-401 (HFWA)")
    }

    // ── accrueHours — accrual ratio ────────────────────────────────────

    func testAccrueZeroHoursWorkedNoAccrual() {
        let r = SickLeaveCompute.accrueHours(row(), hoursWorked: 0)
        XCTAssertEqual(r.hoursAdded, 0)
        XCTAssertFalse(r.capped)
    }

    func testAccrue30HoursWorkedEarnsOne() {
        let r = SickLeaveCompute.accrueHours(row(), hoursWorked: 30)
        XCTAssertEqual(r.hoursAdded, 1)
        XCTAssertFalse(r.capped)
    }

    func testAccrue15HoursWorkedEarnsHalfFractional() {
        let r = SickLeaveCompute.accrueHours(row(), hoursWorked: 15)
        XCTAssertEqual(r.hoursAdded, 0.5)
    }

    func testAccrue45HoursWorkedEarnsOnePointFive() {
        let r = SickLeaveCompute.accrueHours(row(), hoursWorked: 45)
        XCTAssertEqual(r.hoursAdded, 1.5)
    }

    func testAccrue1440FromZeroYieldsExactly48NotClipped() {
        let r = SickLeaveCompute.accrueHours(row(), hoursWorked: 1440)
        XCTAssertEqual(r.hoursAdded, 48)
        // 1440 / 30 = 48 exactly — not over the cap, not clipped.
        XCTAssertFalse(r.capped)
    }

    func testAccrue1500ClippedToRoomCappedTrue() {
        let r = SickLeaveCompute.accrueHours(row(), hoursWorked: 1500)
        XCTAssertEqual(r.hoursAdded, 48)
        XCTAssertTrue(r.capped)
        XCTAssertEqual(r.hoursUncapped, 50)
    }

    func testAccrueRoundingOneHourWorkedYields0_03() {
        let r = SickLeaveCompute.accrueHours(row(), hoursWorked: 1)
        // 1 / 30 = 0.0333... rounded to 0.03
        XCTAssertEqual(r.hoursAdded, 0.03)
    }

    func testAccrueNegativeHoursWorkedNoAccrualWithReason() {
        let r = SickLeaveCompute.accrueHours(row(), hoursWorked: -8)
        XCTAssertEqual(r.hoursAdded, 0)
        XCTAssertTrue(r.reason?.contains("non-negative") ?? false)
    }

    func testAccrueNaNHoursWorkedNoAccrual() {
        let r = SickLeaveCompute.accrueHours(row(), hoursWorked: .nan)
        XCTAssertEqual(r.hoursAdded, 0)
        XCTAssertTrue(r.reason?.contains("non-negative") ?? false)
    }

    func testAccrueInfinityHoursWorkedNoAccrual() {
        let r = SickLeaveCompute.accrueHours(row(), hoursWorked: .infinity)
        XCTAssertEqual(r.hoursAdded, 0)
    }

    // ── accrueHours — cap enforcement ──────────────────────────────────

    func testAccrueAlreadyAtCapIsNoOpWithReason() {
        let r = SickLeaveCompute.accrueHours(row(hoursAccrued: 48), hoursWorked: 30)
        XCTAssertEqual(r.hoursAdded, 0)
        XCTAssertTrue(r.capped)
        XCTAssertTrue(r.reason?.contains("cap") ?? false)
    }

    func testAccrueOneBelowCapYieldsOnlyOne() {
        let r = SickLeaveCompute.accrueHours(row(hoursAccrued: 47), hoursWorked: 30)
        XCTAssertEqual(r.hoursAdded, 1)
        XCTAssertFalse(r.capped)
    }

    func testAccrueHalfBelowCapYieldsOnlyHalf() {
        let r = SickLeaveCompute.accrueHours(row(hoursAccrued: 47.5), hoursWorked: 30)
        XCTAssertEqual(r.hoursAdded, 0.5)
        XCTAssertTrue(r.capped)
    }

    func testAccrueCustomCapClipsAtCustomCap() {
        let r = SickLeaveCompute.accrueHours(row(hoursAccrued: 23, capHours: 24), hoursWorked: 60)
        XCTAssertEqual(r.hoursAdded, 1)
        XCTAssertTrue(r.capped)
    }

    func testAccrueCapIsOnAccruedNotIncludingCarryover() {
        // 40 carryover + 47 accrued = 87 banked, but only 1h of accrual headroom
        // remains (48 - 47). Carryover does NOT count against further accrual.
        let r = SickLeaveCompute.accrueHours(row(hoursAccrued: 47, carryoverHours: 40), hoursWorked: 60)
        XCTAssertEqual(r.hoursAdded, 1)
        XCTAssertTrue(r.capped)
    }

    // ── useHours ───────────────────────────────────────────────────────

    func testUseWithinBalanceSucceeds() {
        let r = SickLeaveCompute.useHours(row(hoursAccrued: 8), hoursToUse: 4)
        XCTAssertTrue(r.ok)
        XCTAssertEqual(r.newBalance, 4)
    }

    func testUseExactlyBalanceSucceedsBoundary() {
        let r = SickLeaveCompute.useHours(row(hoursAccrued: 8), hoursToUse: 8)
        XCTAssertTrue(r.ok)
        XCTAssertEqual(r.newBalance, 0)
    }

    func testUseOverBalanceFailsWithReason() {
        let r = SickLeaveCompute.useHours(row(hoursAccrued: 4), hoursToUse: 8)
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.reason?.contains("not enough") ?? false)
        XCTAssertEqual(r.newBalance, 4)
    }

    func testUseZeroOrNegativeRejected() {
        XCTAssertFalse(SickLeaveCompute.useHours(row(hoursAccrued: 8), hoursToUse: 0).ok)
        XCTAssertFalse(SickLeaveCompute.useHours(row(hoursAccrued: 8), hoursToUse: -2).ok)
    }

    func testUseBalanceIncludesCarryover() {
        let r = SickLeaveCompute.useHours(row(hoursAccrued: 4, carryoverHours: 6), hoursToUse: 9)
        XCTAssertTrue(r.ok)
        XCTAssertEqual(r.newBalance, 1)
    }

    func testUseBalanceSubtractsHoursUsed() {
        let r = SickLeaveCompute.useHours(row(hoursAccrued: 8, hoursUsed: 5), hoursToUse: 4)
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.reason?.contains("not enough") ?? false)
    }

    // ── hoursAvailable + summarizeBalance ──────────────────────────────

    func testHoursAvailableAccruedPlusCarryMinusUsedFlooredAtZero() {
        XCTAssertEqual(
            SickLeaveCompute.hoursAvailable(row(hoursAccrued: 10, hoursUsed: 3, carryoverHours: 5)),
            12
        )
        XCTAssertEqual(
            SickLeaveCompute.hoursAvailable(row(hoursAccrued: 5, hoursUsed: 10)),
            0
        )
    }

    func testSummarizeReportsAtCapWhenAccruedGeCap() {
        let s = SickLeaveCompute.summarizeBalance(row(hoursAccrued: 48))
        XCTAssertTrue(s.atCap)
        XCTAssertEqual(s.capHours, 48)
        XCTAssertEqual(s.hoursAvailable, 48)
    }

    func testSummarizeNotAtCapBelowCap() {
        let s = SickLeaveCompute.summarizeBalance(row(hoursAccrued: 47.5))
        XCTAssertFalse(s.atCap)
    }

    func testSummarizeHandlesMissingFieldsGracefully() {
        // JS passes NaN for accrued/used/cap/carry — defaults kick in.
        let s = SickLeaveCompute.summarizeBalance(
            SickLeaveState(cookId: "bob", accrualYear: 2026, hoursAccrued: .nan, hoursUsed: .nan, capHours: .nan, carryoverHours: .nan)
        )
        XCTAssertEqual(s.hoursAccrued, 0)
        XCTAssertEqual(s.hoursUsed, 0)
        XCTAssertEqual(s.hoursAvailable, 0)
        XCTAssertEqual(s.capHours, SickLeaveCompute.hfwaAnnualCapHours)
    }

    func testSummarizePreservesCarryoverSeparately() {
        let s = SickLeaveCompute.summarizeBalance(row(hoursAccrued: 20, carryoverHours: 24))
        XCTAssertEqual(s.carryoverHours, 24)
        XCTAssertEqual(s.hoursAvailable, 44)
    }
}
