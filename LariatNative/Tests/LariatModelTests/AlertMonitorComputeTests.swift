import XCTest
@testable import LariatModel

/// Pure diff/peak/re-arm state machine for H6a local notifications. No
/// UNUserNotificationCenter, no DB — see NotificationPoster (T3) /
/// AlertMonitorEngine (T4) for the layers that use this.
final class AlertMonitorComputeTests: XCTestCase {

    private func alert(_ source: String, count: Int, severity: CommandAlert.Severity = .red) -> CommandAlert {
        CommandAlert(severity: severity, source: source, message: "\(count)", count: count)
    }

    func test_zeroToNonzero_fires() {
        let (fire, nextPeaks) = AlertMonitorCompute.notificationsToFire(
            previousPeaks: [:],
            currentRedAlerts: [alert("x", count: 3)])
        XCTAssertEqual(fire.map(\.source), ["x"])
        XCTAssertEqual(nextPeaks, ["x": 3])
    }

    func test_unchangedNonzero_doesNotRefire() {
        let (fire, nextPeaks) = AlertMonitorCompute.notificationsToFire(
            previousPeaks: ["x": 3],
            currentRedAlerts: [alert("x", count: 3)])
        XCTAssertTrue(fire.isEmpty)
        XCTAssertEqual(nextPeaks, ["x": 3])
    }

    func test_increasePastPeak_firesAgain() {
        let (fire, nextPeaks) = AlertMonitorCompute.notificationsToFire(
            previousPeaks: ["x": 3],
            currentRedAlerts: [alert("x", count: 5)])
        XCTAssertEqual(fire.map(\.source), ["x"])
        XCTAssertEqual(nextPeaks, ["x": 5])
    }

    func test_dropToZeroThenRise_refires() {
        // Call 1: the source has dropped out of the current red-alert list entirely
        // (absence represents "count == 0" — CommandAlert.count is always > 0 by
        // construction, so a cleared alert simply isn't in the list).
        let (fire1, nextPeaks1) = AlertMonitorCompute.notificationsToFire(
            previousPeaks: ["x": 3],
            currentRedAlerts: [])
        XCTAssertTrue(fire1.isEmpty)
        XCTAssertEqual(nextPeaks1, [:])

        // Call 2: the source reappears at count 1 — re-armed, so it fires again
        // even though 1 < the old peak of 3.
        let (fire2, nextPeaks2) = AlertMonitorCompute.notificationsToFire(
            previousPeaks: nextPeaks1,
            currentRedAlerts: [alert("x", count: 1)])
        XCTAssertEqual(fire2.map(\.source), ["x"])
        XCTAssertEqual(nextPeaks2, ["x": 1])
    }

    func test_amberNeverFires() {
        let (fire, nextPeaks) = AlertMonitorCompute.notificationsToFire(
            previousPeaks: [:],
            currentRedAlerts: [alert("y", count: 999, severity: .amber)])
        XCTAssertTrue(fire.isEmpty)
        XCTAssertTrue(nextPeaks.isEmpty)
    }
}
