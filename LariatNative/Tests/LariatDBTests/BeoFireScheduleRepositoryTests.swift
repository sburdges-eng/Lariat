import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Parity tests for `BeoFireScheduleRepository` — `GET /api/beo/fire-schedule`.
/// Oracle: tests/js/test-beo-fire-schedule-api.mjs (date path + event_id path).
/// The web endpoint is PUBLIC (wall-iPad rollup) — read-only natively too.
final class BeoFireScheduleRepositoryTests: XCTestCase {
    private var fixture: BeoFixture!
    private var repo: BeoFireScheduleRepository!

    override func setUpWithError() throws {
        fixture = try BeoFixture.make()
        repo = BeoFireScheduleRepository(database: fixture.readDB)
    }

    override func tearDown() {
        fixture.cleanup()
        fixture = nil
        repo = nil
    }

    // ── date path ────────────────────────────────────────────────────────

    func testEmptyStationsForADayWithNoEvents() async throws {
        let r = try await repo.schedule(date: "2026-05-04", locationId: "default")
        XCTAssertEqual(r.date, "2026-05-04")
        XCTAssertTrue(r.stations.isEmpty)
    }

    func testGroupsAcrossEventsByStationAndOrdersByFireAt() async throws {
        let ev1 = try fixture.seedEvent(title: "Hendricks Wedding", date: "2026-05-04")
        let ev2 = try fixture.seedEvent(title: "Smith Birthday", date: "2026-05-04")

        let c1 = try fixture.seedCourse(eventId: ev1, label: "Entree",
                                        fireAt: "2026-05-04T19:30:00.000Z", station: "grill")
        let c2 = try fixture.seedCourse(eventId: ev2, label: "App",
                                        fireAt: "2026-05-04T19:00:00.000Z", station: "grill")
        let c3 = try fixture.seedCourse(eventId: ev1, label: "Dessert",
                                        fireAt: "2026-05-04T20:30:00.000Z", station: "sides")

        try fixture.seedLineItem(eventId: ev1, item: "Smoked Brisket", qty: 80, courseId: c1)
        try fixture.seedLineItem(eventId: ev2, item: "Bruschetta", qty: 30, courseId: c2)
        try fixture.seedLineItem(eventId: ev1, item: "Cheesecake", qty: 80, courseId: c3)

        let r = try await repo.schedule(date: "2026-05-04", locationId: "default")
        XCTAssertEqual(r.stations.count, 2)
        let grill = try XCTUnwrap(r.stations.first { $0.stationId == "grill" })
        XCTAssertEqual(grill.courses.map(\.courseLabel), ["App", "Entree"])
        XCTAssertEqual(grill.courses[1].eventTitle, "Hendricks Wedding")
        XCTAssertEqual(grill.courses[1].lines.count, 1)
        XCTAssertEqual(grill.courses[1].lines[0].itemName, "Smoked Brisket")
    }

    func testIgnoresEventsOnOtherDates() async throws {
        let evToday = try fixture.seedEvent(title: "Today", date: "2026-05-04")
        let evTomorrow = try fixture.seedEvent(title: "Tomorrow", date: "2026-05-05")
        try fixture.seedCourse(eventId: evToday, label: "Entree",
                               fireAt: "2026-05-04T19:00:00.000Z", station: "grill")
        try fixture.seedCourse(eventId: evTomorrow, label: "Entree",
                               fireAt: "2026-05-05T19:00:00.000Z", station: "grill")

        let r = try await repo.schedule(date: "2026-05-04", locationId: "default")
        XCTAssertEqual(r.stations[0].courses.count, 1)
    }

    func testScopesByLocation() async throws {
        let evA = try fixture.seedEvent(title: "A", date: "2026-05-04", location: "austin")
        let evB = try fixture.seedEvent(title: "B", date: "2026-05-04", location: "denver")
        try fixture.seedCourse(eventId: evA, label: "X", fireAt: "2026-05-04T19:00:00.000Z",
                               station: "grill", location: "austin")
        try fixture.seedCourse(eventId: evB, label: "Y", fireAt: "2026-05-04T19:00:00.000Z",
                               station: "grill", location: "denver")

        let r = try await repo.schedule(date: "2026-05-04", locationId: "austin")
        XCTAssertEqual(r.locationId, "austin")
        XCTAssertEqual(r.stations[0].courses.count, 1)
        XCTAssertEqual(r.stations[0].courses[0].courseLabel, "X")
    }

