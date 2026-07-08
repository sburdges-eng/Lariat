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

        // Bundle G (web route.js): evaluate the probe's calibration state
        // outside the transaction and, if it warrants an advisory, stamp it into
        // the audit note + return it to the cook. Non-blocking either way.
        let calibrationWarning = computeCalibrationWarning(
            probeId: draft.probeId,
            locationId: draft.locationId
        )

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

    /// Web Bundle G port: classify the cited probe's calibration state and map
    /// it to the per-write advisory. Tolerates lookup failure (missing table on
    /// a fresh DB, etc.) by returning nil — matching the web try/catch that logs
    /// and continues.
    private func computeCalibrationWarning(probeId: String?, locationId: String) -> String? {
        guard let probeId, !probeId.isEmpty else { return nil }
        let calRows: [HaccpProbeCalibrationRow]? = try? writeDB.pool.read { db in
            try HaccpProbeCalibrationRow.fetchAll(
                db,
                sql: """
                  SELECT thermometer_id, method, before_reading_f, passed, calibrated_at, frequency_days
                  FROM thermometer_calibrations
                  WHERE location_id = ? AND thermometer_id = ?
                  """,
                arguments: [locationId, probeId]
            )
        }
        guard let calRows else { return nil }
        let summaries = HaccpPlanCompute.classifyProbes(calRows, nowISO: Self.currentInstantISO())
        // Web passes `known_probe_ids:[probe_id]`, so a probe with no rows still
        // yields an 'unknown' summary. Native classifyProbes omits empty probes,
        // so synthesize the unknown case.
        let summary = summaries.first(where: { $0.thermometerId == probeId })
            ?? HaccpProbeSummary(
                thermometerId: probeId, status: .unknown, lastCalibratedAt: nil,
                lastMethod: nil, lastReadingF: nil, lastPassed: nil,
                nextDueAt: nil, frequencyDays: 30, total: 0
            )
        return HaccpPlanCompute.calibrationWarningFor(summary)
    }

    private static func currentInstantISO() -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.string(from: Date())
    }

    private func clip(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }
}
