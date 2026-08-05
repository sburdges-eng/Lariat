import XCTest
@testable import LariatModel

/// Phase C1 verify-41 fix (T1): the read-side analog of `ManagementWrite`.
/// The web `requirePin` GET protects manager-tier reads (HR reviews, guest
/// waitlist, costing masters). The native port had no shared read-gate, so
/// several boards fetched regardless of PIN state. This pins the decision rule
/// the leaking ViewModels now call before they read.
///
/// 2026-08-05 — the unconfigured case was REVERSED, mirroring web. It used to
/// return `.open`: an install with nothing configured served every manager-tier
/// read with no credential. Web closed that in `pinRequiredForPic()`, which now
/// returns `true` unconditionally (`tests/js/test-unconfigured-install-fails-closed.mjs`),
/// on the reasoning that "LAN-trust single-site deployment" is a defensible
/// trade for one restaurant on a known network and the wrong one for software
/// that installs on a stranger's machine — and that it failed open in exactly
/// the state an operator is least protected: before setup is done. Native had
/// the same hole on the read side. It is closed here.
final class RegulatedReadGateTests: XCTestCase {
    // THE REVERSED CASE: nothing configured is NOT a reason to serve PHI, pay
    // data, or staff records. There is no PIN to type, so the board cannot
    // offer an unlock — it sends the operator to set one up instead.
    func testGateOffRefusesInsteadOfOpening() {
        XCTAssertEqual(
            RegulatedReadGate.evaluate(gateConfigured: false, hasActiveUser: false, canUnlock: true),
            .unavailable(RegulatedReadGate.noPinConfiguredReason)
        )
        XCTAssertFalse(
            RegulatedReadGate.mayFetch(gateConfigured: false, hasActiveUser: false),
            "an unconfigured install must not fetch manager-tier data"
        )
    }

    // Having a write DB to unlock through changes nothing when there is no PIN
    // to unlock with — both answer the same refusal.
    func testGateOffRefusesWhetherOrNotUnlockIsPossible() {
        XCTAssertEqual(
            RegulatedReadGate.evaluate(gateConfigured: false, hasActiveUser: false, canUnlock: false),
            .unavailable(RegulatedReadGate.noPinConfiguredReason)
        )
    }

    // The refusal has to tell the operator what to do about it — the board is
    // otherwise a dead end, and since #606 setting the first PIN is possible.
    func testUnconfiguredReasonPointsAtThePinsBoard() {
        let reason = RegulatedReadGate.noPinConfiguredReason
        XCTAssertTrue(reason.contains("PIN"), "reason should name the PIN: \(reason)")
        XCTAssertFalse(reason.isEmpty)
    }

    // An operator who unlocked before the last PIN was disabled keeps their
    // session — the credential was checked when it was issued.
    func testActiveSessionIsOpenEvenIfTheGateReadsUnconfigured() {
        XCTAssertEqual(RegulatedReadGate.evaluate(gateConfigured: false, hasActiveUser: true, canUnlock: true), .open)
        XCTAssertTrue(RegulatedReadGate.mayFetch(gateConfigured: false, hasActiveUser: true))
    }

    // Gate configured + an active manager session → open.
    func testGateOnWithActiveUserIsOpen() {
        XCTAssertEqual(RegulatedReadGate.evaluate(gateConfigured: true, hasActiveUser: true, canUnlock: true), .open)
        XCTAssertTrue(RegulatedReadGate.mayFetch(gateConfigured: true, hasActiveUser: true))
    }

    // THE SECURITY CASE: gate configured, no active session → locked, and the
    // board must NOT fetch. This is the exact hole the sweep found.
    func testGateOnWithoutUserIsLockedAndDoesNotFetch() {
        XCTAssertEqual(RegulatedReadGate.evaluate(gateConfigured: true, hasActiveUser: false, canUnlock: true), .locked)
        XCTAssertFalse(RegulatedReadGate.mayFetch(gateConfigured: true, hasActiveUser: false))
    }

    // Gate configured, no session, and no way to unlock (no write DB) →
    // unavailable, still no fetch. Mirrors MorningViewModel.evaluateGate.
    func testGateOnWithoutUserAndNoUnlockIsUnavailable() {
        XCTAssertEqual(
            RegulatedReadGate.evaluate(gateConfigured: true, hasActiveUser: false, canUnlock: false),
            .unavailable("Manager PIN required, but the write database is unavailable.")
        )
        XCTAssertFalse(RegulatedReadGate.mayFetch(gateConfigured: true, hasActiveUser: false))
    }

    // No combination of inputs serves data without a session. The rule is small
    // enough to assert exhaustively, so drift cannot reintroduce a fail-open.
    func testNothingFetchesWithoutAnActiveSession() {
        for gateConfigured in [true, false] {
            for canUnlock in [true, false] {
                let state = RegulatedReadGate.evaluate(
                    gateConfigured: gateConfigured, hasActiveUser: false, canUnlock: canUnlock
                )
                XCTAssertNotEqual(
                    state, .open,
                    "gateConfigured=\(gateConfigured) canUnlock=\(canUnlock) must not be open without a session"
                )
                XCTAssertFalse(RegulatedReadGate.mayFetch(gateConfigured: gateConfigured, hasActiveUser: false))
            }
        }
    }
}
