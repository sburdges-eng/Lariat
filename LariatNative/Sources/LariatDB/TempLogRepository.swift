import Foundation
import GRDB
import LariatModel

public struct TempLogRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    public func load(
        date: String = ShiftDate.todayISO(),
        locationId: String = LocationScope.resolve()
    ) async throws -> TempLogBoardSnapshot {
        try await readDB.pool.read { db in
            let entries = try TempLogRow.fetchAll(
                db,
                sql: """
                  SELECT * FROM temp_log
                  WHERE shift_date = ? AND location_id = ?
                  ORDER BY created_at DESC, id DESC
                  """,
                arguments: [date, locationId]
            )
            let readingRows = entries.compactMap { row -> TempLogReadingRow? in
                guard let pid = row.pointId, let reading = row.readingF else { return nil }
                return TempLogReadingRow(
                    pointId: pid,
                    readingF: reading,
                    correctiveAction: row.correctiveAction,
                    createdAt: row.createdAt
                )
            }
            let summary = TempLogCompute.classifyReadings(readingRows, expectAllPoints: true)
            return TempLogBoardSnapshot(date: date, locationId: locationId, entries: entries, summary: summary)
        }
    }

    public struct PostResult: Sendable {
        public let row: TempLogRow
        public let classification: TempReadingClass
        public let calibrationWarning: String?
    }

    @discardableResult
    public func postReading(
        input: TempLogPostInput,
        context: RegulatedWriteContext,
        pin: String? = nil,
        env: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> PostResult {
        let shiftDate = clip(input.shiftDate, max: 32)
        let pointId = clip(input.pointId, max: 64)
        guard let shiftDate, let pointId else { throw TempLogWriteError.missingFields }

        let pinVerifier = TempPinVerifier()
        if pinVerifier.pinRequiredForBackDate(shiftDate: shiftDate, env: env) {
            guard let pin, !pin.isEmpty else { throw TempLogWriteError.pinRequiredForPastDate }
            let allowed = try writeDB.pool.read { db in
                try pinVerifier.hasPinOrScope(
                    pin: pin,
                    scope: TempPinVerifier.backDateScope,
                    db: db,
                    locationId: context.locationId,
                    env: env
                )
            }
            if !allowed { throw PinGateError.invalidPin }
        }

        guard let point = TempLogCompute.getTempPoint(pointId) else {
            throw TempLogWriteError.unknownPoint(pointId)
        }

        try TempLogCompute.enforceTempReading(
            point: point,
            readingF: input.readingF,
            correctiveAction: input.correctiveAction
        )

        let classification = TempLogCompute.classifyReading(point, input.readingF)
        let draft = TempLogCompute.entryFromReading(
            point: point,
            readingF: input.readingF,
            correctiveAction: input.correctiveAction,
            shiftDate: shiftDate,
            cookId: clip(input.cookId, max: 64),
            locationId: context.locationId,
            probeId: clip(input.probeId, max: 64)
        )

        let calibrationWarning: String? = nil

        let row = try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: """
                  INSERT INTO temp_log (
                    shift_date, location_id, point_id, reading_f,
                    required_min_f, required_max_f, corrective_action, cook_id, probe_id
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                  """,
                arguments: [
                    draft.shiftDate,
                    draft.locationId,
                    draft.pointId,
                    draft.readingF,
                    draft.requiredMinF,
                    draft.requiredMaxF,
                    draft.correctiveAction,
                    draft.cookId,
                    draft.probeId,
                ]
            )
            let newId = db.lastInsertedRowID
            guard let inserted = try TempLogRow.fetchOne(
                db,
                sql: "SELECT * FROM temp_log WHERE id = ?",
                arguments: [newId]
            ) else {
                throw TempLogWriteError.missingFields
            }

            var noteParts: [String] = []
            if classification == .outOfRange {
                noteParts.append("out_of_range:\(point.id)")
            }
            if let calibrationWarning {
                noteParts.append("calibration_warning:\(draft.probeId ?? "")")
            }

            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "temp_log",
                    entityId: newId,
                    action: .insert,
                    actorCookId: context.actorCookId ?? draft.cookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(inserted),
                    note: noteParts.isEmpty ? nil : noteParts.joined(separator: "|"),
                    shiftDate: draft.shiftDate,
                    locationId: draft.locationId
                )
            )
            return inserted
        }

        return PostResult(row: row, classification: classification, calibrationWarning: calibrationWarning)
    }

    private func clip(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }
}
