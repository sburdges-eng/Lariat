import Foundation
import GRDB
import LariatModel

/// BEO course CRUD — parity with `app/api/beo/courses/route.js` (GET/POST)
/// and `app/api/beo/courses/[id]/route.js` (PATCH/DELETE). Validation rules
/// live in `BeoCourseRules` (the ported `lib/beoCourses.ts`); this layer owns
/// location verification, sort-order resolution, and the transactional
/// `beo_course` audit rows (web audit entity is the SINGULAR `beo_course`).
///
/// Web gate: master PIN OR temp PIN scoped `beo.fire_at_edit`. Natively the
/// view model gates writes via the manager-PIN session (documented
/// divergence — strictly tighter; there is no native temp-PIN session).
public struct BeoCoursesRepository {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    static let maxLabel = 80
    static let maxNotes = 2000

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    // ── GET /api/beo/courses?event_id=&location= ─────────────────────────

    /// Courses for one event, `ORDER BY sort_order, fire_at, id`. The web
    /// SELECT list omits station_id (the CoursePanel doesn't render it);
    /// included here because the native board shows the station chip inline.
    public func list(eventId: Int64, locationId: String = LocationScope.resolve()) throws -> [BeoCourseRow] {
        guard eventId > 0 else {
            throw BeoWriteError.unprocessable("event_id required")
        }
        return try readDB.pool.read { db in
            try BeoCourseRow.fetchAll(
                db,
                sql: """
                  SELECT id, event_id, location_id, course_label, fire_at, notes,
                         sort_order, station_id, created_at, updated_at
                    FROM beo_courses
                   WHERE event_id = ? AND location_id = ?
                   ORDER BY sort_order, fire_at, id
                  """,
                arguments: [eventId, locationId]
            )
        }
    }

    // ── POST /api/beo/courses ────────────────────────────────────────────

