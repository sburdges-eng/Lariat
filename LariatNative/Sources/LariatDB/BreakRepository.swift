import Foundation
import GRDB
import LariatModel

public struct BreakRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    public func load(
        date: String = ShiftDate.todayISO(),
        cookId: String? = nil,
        locationId: String = LocationScope.resolve(),
        shiftStartedAt: String? = nil,
        shiftEndedAt: String? = nil
    ) async throws -> BreakBoardSnapshot {
        try await readDB.pool.read { db in
            var sql = """
              SELECT * FROM shift_breaks
               WHERE location_id = ? AND shift_date = ?
              """
            var args: [DatabaseValueConvertible] = [locationId, date]
            if let cookId {
                sql += " AND cook_id = ?"
                args.append(cookId)
            }
            sql += " ORDER BY started_at ASC"
            let rows = try ShiftBreakRow.fetchAll(db, sql: sql, arguments: StatementArguments(args))

            let evaluation: BreakCompute.ShiftEvaluation?
            if let cookId, let start = shiftStartedAt, let end = shiftEndedAt {
                let inputs = rows.map { row in
                    BreakCompute.ShiftBreakInput(
                        kind: row.breakKind ?? .rest,
                        startedAt: row.startedAt,
                        endedAt: row.endedAt,
                        durationMin: row.durationMin,
                        waived: row.waived != 0
                    )
                }
                evaluation = BreakCompute.evaluateShift(
                    shiftStartedAt: start,
                    shiftEndedAt: end,
                    breaks: inputs
                )
            } else {
                evaluation = nil
            }

            return BreakBoardSnapshot(
                locationId: locationId,
                date: date,
                cookId: cookId,
                breaks: rows,
                evaluation: evaluation
            )
        }
    }

    @discardableResult
    public func start(input: BreakStartInput, context: RegulatedWriteContext) throws -> ShiftBreakRow {
        let cookId = clip(input.cookId, max: 64)
        guard let cookId else { throw BreakWriteError.cookIdRequired }

        if input.waived && input.kind != .meal {
            throw BreakWriteError.validationFailed("only meal breaks can be waived under COMPS #39")
        }
        if input.waived && clip(input.waiverRef, max: 300) == nil {
            throw BreakWriteError.validationFailed("meal-break waivers must reference a signed document (waiver_ref)")
        }

        let startedAt: String
        if let raw = clip(input.startedAt, max: 40) {
            guard parseIso(raw) != nil else { throw BreakWriteError.startedAtInvalid }
            startedAt = raw
        } else {
            startedAt = ISO8601DateFormatter().string(from: Date())
        }

        let shiftDate = clip(input.shiftDate, max: 32) ?? context.shiftDate
        let locationId = context.locationId
        let waived = input.waived ? 1 : 0
        let waiverRef = clip(input.waiverRef, max: 300)
        let note = clip(input.note, max: 300)
        let endedAt: String? = input.waived ? startedAt : nil
        let durationMin: Double? = input.waived ? 0 : nil

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            if waived == 0 {
                if let open = try Int64.fetchOne(
                    db,
                    sql: """
                      SELECT id FROM shift_breaks
                       WHERE location_id = ? AND cook_id = ? AND ended_at IS NULL AND waived = 0
                       ORDER BY started_at DESC LIMIT 1
                      """,
                    arguments: [locationId, cookId]
                ) {
                    throw BreakWriteError.openBreakExists(open)
                }
            }

            try db.execute(
                sql: """
                  INSERT INTO shift_breaks
                    (shift_date, location_id, cook_id, kind, started_at, ended_at, duration_min, waived, waiver_ref, note)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  """,
                arguments: [
                    shiftDate, locationId, cookId, input.kind.rawValue,
                    startedAt, endedAt, durationMin, waived, waiverRef, note,
                ]
            )
            let newId = db.lastInsertedRowID
            guard let row = try ShiftBreakRow.fetchOne(
                db,
                sql: "SELECT * FROM shift_breaks WHERE id = ?",
                arguments: [newId]
            ) else {
                throw BreakWriteError.notFound
            }
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "shift_breaks",
                    entityId: newId,
                    action: .insert,
                    actorCookId: context.actorCookId ?? cookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(row),
                    shiftDate: shiftDate,
                    locationId: locationId
                )
            )
            return row
        }
    }

    @discardableResult
    public func end(id: Int64, endedAt: String? = nil, context: RegulatedWriteContext) throws -> ShiftBreakRow {
        let endTs: String
        if let raw = clip(endedAt, max: 40) {
            guard parseIso(raw) != nil else {
                throw BreakWriteError.validationFailed("ended_at must be an ISO timestamp")
            }
            endTs = raw
        } else {
            endTs = ISO8601DateFormatter().string(from: Date())
        }

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            guard let existing = try ShiftBreakRow.fetchOne(
                db,
                sql: "SELECT * FROM shift_breaks WHERE id = ?",
                arguments: [id]
            ) else {
                throw BreakWriteError.notFound
            }
            if existing.locationId != context.locationId {
                throw BreakWriteError.notFound
            }
            if existing.endedAt != nil {
                throw BreakWriteError.alreadyEnded
            }
            guard let startMs = parseIso(existing.startedAt),
                  let endMs = parseIso(endTs),
                  endMs > startMs else {
                throw BreakWriteError.endedAtInvalid
            }
            let duration = (endMs - startMs) / 60_000.0

            try db.execute(
                sql: "UPDATE shift_breaks SET ended_at = ?, duration_min = ? WHERE id = ?",
                arguments: [endTs, duration, id]
            )
            guard let updated = try ShiftBreakRow.fetchOne(
                db,
                sql: "SELECT * FROM shift_breaks WHERE id = ?",
                arguments: [id]
            ) else {
                throw BreakWriteError.notFound
            }
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "shift_breaks",
                    entityId: id,
                    action: .update,
                    actorCookId: context.actorCookId ?? existing.cookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(updated),
                    shiftDate: existing.shiftDate,
                    locationId: existing.locationId
                )
            )
            return updated
        }
    }

    private func clip(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }

    private func parseIso(_ s: String) -> Double? {
        if let d = ISO8601DateFormatter().date(from: s) { return d.timeIntervalSince1970 * 1000 }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
        f.timeZone = TimeZone(secondsFromGMT: 0)
        if let d = f.date(from: s) { return d.timeIntervalSince1970 * 1000 }
        return nil
    }
}
