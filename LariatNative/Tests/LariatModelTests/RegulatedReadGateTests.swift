import XCTest
@testable import LariatModel

/// Phase C1 verify-41 fix (T1): the read-side analog of `ManagementWrite`.
/// The web `requirePin` GET protects manager-tier reads (HR reviews, guest
/// waitlist, costing masters). The native port had no shared read-gate, so
/// several boards fetched regardless of PIN state. This pins the decision rule
/// the leaking ViewModels now call before they read.
final class RegulatedReadGateTests: XCTestCase {
    // Gate not configured (no PIN on the deployment) → read is open, exactly as
    // the web GET is when no PIN exists.
    func testGateOffIsAlwaysOpen() {
        XCTAssertEqual(RegulatedReadGate.evaluate(gateConfigured: false, hasActiveUser: false, canUnlock: true), .open)
        XCTAssertTrue(RegulatedReadGate.mayFetch(gateConfigured: false, hasActiveUser: false))
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
}
