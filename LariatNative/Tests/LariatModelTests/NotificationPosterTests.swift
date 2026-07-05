import XCTest
@testable import LariatModel

final class NotificationPosterTests: XCTestCase {

    func testCommandFeatureId() {
        XCTAssertEqual(AlertNotificationRouting.commandFeatureId, "manager.command")
    }

    func testRecordingPosterRecordsCalls() async {
        let poster = RecordingNotificationPoster(authorizedToReturn: true)
        await poster.post(identifier: "x", message: "hi")
        await poster.post(identifier: "x", message: "hi")
        XCTAssertEqual(poster.postedIdentifiers, ["x", "x"])
        XCTAssertEqual(poster.postedMessages, ["hi", "hi"])
    }

    func testRecordingPosterEnsureAuthorizedReturnsConfiguredValue() async {
        let poster = RecordingNotificationPoster(authorizedToReturn: false)
        let first = await poster.ensureAuthorized()
        XCTAssertFalse(first)
        XCTAssertEqual(poster.ensureAuthorizedCallCount, 1)

        // Reconfigurable mid-sequence — AlertMonitorEngineTests (T4) relies on this
        // to simulate permission being granted after an earlier denial.
        poster.authorizedToReturn = true
        let second = await poster.ensureAuthorized()
        XCTAssertTrue(second)
        XCTAssertEqual(poster.ensureAuthorizedCallCount, 2)
    }

    // MARK: - NotificationEnvironment (bundle-identity guard)

    // UNUserNotificationCenter.current() throws an uncatchable
    // NSInternalInconsistencyException when the running process has no real
    // bundle identity (an unbundled `swift run` executable, e.g.) —
    // discovered live via a manual launch smoke test after H6a merged.
    // Bundle.main.bundleIdentifier is nil in exactly that case.

    func testCanUseNotifications_withBundleIdentifier() {
        XCTAssertTrue(NotificationEnvironment.canUseNotifications(bundleIdentifier: "com.lariat.native"))
    }

    func testCanUseNotifications_withoutBundleIdentifier() {
        XCTAssertFalse(NotificationEnvironment.canUseNotifications(bundleIdentifier: nil))
    }
}
