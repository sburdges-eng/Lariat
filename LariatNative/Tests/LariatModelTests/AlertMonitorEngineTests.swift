import XCTest
@testable import LariatModel

final class AlertMonitorEngineTests: XCTestCase {

    private func alert(_ source: String, count: Int, severity: CommandAlert.Severity = .red) -> CommandAlert {
        CommandAlert(severity: severity, source: source, message: "\(count)", count: count)
    }

    func test_firstCandidate_requestsAuthorizationLazily() async {
        let poster = RecordingNotificationPoster(authorizedToReturn: true)
        let engine = AlertMonitorEngine(poster: poster)

        // No candidate alert yet — no permission check at all.
        await engine.tick(alerts: [])
        XCTAssertEqual(poster.ensureAuthorizedCallCount, 0)

        // First candidate tick — exactly one check.
        await engine.tick(alerts: [alert("x", count: 3)])
        XCTAssertEqual(poster.ensureAuthorizedCallCount, 1)

        // A second tick at a HIGHER count is still a fire candidate, but since
        // isAuthorized already latched true, no new check happens (sticky
        // only in the true direction).
        await engine.tick(alerts: [alert("x", count: 5)])
        XCTAssertEqual(poster.ensureAuthorizedCallCount, 1)
    }

    func test_authorized_posts() async {
        let poster = RecordingNotificationPoster(authorizedToReturn: true)
        let engine = AlertMonitorEngine(poster: poster)
        await engine.tick(alerts: [alert("cooling-overdue", count: 2)])
        XCTAssertEqual(poster.postedIdentifiers, ["cooling-overdue"])
        XCTAssertEqual(poster.postedMessages, ["2"])
    }

    func test_denied_neverPosts() async {
        let poster = RecordingNotificationPoster(authorizedToReturn: false)
        let engine = AlertMonitorEngine(poster: poster)
        await engine.tick(alerts: [alert("x", count: 1)])
        await engine.tick(alerts: [alert("x", count: 2)])
        await engine.tick(alerts: [alert("x", count: 3)])
        XCTAssertTrue(poster.postedIdentifiers.isEmpty)
        // Re-verified on every fire-triggering tick while still false.
        XCTAssertEqual(poster.ensureAuthorizedCallCount, 3)
    }

    func test_deniedThenGrantedLater_firesCatchUpExactlyOnce() async {
        let poster = RecordingNotificationPoster(authorizedToReturn: false)
        let engine = AlertMonitorEngine(poster: poster)

        // Tick 1: denied at count 3 — no post, peak stays frozen at 0.
        await engine.tick(alerts: [alert("x", count: 3)])
        XCTAssertTrue(poster.postedIdentifiers.isEmpty)
        XCTAssertEqual(poster.ensureAuthorizedCallCount, 1)

        // Tick 2: still count 3 (unchanged), but permission is now granted.
        // Fires exactly once — the frozen peak (0) was never ratcheted, so
        // 3 > 0 still holds.
        poster.authorizedToReturn = true
        await engine.tick(alerts: [alert("x", count: 3)])
        XCTAssertEqual(poster.postedIdentifiers, ["x"])
        XCTAssertEqual(poster.ensureAuthorizedCallCount, 2)

        // Tick 3: unchanged again, now authorized — no re-fire.
        await engine.tick(alerts: [alert("x", count: 3)])
        XCTAssertEqual(poster.postedIdentifiers, ["x"])
    }

    func test_amberNeverPosts() async {
        let poster = RecordingNotificationPoster(authorizedToReturn: true)
        let engine = AlertMonitorEngine(poster: poster)
        await engine.tick(alerts: [alert("y", count: 999, severity: .amber)])
        XCTAssertTrue(poster.postedIdentifiers.isEmpty)
        XCTAssertEqual(poster.ensureAuthorizedCallCount, 0)
    }

    func test_rearmClearsEvenWhileUnauthorized() async {
        let poster = RecordingNotificationPoster(authorizedToReturn: false)
        let engine = AlertMonitorEngine(poster: poster)

        // Tick 1: "x" fires (frozen at 0, no post).
        await engine.tick(alerts: [alert("x", count: 2)])
        // Tick 2: "x" is gone entirely — re-arm candidate.
        await engine.tick(alerts: [])
        // Tick 3: "x" reintroduced at count 1 — should fire again as a fresh
        // 0-to-nonzero transition (not suppressed as "already seen"), proving
        // the re-arm drop from tick 2 committed even while never authorized.
        poster.authorizedToReturn = true
        await engine.tick(alerts: [alert("x", count: 1)])
        XCTAssertEqual(poster.postedIdentifiers, ["x"])
        XCTAssertEqual(poster.postedMessages, ["1"])
    }

    func test_tickCompletesWithNoOpPoster() async {
        // NotificationPoster's methods aren't `throws`, so tick has nothing to
        // catch here — this just documents that tick completes normally,
        // regardless of authorization outcome. (Real I/O-failure coverage for
        // the repository-read path lives at T5/AlertMonitor, untested by
        // design — see the plan.)
        let poster = RecordingNotificationPoster(authorizedToReturn: false)
        let engine = AlertMonitorEngine(poster: poster)
        await engine.tick(alerts: [alert("x", count: 5)])
    }
}
