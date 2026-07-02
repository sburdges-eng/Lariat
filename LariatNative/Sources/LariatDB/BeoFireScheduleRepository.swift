import Foundation
import GRDB
import LariatModel

/// Fire-schedule rollup reads — parity with `GET /api/beo/fire-schedule`
/// (`app/api/beo/fire-schedule/route.js`). PUBLIC on web (wall-iPad rollup,
/// no PIN) — pure read natively too. The grouping/sorting lives in
/// `BeoFireScheduleCompute.resolveSchedule` (the ported lib module).
public struct BeoFireScheduleRepository: Sendable {
    private let database: LariatDatabase

    public init(database: LariatDatabase) {
        self.database = database
    }

    /// Date path: per-station rollup for every event whose event_date
    /// matches. `date` defaults to today (web `todayISO()`).
    public func schedule(
        date: String? = nil,
        locationId: String = LocationScope.resolve()
    ) async throws -> BeoFireScheduleCompute.FireSchedulePayload {
        let resolvedDate = date ?? ShiftDate.todayISO()
        return try await database.pool.read { db in
            let courseRows = try Row.fetchAll(
                db,
                sql: """
                  SELECT c.id, c.event_id, c.course_label, c.fire_at, c.station_id,
                         e.title AS event_title
                    FROM beo_courses c
                    JOIN beo_events e ON e.id = c.event_id
                   WHERE c.location_id = ?
                     AND e.event_date = ?
                   ORDER BY c.fire_at, c.id
                  """,
                arguments: [locationId, resolvedDate]
            )
            let courses = courseRows.map(Self.courseRow)
            let lines = try Self.linesForCourses(db, courseIds: courses.map(\.id))
            return BeoFireScheduleCompute.resolveSchedule(
                date: resolvedDate, locationId: locationId, courses: courses, lines: lines)
        }
    }

    /// Event path (`?event_id=N`): only that event's courses/lines, in the
    /// same payload shape. Echoes the event's own event_date as `date`,
    /// falling back to the `date` parameter, then today.
    public func schedule(
        eventId: Int64,
        date: String? = nil,
        locationId: String = LocationScope.resolve()
    ) async throws -> BeoFireScheduleCompute.FireSchedulePayload {
        try await database.pool.read { db in
            let courseRows = try Row.fetchAll(
                db,
                sql: """
                  SELECT c.id, c.event_id, c.course_label, c.fire_at, c.station_id,
                         e.title AS event_title, e.event_date AS event_date
                    FROM beo_courses c
                    JOIN beo_events e ON e.id = c.event_id
                   WHERE c.location_id = ?
                     AND c.event_id = ?
                   ORDER BY c.fire_at, c.id
                  """,
                arguments: [locationId, eventId]
            )
            let eventDate: String? = courseRows.first?["event_date"]
            let resolvedDate = eventDate ?? date ?? ShiftDate.todayISO()
            let courses = courseRows.map(Self.courseRow)
            let lines = try Self.linesForCourses(db, courseIds: courses.map(\.id))
            return BeoFireScheduleCompute.resolveSchedule(
                date: resolvedDate, locationId: locationId, courses: courses, lines: lines)
        }
    }

    // ── internals ────────────────────────────────────────────────────────

    private static func courseRow(_ row: Row) -> BeoFireScheduleCompute.CourseRow {
        BeoFireScheduleCompute.CourseRow(
            id: row["id"],
            eventId: row["event_id"],
            eventTitle: row["event_title"],
            courseLabel: row["course_label"],
            fireAt: row["fire_at"],
            stationId: row["station_id"]
        )
    }

    /// Every line bound to one of these courses, in a single query
    /// (web builds the same `IN (?, ...)` list).
    private static func linesForCourses(_ db: Database, courseIds: [Int64]) throws -> [BeoFireScheduleCompute.LineRow] {
        guard !courseIds.isEmpty else { return [] }
        let placeholders = databaseQuestionMarks(count: courseIds.count)
        let rows = try Row.fetchAll(
            db,
            sql: """
              SELECT id, event_id, course_id, item_name, quantity, prep_notes, order_items_notes
                FROM beo_line_items
               WHERE course_id IN (\(placeholders))
              """,
            arguments: StatementArguments(courseIds)
        )
        return rows.map { row in
            BeoFireScheduleCompute.LineRow(
                id: row["id"],
                eventId: row["event_id"],
                courseId: row["course_id"],
                itemName: row["item_name"],
                quantity: row["quantity"],
                prepNotes: row["prep_notes"]
            )
        }
    }
}
