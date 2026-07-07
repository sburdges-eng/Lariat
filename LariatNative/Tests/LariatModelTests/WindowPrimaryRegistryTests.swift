import XCTest
@testable import LariatModel

/// H6d — pure ordered-registry behind `WindowRouter`. Decides which window is
/// "primary" (the app-level navigation target for the H6a notification tap and
/// the H6c menu-bar) as windows open and close: the earliest-registered window
/// still open. No AppKit/scene types — the App-layer `WindowRouter` maps real
/// windows to Int tokens and delegates the ordering decision here.
final class WindowPrimaryRegistryTests: XCTestCase {

    func test_empty_hasNoPrimary() {
        let r = WindowPrimaryRegistry()
        XCTAssertNil(r.primary)
        XCTAssertTrue(r.isEmpty)
    }

    func test_firstRegistered_isPrimary() {
        var r = WindowPrimaryRegistry()
        r.register(1); r.register(2); r.register(3)
        XCTAssertEqual(r.primary, 1)
        XCTAssertFalse(r.isEmpty)
    }

    func test_deregisteringPrimary_promotesNextEarliest() {
        var r = WindowPrimaryRegistry()
        r.register(1); r.register(2); r.register(3)
        r.deregister(1)
        XCTAssertEqual(r.primary, 2)   // next-earliest still-open window
        r.deregister(2)
        XCTAssertEqual(r.primary, 3)
    }

    func test_deregisteringNonPrimary_leavesPrimaryUnchanged() {
        var r = WindowPrimaryRegistry()
        r.register(1); r.register(2); r.register(3)
        r.deregister(2)
        XCTAssertEqual(r.primary, 1)
    }

    func test_deregisteringAll_isEmptyAgain() {
        var r = WindowPrimaryRegistry()
        r.register(7); r.register(9)
        r.deregister(7); r.deregister(9)
        XCTAssertNil(r.primary)
        XCTAssertTrue(r.isEmpty)
    }

    func test_reregisteringSameToken_isIdempotent_noDuplicateOrDisorder() {
        var r = WindowPrimaryRegistry()
        r.register(1); r.register(2)
        r.register(1)                  // e.g. a window re-appears / re-runs .onAppear
        XCTAssertEqual(r.primary, 1)   // order preserved, no duplicate slot
        r.deregister(1)
        XCTAssertEqual(r.primary, 2)   // and it fully leaves on a single deregister
    }
}