    @discardableResult
    public func create(
        eventId: Int64,
        draft: BeoCourseRules.CourseDraft,
        locationId: String = LocationScope.resolve(),
        context: RegulatedWriteContext
    ) throws -> BeoCourseRow {
        guard eventId > 0 else {
            throw BeoWriteError.unprocessable("event_id required (positive integer)")
        }
        let payload: BeoCourseRules.CoursePayload
        switch BeoCourseRules.validateCoursePayload(draft) {
        case .error(let message):
            throw BeoWriteError.unprocessable(message)
        case .ok(let p):
            payload = p
        }

        let newId: Int64 = try AuditedWriteRunner.perform(db: writeDB) { db in
            // Confirm the event exists and belongs to this location — prevents
            // location A creating a course on an event in location B.
            guard try Row.fetchOne(
                db,
                sql: "SELECT id FROM beo_events WHERE id = ? AND location_id = ?",
                arguments: [eventId, locationId]
            ) != nil else {
                throw BeoWriteError.notFound("event not found at this location")
            }

            var resolvedSortOrder = payload.sortOrder
            if resolvedSortOrder == nil {
                let existingMax = try Int.fetchOne(
                    db,
                    sql: "SELECT MAX(sort_order) FROM beo_courses WHERE event_id = ?",
                    arguments: [eventId]
                )
                resolvedSortOrder = BeoCourseRules.nextSortOrder(existingMax)
            }

            try db.execute(
                sql: """
                  INSERT INTO beo_courses
                    (event_id, location_id, course_label, fire_at, notes, sort_order, station_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?)
                  """,
                arguments: [eventId, locationId, payload.courseLabel, payload.fireAt,
                            payload.notes, resolvedSortOrder, payload.stationId]
            )
            let id = db.lastInsertedRowID
            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "beo_course", entityId: id, action: .insert,
                actorCookId: context.actorCookId, actorSource: context.actorSource,
                payloadJSON: BeoBoardRepository.payloadJSON([
                    "event_id": eventId,
                    "course_label": payload.courseLabel,
                    "fire_at": payload.fireAt,
                    "sort_order": resolvedSortOrder,
                    "station_id": payload.stationId,
                ]),
                shiftDate: context.shiftDate, locationId: locationId
            ))
            return id
        }
        return try fetchCourse(id: newId)
    }

    // ── PATCH /api/beo/courses/:id ───────────────────────────────────────

    /// Each field is optional; absence = "don't touch". Empty course_label is
    /// rejected (would make the row unreadable to cooks). Returns the fresh
    /// row (web returns the re-SELECTed row).
    @discardableResult
    public func patch(
        id: Int64,
        patch: BeoCoursePatch,
        locationId: String = LocationScope.resolve(),
        context: RegulatedWriteContext
    ) throws -> BeoCourseRow {
        guard id > 0 else { throw BeoWriteError.badRequest("bad id") }

        var labelToSet: String? = nil
        if let rawLabel = patch.courseLabel {
            guard let v = BeoBoardRepository.clip(rawLabel, max: Self.maxLabel) else {
                throw BeoWriteError.unprocessable("course_label cannot be empty")
            }
            labelToSet = v
        }

        var fireAtToSet: String? = nil
        if let rawFireAt = patch.fireAt {
            guard BeoCourseRules.isIso8601Utc(rawFireAt) else {
                throw BeoWriteError.unprocessable("fire_at must be canonical ISO-8601 UTC")
            }
            fireAtToSet = rawFireAt
        }

        // notes: absent = no change; nil/empty = clear; non-empty = set.
        var notesTouch = 0
        var notesValue: String? = nil
        if case .set(let raw) = patch.notes {
            notesTouch = 1
            notesValue = BeoBoardRepository.clip(raw, max: Self.maxNotes)
        }

        var sortToSet: Int? = nil
        if let n = patch.sortOrder {
            guard n >= 0 else {
                throw BeoWriteError.unprocessable("sort_order must be a non-negative integer")
            }
            sortToSet = n
        }

        // station_id: absent = no change; nil/empty = clear; slug = set.
        var stationTouch = 0
        var stationValue: String? = nil
        if case .set(let raw) = patch.stationId {
            stationTouch = 1
            if let raw, !raw.isEmpty {
                guard BeoCourseRules.isStationSlug(raw) else {
                    throw BeoWriteError.unprocessable("station_id must be a non-empty lowercased slug")
                }
                stationValue = raw
            }
        }

        try AuditedWriteRunner.perform(db: writeDB) { db in
            guard try Row.fetchOne(
                db,
                sql: "SELECT id, event_id FROM beo_courses WHERE id = ? AND location_id = ?",
                arguments: [id, locationId]
            ) != nil else {
                throw BeoWriteError.notFound("course not found")
            }

            try db.execute(
                sql: """
                  UPDATE beo_courses SET
                    course_label = COALESCE(?, course_label),
                    fire_at      = COALESCE(?, fire_at),
                    notes        = CASE WHEN ? THEN ? ELSE notes END,
                    sort_order   = COALESCE(?, sort_order),
                    station_id   = CASE WHEN ? THEN ? ELSE station_id END,
                    updated_at   = datetime('now')
                  WHERE id = ?
                  """,
                arguments: [
                    labelToSet,
                    fireAtToSet,
                    notesTouch, notesValue,
                    sortToSet,
                    stationTouch, stationValue,
                    id,
                ]
            )
            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "beo_course", entityId: id, action: .update,
                actorCookId: context.actorCookId, actorSource: context.actorSource,
                payloadJSON: BeoBoardRepository.payloadJSON([
                    "course_label": labelToSet,
                    "fire_at": fireAtToSet,
                    "notes_set": notesTouch == 1,
                    "sort_order": sortToSet,
                ]),
                shiftDate: context.shiftDate, locationId: locationId
            ))
        }
        return try fetchCourse(id: id)
    }

    // ── DELETE /api/beo/courses/:id ──────────────────────────────────────

    /// Drops the course; child line_items.course_id → NULL via the FK
    /// (ON DELETE SET NULL).
    public func delete(
        id: Int64,
        locationId: String = LocationScope.resolve(),
        context: RegulatedWriteContext
    ) throws {
        guard id > 0 else { throw BeoWriteError.badRequest("bad id") }
        try AuditedWriteRunner.perform(db: writeDB) { db in
            guard try Row.fetchOne(
                db,
                sql: "SELECT id FROM beo_courses WHERE id = ? AND location_id = ?",
                arguments: [id, locationId]
            ) != nil else {
                throw BeoWriteError.notFound("course not found")
            }
            try db.execute(sql: "DELETE FROM beo_courses WHERE id = ?", arguments: [id])
            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "beo_course", entityId: id, action: .delete,
                actorCookId: context.actorCookId, actorSource: context.actorSource,
                payloadJSON: BeoBoardRepository.payloadJSON(["id": id]),
                shiftDate: context.shiftDate, locationId: locationId
            ))
        }
    }

    // ── internals ────────────────────────────────────────────────────────

    private func fetchCourse(id: Int64) throws -> BeoCourseRow {
        guard let row = try writeDB.pool.read({ db in
            try BeoCourseRow.fetchOne(
                db,
                sql: "SELECT * FROM beo_courses WHERE id = ?",
                arguments: [id]
            )
        }) else {
            throw BeoWriteError.notFound("course not found")
        }
        return row
    }
}
