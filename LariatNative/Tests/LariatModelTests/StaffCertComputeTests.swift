import XCTest
@testable import LariatModel

// Code-parity tests for the staff-certifications board (A3 / L1). There is NO
// dedicated web parity oracle for this board, so these assert against the
// route/board CODE: `app/api/certifications/route.js` (clip / cert_type allow-set
// / YYYY-MM-DD guard) and `CertBoard.jsx` `withStatus` (tone thresholds). The
// tone boundaries are additionally cross-checked against the −3d/+15d/+60d
// classification fixture in tests/js/test-command-summary-api.mjs so the board
// and the Command cert-expiry alert never disagree.

final class StaffCertComputeTests: XCTestCase {

    // ── cert_type allow-set (rejected BEFORE insert) ───────────────────

    func testParseCertTypeAcceptsAllowSet() {
        XCTAssertEqual(StaffCertCompute.parseCertType("cfpm"), .cfpm)
        XCTAssertEqual(StaffCertCompute.parseCertType("food_handler"), .foodHandler)
        XCTAssertEqual(StaffCertCompute.parseCertType("tips"), .tips)
        XCTAssertEqual(StaffCertCompute.parseCertType("allergen"), .allergen)
        XCTAssertEqual(StaffCertCompute.parseCertType("other"), .other)
    }

    func testParseCertTypeTrimsBeforeMatching() {
        XCTAssertEqual(StaffCertCompute.parseCertType("  cfpm  "), .cfpm)
    }

    func testParseCertTypeRejectsOutOfSet() {
        XCTAssertNil(StaffCertCompute.parseCertType("servsafe"))
        XCTAssertNil(StaffCertCompute.parseCertType("CFPM"))   // case-sensitive, like the DB CHECK
        XCTAssertNil(StaffCertCompute.parseCertType(""))
        XCTAssertNil(StaffCertCompute.parseCertType("   "))
        XCTAssertNil(StaffCertCompute.parseCertType(nil))
    }

    func testCertTypeAllowSetIsExactlyFive() {
        XCTAssertEqual(
            Set(StaffCertType.allCases.map(\.rawValue)),
            ["cfpm", "food_handler", "tips", "allergen", "other"]
        )
    }

    // ── clip (trim → null-if-empty → prefix) ───────────────────────────

    func testClipTrimsAndNullsEmpty() {
        XCTAssertNil(StaffCertCompute.clip(nil, max: 120))
        XCTAssertNil(StaffCertCompute.clip("", max: 120))
        XCTAssertNil(StaffCertCompute.clip("   ", max: 120))
        XCTAssertEqual(StaffCertCompute.clip("  ServSafe Manager  ", max: 120), "ServSafe Manager")
    }

    func testClipEnforcesMaxLength() {
        let long = String(repeating: "x", count: 200)
        XCTAssertEqual(StaffCertCompute.clip(long, max: 120)?.count, 120)
        XCTAssertEqual(StaffCertCompute.clip(long, max: 300)?.count, 200)
        // document_path uses 300, label/issuer/number 120 — verified via max arg.
        XCTAssertEqual(StaffCertCompute.clip(long, max: 10), String(repeating: "x", count: 10))
    }

    // ── YYYY-MM-DD date guard ──────────────────────────────────────────

    func testDateGuardAcceptsValidIsoDates() {
        XCTAssertTrue(StaffCertCompute.isValidDate("2026-07-01"))
        XCTAssertTrue(StaffCertCompute.isValidDate(nil))   // optional field
    }

    func testDateGuardRejectsMalformedDates() {
        XCTAssertFalse(StaffCertCompute.isValidDate("2026-7-1"))
        XCTAssertFalse(StaffCertCompute.isValidDate("07/01/2026"))
        XCTAssertFalse(StaffCertCompute.isValidDate("2026-07-01T00:00:00"))
        XCTAssertFalse(StaffCertCompute.isValidDate("not-a-date"))
    }

    // ── tone thresholds (parity with CertBoard.jsx withStatus) ─────────

    func testToneMutedWhenInactive() {
        // active==0 → muted even if the cert is otherwise fresh.
        XCTAssertEqual(StaffCertCompute.tone(active: 0, expiresOn: "2999-01-01", today: "2026-07-01"), .muted)
    }

    func testToneMutedWhenNoExpiry() {
        XCTAssertEqual(StaffCertCompute.tone(active: 1, expiresOn: nil, today: "2026-07-01"), .muted)
    }

    func testToneMutedWhenExpiryUnparseable() {
        XCTAssertEqual(StaffCertCompute.tone(active: 1, expiresOn: "garbage", today: "2026-07-01"), .muted)
    }

    func testToneRedWhenExpired() {
        // −3d from today → days == -3 < 0 → red (matches classifyCerts cert_expired).
        XCTAssertEqual(StaffCertCompute.tone(active: 1, expiresOn: "2026-06-28", today: "2026-07-01"), .red)
    }

    func testToneAmberWithin30Days() {
        // +15d → amber (matches classifyCerts cert_expiring_30d).
        XCTAssertEqual(StaffCertCompute.tone(active: 1, expiresOn: "2026-07-16", today: "2026-07-01"), .amber)
    }

    func testToneGreenBeyond30Days() {
        // +60d → green (neither expired nor expiring-30d in classifyCerts).
        XCTAssertEqual(StaffCertCompute.tone(active: 1, expiresOn: "2026-08-30", today: "2026-07-01"), .green)
    }

    // ── exact boundary parity (whole-day floor; 0 and 30 are inclusive) ─

    func testToneBoundaryZeroDaysIsAmberNotRed() {
        // expires today → days == 0 → NOT <0, IS <=30 → amber.
        XCTAssertEqual(StaffCertCompute.tone(active: 1, expiresOn: "2026-07-01", today: "2026-07-01"), .amber)
    }

    func testToneBoundaryThirtyDaysIsAmber() {
        XCTAssertEqual(StaffCertCompute.tone(active: 1, expiresOn: "2026-07-31", today: "2026-07-01"), .amber)
    }

    func testToneBoundaryThirtyOneDaysIsGreen() {
        XCTAssertEqual(StaffCertCompute.tone(active: 1, expiresOn: "2026-08-01", today: "2026-07-01"), .green)
    }

    func testToneBoundaryMinusOneDayIsRed() {
        XCTAssertEqual(StaffCertCompute.tone(active: 1, expiresOn: "2026-06-30", today: "2026-07-01"), .red)
    }

    // ── day-delta parity with the Command −3d/+15d/+60d fixture ────────

    func testDaysUntilExpiryWholeDayFloorMatchesFixture() {
        XCTAssertEqual(StaffCertCompute.daysUntilExpiry(today: "2026-07-01", expires: "2026-06-28"), -3)
        XCTAssertEqual(StaffCertCompute.daysUntilExpiry(today: "2026-07-01", expires: "2026-07-16"), 15)
        XCTAssertEqual(StaffCertCompute.daysUntilExpiry(today: "2026-07-01", expires: "2026-08-30"), 60)
        XCTAssertEqual(StaffCertCompute.daysUntilExpiry(today: "2026-07-01", expires: "2026-07-01"), 0)
        XCTAssertNil(StaffCertCompute.daysUntilExpiry(today: "2026-07-01", expires: nil))
    }
}
