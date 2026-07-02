import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Parity tests for `BeoCoursesRepository` — `/api/beo/courses` (GET/POST) +
/// `/api/beo/courses/[id]` (PATCH/DELETE). Oracle:
/// tests/js/test-beo-courses-api.mjs. Web gate (master PIN OR temp PIN with
/// 'beo.fire_at_edit') is a route concern; natively the view model gates via
/// the manager-PIN session (documented divergence — strictly tighter).
final class BeoCoursesRepositoryTests: XCTestCase {
    private var fixture: BeoFixture!
    private var repo: BeoCoursesRepository!
    private let ctx = RegulatedWriteContext.nativeMac(pinUser: nil)

    override func setUpWithError() throws {
        fixture = try BeoFixture.make()
        repo = BeoCoursesRepository(readDB: fixture.readDB, writeDB: fixture.writeDB)
    }

    override func tearDown() {
        fixture.cleanup()
        fixture = nil
        repo = nil
    }

    private func futureIso(_ minutes: Double = 60) -> String {
        BeoCourseRules.fractionalIso.string(from: Date().addingTimeInterval(minutes * 60))
    }

    // ── POST /api/beo/courses ────────────────────────────────────────────

    func testCreateCoursePersistsAndWritesAuditRow() throws {
        let eventId = try fixture.seedEvent()
        let fireAt = futureIso()
        let created = try repo.create(
            eventId: eventId,
            draft: BeoCourseRules.CourseDraft(courseLabel: "Entree", fireAt: fireAt, notes: "no sauce on side"),
            locationId: "default", context: ctx)

        XCTAssertGreaterThan(created.id, 0)
        XCTAssertEqual(created.eventId, eventId)
        XCTAssertEqual(created.courseLabel, "Entree")
        XCTAssertEqual(created.fireAt, fireAt)
        XCTAssertEqual(created.sortOrder, 0)

        let row = try XCTUnwrap(fixture.row("SELECT * FROM beo_courses WHERE id = ?", [created.id]))
        XCTAssertEqual(row["course_label"], "Entree")
        XCTAssertEqual(row["fire_at"], fireAt)
        XCTAssertEqual(row["notes"], "no sauce on side")

        let audit = try XCTUnwrap(fixture.row(
            "SELECT entity, action, actor_source FROM audit_events WHERE entity='beo_course' AND entity_id=?",
            [created.id]))
        XCTAssertEqual(audit["entity"], "beo_course")
        XCTAssertEqual(audit["action"], "insert")
        XCTAssertEqual(audit["actor_source"], "native_mac")   // web: manager_ui (documented divergence)
    }

    func testCreateAppendsSortOrderOnSecondCourse() throws {
        let eventId = try fixture.seedEvent()
        _ = try repo.create(
            eventId: eventId,
            draft: BeoCourseRules.CourseDraft(courseLabel: "Amuse", fireAt: futureIso()),
            locationId: "default", context: ctx)
        let second = try repo.create(
            eventId: eventId,
            draft: BeoCourseRules.CourseDraft(courseLabel: "Entree", fireAt: futureIso(120)),
            locationId: "default", context: ctx)
        XCTAssertEqual(second.sortOrder, 10, "second course should sort 10 above first")
    }

    func testCreateThrowsNotFoundForUnknownEvent() {
        XCTAssertThrowsError(try repo.create(
            eventId: 99999,
            draft: BeoCourseRules.CourseDraft(courseLabel: "Entree", fireAt: futureIso()),
            locationId: "default", context: ctx)
        ) { error in
            guard case BeoWriteError.notFound = error else {
                return XCTFail("expected notFound (web 404), got \(error)")
            }
        }
    }

    func testCreateThrowsNotFoundForEventInAnotherLocation() throws {
        let eventId = try fixture.seedEvent(location: "austin")
        XCTAssertThrowsError(try repo.create(
            eventId: eventId,
            draft: BeoCourseRules.CourseDraft(courseLabel: "Entree", fireAt: futureIso()),
            locationId: "default", context: ctx)
        ) { error in
            guard case BeoWriteError.notFound = error else {
                return XCTFail("expected notFound, got \(error)")
            }
        }
        XCTAssertEqual(try fixture.count("SELECT COUNT(*) FROM beo_courses"), 0)
    }

    func testCreateRejectsNonCanonicalFireAtBeforeAnyWrite() throws {
        let eventId = try fixture.seedEvent()
        XCTAssertThrowsError(try repo.create(
            eventId: eventId,
            draft: BeoCourseRules.CourseDraft(courseLabel: "Entree", fireAt: "2026-05-04 19:30"),
            locationId: "default", context: ctx)
        ) { error in
            guard case BeoWriteError.unprocessable = error else {
                return XCTFail("expected unprocessable (web 422), got \(error)")
            }
        }
        XCTAssertEqual(try fixture.count("SELECT COUNT(*) FROM beo_courses"), 0)
        XCTAssertEqual(try fixture.count("SELECT COUNT(*) FROM audit_events"), 0)
    }

    // ── GET /api/beo/courses ─────────────────────────────────────────────

    func testListReturnsCoursesForOneEventInSortOrder() throws {
        let eventId = try fixture.seedEvent()
        let other = try fixture.seedEvent(title: "Other")
        try fixture.seedCourse(eventId: eventId, label: "Dessert", fireAt: futureIso(180))
        try fixture.seedCourse(eventId: eventId, label: "Amuse", fireAt: futureIso(30))
        try fixture.seedCourse(eventId: other, label: "Not mine", fireAt: futureIso(60))
        // seedCourse leaves sort_order at the column default 0 → ordering
        // falls through to fire_at (web ORDER BY sort_order, fire_at, id).
        let courses = try repo.list(eventId: eventId, locationId: "default")
        XCTAssertEqual(courses.map(\.courseLabel), ["Amuse", "Dessert"])
    }

