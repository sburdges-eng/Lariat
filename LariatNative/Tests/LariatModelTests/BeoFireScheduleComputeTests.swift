import XCTest
@testable import LariatModel

/// Value-parity tests for `BeoFireScheduleCompute` — ported case-for-case from
/// `tests/js/test-beo-fire-schedule-rules.mjs` (oracle for `lib/beoFireSchedule.ts`).
final class BeoFireScheduleComputeTests: XCTestCase {

    private func baseCourses(_ over: [BeoFireScheduleCompute.CourseRow] = []) -> [BeoFireScheduleCompute.CourseRow] {
        [
            .init(id: 1, eventId: 42, eventTitle: "Hendricks Wedding", courseLabel: "Entree",
                  fireAt: "2026-05-04T19:30:00.000Z", stationId: "grill"),
            .init(id: 2, eventId: 42, eventTitle: "Hendricks Wedding", courseLabel: "Dessert",
                  fireAt: "2026-05-04T20:30:00.000Z", stationId: "sides"),
            .init(id: 3, eventId: 43, eventTitle: "Smith Birthday", courseLabel: "App",
                  fireAt: "2026-05-04T19:00:00.000Z", stationId: "grill"),
        ] + over
    }

    private func baseLines(_ over: [BeoFireScheduleCompute.LineRow] = []) -> [BeoFireScheduleCompute.LineRow] {
        [
            .init(id: 901, eventId: 42, courseId: 1, itemName: "Smoked Brisket", quantity: 80, prepNotes: nil),
            .init(id: 902, eventId: 42, courseId: 1, itemName: "Half Chicken", quantity: 40, prepNotes: nil),
            .init(id: 903, eventId: 42, courseId: 2, itemName: "Cheesecake", quantity: 80, prepNotes: nil),
            .init(id: 904, eventId: 43, courseId: 3, itemName: "Bruschetta", quantity: 30, prepNotes: nil),
            .init(id: 905, eventId: 42, courseId: nil, itemName: "Bread service", quantity: 80, prepNotes: nil), // unbound, dropped
        ] + over
    }

    // ── resolveSchedule ──────────────────────────────────────────────────

    func testReturnsDateAndLocationPassedIn() {
        let r = BeoFireScheduleCompute.resolveSchedule(
            date: "2026-05-04", locationId: "default", courses: baseCourses(), lines: baseLines())
        XCTAssertEqual(r.date, "2026-05-04")
        XCTAssertEqual(r.locationId, "default")
    }

    func testGroupsByStationAndSortsWithinStationByFireAt() {
        let r = BeoFireScheduleCompute.resolveSchedule(
            date: "2026-05-04", locationId: "default", courses: baseCourses(), lines: baseLines())
        XCTAssertEqual(r.stations.map(\.stationId), ["grill", "sides"])
        let grill = r.stations.first { $0.stationId == "grill" }!
        // App (19:00) comes before Entree (19:30)
        XCTAssertEqual(grill.courses.map(\.courseLabel), ["App", "Entree"])
    }

    func testAttachesLinesToTheirCourseAndDropsUnboundLines() {
        let r = BeoFireScheduleCompute.resolveSchedule(
            date: "2026-05-04", locationId: "default", courses: baseCourses(), lines: baseLines())
        let entree = r.stations.first { $0.stationId == "grill" }!
            .courses.first { $0.courseLabel == "Entree" }!
        XCTAssertEqual(entree.lines.count, 2)
        XCTAssertEqual(entree.lines.map(\.itemName).sorted(), ["Half Chicken", "Smoked Brisket"])

        let allItems = r.stations.flatMap(\.courses).flatMap(\.lines).map(\.itemName)
        XCTAssertFalse(allItems.contains("Bread service"))
    }

    func testNullStationGoesToUnassignedBucketSortedLast() {
        let r = BeoFireScheduleCompute.resolveSchedule(
            date: "2026-05-04",
            locationId: "default",
            courses: baseCourses([
                .init(id: 4, eventId: 44, eventTitle: "Pop-up", courseLabel: "Tasting",
                      fireAt: "2026-05-04T21:00:00.000Z", stationId: nil),
            ]),
            lines: baseLines()
        )
        XCTAssertEqual(r.stations.map(\.stationId), ["grill", "sides", "unassigned"])
    }

    func testEmptyStationsWhenNoCourses() {
        let r = BeoFireScheduleCompute.resolveSchedule(
            date: "2026-05-04", locationId: "default", courses: [], lines: [])
        XCTAssertTrue(r.stations.isEmpty)
    }

    func testBreaksFireAtTiesByEventIdThenCourseId() {
        let r = BeoFireScheduleCompute.resolveSchedule(
            date: "2026-05-04",
            locationId: "default",
            courses: [
                .init(id: 10, eventId: 50, eventTitle: "A", courseLabel: "X",
                      fireAt: "2026-05-04T19:00:00.000Z", stationId: "grill"),
                .init(id: 11, eventId: 49, eventTitle: "B", courseLabel: "Y",
                      fireAt: "2026-05-04T19:00:00.000Z", stationId: "grill"),
            ],
            lines: []
        )
        // event_id 49 < 50, so Y comes first
        XCTAssertEqual(r.stations[0].courses.map(\.courseLabel), ["Y", "X"])
    }

    // ── ageBucketFor ─────────────────────────────────────────────────────

    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private func iso(minutesFromNow: Double) -> String {
        Self.isoFormatter.string(from: Date().addingTimeInterval(minutesFromNow * 60))
    }

    func testGreenForMoreThan30MinutesAway() {
        XCTAssertEqual(BeoFireScheduleCompute.ageBucketFor(iso(minutesFromNow: 60)), .green)
    }

    func testYellowForAtMost30MinutesAway() {
        XCTAssertEqual(BeoFireScheduleCompute.ageBucketFor(iso(minutesFromNow: 10)), .yellow)
    }

    func testYellowAtExactlyThe30MinuteThreshold() {
        let now = Date()
        let fire = Self.isoFormatter.string(
            from: now.addingTimeInterval(BeoFireScheduleCompute.yellowThresholdSeconds))
        XCTAssertEqual(BeoFireScheduleCompute.ageBucketFor(fire, now: now), .yellow)
    }

    func testRedOnOrPastFireAt() {
        XCTAssertEqual(BeoFireScheduleCompute.ageBucketFor(iso(minutesFromNow: -1)), .red)
    }

    func testRedOnGarbageInputFailClosed() {
        XCTAssertEqual(BeoFireScheduleCompute.ageBucketFor("not a date"), .red)
        XCTAssertEqual(BeoFireScheduleCompute.ageBucketFor(""), .red)
    }

    func testUsesExplicitNowForDeterministicTesting() {
        let fire = "2026-05-04T19:30:00.000Z"
        func at(_ s: String) -> Date { Self.isoFormatter.date(from: s)! }
        XCTAssertEqual(BeoFireScheduleCompute.ageBucketFor(fire, now: at("2026-05-04T18:00:00.000Z")), .green)
        XCTAssertEqual(BeoFireScheduleCompute.ageBucketFor(fire, now: at("2026-05-04T19:15:00.000Z")), .yellow)
        XCTAssertEqual(BeoFireScheduleCompute.ageBucketFor(fire, now: at("2026-05-04T19:30:00.000Z")), .red)
    }
}
