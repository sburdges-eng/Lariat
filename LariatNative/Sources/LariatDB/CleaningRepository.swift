import Foundation
import GRDB
import LariatModel

public struct CleaningRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    public func load(
        date: String = ShiftDate.todayISO(),
        locationId: String = LocationScope.resolve()
    ) async throws -> CleaningBoardSnapshot {
        try await readDB.pool.read { db in
            let rows = try CleaningLogRow.fetchAll(
                db,
                sql: """
                  SELECT * FROM cleaning_log
                   WHERE location_id = ? AND shift_date = ?
                   ORDER BY completed_at DESC
                  """,
                arguments: [locationId, date]
            )
            return CleaningBoardSnapshot(locationId: locationId, date: date, rows: rows)
        }
    }

    @discardableResult
    public func postTick(input: CleaningTickInput, context: RegulatedWriteContext) throws -> CleaningLogRow {
        switch CleaningCompute.validateCleaningLog(
            task: input.task,
            item: input.item,
            area: input.area,
            notes: input.notes,
            shiftDate: input.shiftDate,
            completedAt: input.completedAt,
            cookId: input.cookId,
            verifiedByCookId: input.verifiedByCookId,
            scheduleId: input.scheduleId
        ) {
        case .failure(let err): throw err
        case .success(let norm): return try insertTick(norm, context: context)
        }
    }

    private func insertTick(
        _ norm: CleaningCompute.NormalizedCleaningLog,
        context: RegulatedWriteContext
    ) throws -> CleaningLogRow {
        let shiftDate = norm.shiftDate ?? context.shiftDate
        let locationId = context.locationId
        let area = norm.area ?? "General"
        let completedAt = norm.completedAt ?? ISO8601DateFormatter().string(from: Date())
        let cookId = norm.cookId ?? context.actorCookId

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: """
                  INSERT INTO cleaning_log
                    (shift_date, location_id, schedule_id, area, task, completed_at, cook_id, verified_by_cook_id, notes)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                  """,
                arguments: [
                    shiftDate,
                    locationId,
                    norm.scheduleId,
                    area,
                    norm.task,
                    completedAt,
                    cookId,
                    norm.verifiedByCookId,
                    norm.notes,
                ]
            )
            let newId = db.lastInsertedRowID
            guard let row = try CleaningLogRow.fetchOne(
                db,
                sql: "SELECT * FROM cleaning_log WHERE id = ?",
                arguments: [newId]
            ) else {
                throw CleaningWriteError.notFound
            }
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "cleaning_log",
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
}