    func testListThrowsUnprocessableForBadEventId() {
        XCTAssertThrowsError(try repo.list(eventId: 0, locationId: "default")) { error in
            guard case BeoWriteError.unprocessable = error else {
                return XCTFail("expected unprocessable (web 422), got \(error)")
            }
        }
    }

    // ── PATCH /api/beo/courses/:id ───────────────────────────────────────

    private func seedCourseViaRepo(_ eventId: Int64) throws -> BeoCourseRow {
        try repo.create(
            eventId: eventId,
            draft: BeoCourseRules.CourseDraft(courseLabel: "Entree", fireAt: futureIso()),
            locationId: "default", context: ctx)
    }

    func testPatchUpdatesFireAtAndWritesAuditRow() throws {
        let eventId = try fixture.seedEvent()
        let course = try seedCourseViaRepo(eventId)
        let newFire = futureIso(120)

        let updated = try repo.patch(id: course.id, patch: BeoCoursePatch(fireAt: newFire),
                                     locationId: "default", context: ctx)
        XCTAssertEqual(updated.fireAt, newFire)

        let row = try XCTUnwrap(fixture.row("SELECT fire_at FROM beo_courses WHERE id = ?", [course.id]))
        XCTAssertEqual(row["fire_at"], newFire)
        XCTAssertNotNil(try fixture.row(
            "SELECT id FROM audit_events WHERE entity='beo_course' AND entity_id=? AND action='update'",
            [course.id]))
    }

    func testPatchRejectsEmptyCourseLabel() throws {
        let eventId = try fixture.seedEvent()
        let course = try seedCourseViaRepo(eventId)
        XCTAssertThrowsError(try repo.patch(
            id: course.id, patch: BeoCoursePatch(courseLabel: "   "),
            locationId: "default", context: ctx)
        ) { error in
            guard case BeoWriteError.unprocessable = error else {
                return XCTFail("expected unprocessable (web 422), got \(error)")
            }
        }
    }

    func testPatchThrowsNotFoundForUnknownId() {
        XCTAssertThrowsError(try repo.patch(
            id: 99999, patch: BeoCoursePatch(fireAt: futureIso()),
            locationId: "default", context: ctx)
        ) { error in
            guard case BeoWriteError.notFound = error else {
                return XCTFail("expected notFound, got \(error)")
            }
        }
    }

    func testPatchClearsAndSetsStation() throws {
        let eventId = try fixture.seedEvent()
        let course = try seedCourseViaRepo(eventId)

        var updated = try repo.patch(id: course.id, patch: BeoCoursePatch(stationId: .set("grill")),
                                     locationId: "default", context: ctx)
        XCTAssertEqual(updated.stationId, "grill")

        updated = try repo.patch(id: course.id, patch: BeoCoursePatch(stationId: .set(nil)),
                                 locationId: "default", context: ctx)
        XCTAssertNil(updated.stationId)
    }

    func testPatchRejectsUppercaseStation() throws {
        let eventId = try fixture.seedEvent()
        let course = try seedCourseViaRepo(eventId)
        XCTAssertThrowsError(try repo.patch(
            id: course.id, patch: BeoCoursePatch(stationId: .set("GRILL")),
            locationId: "default", context: ctx)
        ) { error in
            guard case BeoWriteError.unprocessable = error else {
                return XCTFail("expected unprocessable, got \(error)")
            }
        }
    }

    func testPatchPreservesUntouchedFields() throws {
        let eventId = try fixture.seedEvent()
        let course = try repo.create(
            eventId: eventId,
            draft: BeoCourseRules.CourseDraft(courseLabel: "Entree", fireAt: futureIso(), notes: "keep me"),
            locationId: "default", context: ctx)
        let updated = try repo.patch(id: course.id, patch: BeoCoursePatch(sortOrder: 40),
                                     locationId: "default", context: ctx)
        XCTAssertEqual(updated.sortOrder, 40)
        XCTAssertEqual(updated.courseLabel, "Entree")
        XCTAssertEqual(updated.notes, "keep me")
    }

    // ── DELETE /api/beo/courses/:id ──────────────────────────────────────

    func testDeleteRemovesCourseAndSetsLineCourseIdNullViaFk() throws {
        let eventId = try fixture.seedEvent()
        let course = try seedCourseViaRepo(eventId)
        let lineId = try fixture.seedLineItem(eventId: eventId, courseId: course.id)

        try repo.delete(id: course.id, locationId: "default", context: ctx)

        XCTAssertNil(try fixture.row("SELECT id FROM beo_courses WHERE id = ?", [course.id]))
        // Line survives with course_id NULLed by ON DELETE SET NULL.
        let line = try XCTUnwrap(fixture.row("SELECT course_id FROM beo_line_items WHERE id = ?", [lineId]))
        XCTAssertTrue(line["course_id"] == nil)
        XCTAssertNotNil(try fixture.row(
            "SELECT id FROM audit_events WHERE entity='beo_course' AND entity_id=? AND action='delete'",
            [course.id]))
    }

    func testDeleteThrowsNotFoundForUnknownId() {
        XCTAssertThrowsError(try repo.delete(id: 99999, locationId: "default", context: ctx)) { error in
            guard case BeoWriteError.notFound = error else {
                return XCTFail("expected notFound, got \(error)")
            }
        }
    }
}
