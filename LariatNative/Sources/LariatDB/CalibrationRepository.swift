import Foundation
import GRDB
import LariatModel

public struct CalibrationRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    public func load(locationId: String = LocationScope.resolve(), limit: Int = 50) async throws -> CalibrationBoardSnapshot {
        try await readDB.pool.read { db in
            let rows = try CalibrationRow.fetchAll(
                db,
                sql: """
                  SELECT * FROM thermometer_calibrations
                  WHERE location_id = ?
                  ORDER BY calibrated_at DESC, id DESC
                  LIMIT ?
                  """,
                arguments: [locationId, limit]
            )
            return CalibrationBoardSnapshot(rows: rows)
        }
    }

    public struct PostResult: Sendable {
        public let row: CalibrationRow
        public let decision: CalibrationDecision
    }

    @discardableResult
    public func post(input: CalibrationPostInput, context: RegulatedWriteContext) throws -> PostResult {
        let thermometerId = clip(input.thermometerId, max: 64)
        guard let thermometerId else { throw CalibrationWriteError.thermometerRequired }

        if let note = input.note, note.count > CalibrationCompute.noteMaxLength {
            throw CalibrationWriteError.validationFailed("note too long (max 500 chars)")
        }

        let elevation = input.elevationFt ?? CalibrationCompute.lariatElevationFt
        let decision = try CalibrationCompute.validateReading(
            method: input.method,
            readingF: input.readingF,
            elevationFt: elevation
        )

        if let fd = input.frequencyDays, fd <= 0 {
            throw CalibrationWriteError.validationFailed("frequency_days must be a positive integer")
        }

        let shiftDate = clip(input.shiftDate, max: 32) ?? context.shiftDate
        let cookId = clip(input.cookId, max: 64) ?? context.actorCookId
        let note = clip(input.note, max: 500)
        let calibratedAt = ISO8601DateFormatter().string(from: Date())
            .replacingOccurrences(of: "T", with: " ")
            .prefix(19)
        let locationId = context.locationId

        let row = try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: """
                  INSERT INTO thermometer_calibrations
                    (location_id, thermometer_id, method, before_reading_f, after_reading_f,
                     passed, action_taken, cook_id, calibrated_at, frequency_days)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  """,
                arguments: [
                    locationId,
                    thermometerId,
                    input.method.rawValue,
                    input.readingF,
                    nil,
                    decision.passed ? 1 : 0,
                    note,
                    cookId,
                    String(calibratedAt),
                    input.frequencyDays,
                ]
            )
            let newId = db.lastInsertedRowID
            guard let inserted = try CalibrationRow.fetchOne(
                db,
                sql: "SELECT * FROM thermometer_calibrations WHERE id = ?",
                arguments: [newId]
            ) else {
                throw CalibrationWriteError.validationFailed("Insert failed")
            }

            let auditNote = decision.passed
                ? nil
                : "fail:\(thermometerId):\(input.method.rawValue)"

            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "thermometer_calibrations",
                    entityId: newId,
                    action: .insert,
                    actorCookId: context.actorCookId ?? cookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(inserted),
                    note: auditNote,
                    shiftDate: shiftDate,
                    locationId: locationId
                )
            )
            return inserted
        }

        return PostResult(row: row, decision: decision)
    }

    private func clip(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }
}