    func testNullStationGoesToUnassignedBucket() async throws {
        let ev = try fixture.seedEvent(title: "Pop-up", date: "2026-05-04")
        try fixture.seedCourse(eventId: ev, label: "Tasting",
                               fireAt: "2026-05-04T19:00:00.000Z", station: nil)
        let r = try await repo.schedule(date: "2026-05-04", locationId: "default")
        let ua = try XCTUnwrap(r.stations.first { $0.stationId == "unassigned" },
                               "unassigned bucket should exist")
        XCTAssertEqual(ua.courses[0].courseLabel, "Tasting")
    }

    // ── event_id path ────────────────────────────────────────────────────

    func testEventScopeReturnsOnlyThatEventsCoursesInTheSameShape() async throws {
        let ev1 = try fixture.seedEvent(title: "Target Event", date: "2026-06-01")
        let ev2 = try fixture.seedEvent(title: "Other Event", date: "2026-06-01")

        let c1 = try fixture.seedCourse(eventId: ev1, label: "Entree",
                                        fireAt: "2026-06-01T19:00:00.000Z", station: "grill")
        let c2 = try fixture.seedCourse(eventId: ev1, label: "Dessert",
                                        fireAt: "2026-06-01T20:30:00.000Z", station: "sides")
        let c3 = try fixture.seedCourse(eventId: ev2, label: "App",
                                        fireAt: "2026-06-01T18:30:00.000Z", station: "grill")

        try fixture.seedLineItem(eventId: ev1, item: "Salmon", qty: 50, courseId: c1)
        try fixture.seedLineItem(eventId: ev1, item: "Tart", qty: 50, courseId: c2)
        try fixture.seedLineItem(eventId: ev2, item: "Should Not Appear", qty: 10, courseId: c3)

        let r = try await repo.schedule(eventId: ev1, locationId: "default")

        // Response shape matches the date path.
        XCTAssertEqual(r.locationId, "default")

        let labels = r.stations.flatMap { $0.courses.map(\.courseLabel) }
        XCTAssertTrue(labels.contains("Entree"))
        XCTAssertTrue(labels.contains("Dessert"))
        XCTAssertFalse(labels.contains("App"), "should NOT include the other event's courses")

        let grill = try XCTUnwrap(r.stations.first { $0.stationId == "grill" })
        XCTAssertEqual(grill.courses[0].lines[0].itemName, "Salmon")

        // event_date from the join is echoed back as the payload date.
        XCTAssertEqual(r.date, "2026-06-01")
    }

    func testEventScopeInDifferentLocationReturnsEmptyStationsNoLeak() async throws {
        let ev = try fixture.seedEvent(title: "Austin Event", date: "2026-06-02", location: "austin")
        try fixture.seedCourse(eventId: ev, label: "Entree", fireAt: "2026-06-02T19:00:00.000Z",
                               station: "grill", location: "austin")

        let r = try await repo.schedule(eventId: ev, locationId: "denver")
        XCTAssertEqual(r.locationId, "denver")
        XCTAssertTrue(r.stations.isEmpty)
    }

    func testEventScopeForNonExistentEventReturnsEmptyStations() async throws {
        let r = try await repo.schedule(eventId: 99999, locationId: "default")
        XCTAssertTrue(r.stations.isEmpty)
    }

    func testEventScopeFallsBackToQueryDateWhenNoCourses() async throws {
        // Web: date = firstCourse.event_date || url date || todayISO().
        let r = try await repo.schedule(eventId: 99999, date: "2026-06-03", locationId: "default")
        XCTAssertEqual(r.date, "2026-06-03")
        let r2 = try await repo.schedule(eventId: 99999, locationId: "default")
        XCTAssertEqual(r2.date, ShiftDate.todayISO())
    }
}
