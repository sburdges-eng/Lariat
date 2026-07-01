import Foundation
import GRDB
import LariatModel

/// Repository for the sanitizer concentration log — behavior parity with
/// `app/api/sanitizer/route.ts`. Reads via the read-only pool; the regulated
/// write (record a ppm reading) goes through `AuditedWriteRunner` so the
/// `sanitizer_checks` INSERT and its `audit_events` row commit (or roll back)
/// in ONE transaction. Sanitizer checks are point-in-time — every row is a
/// completed observation, there is no PATCH. Status semantics mirror the web
/// route:
///   - unknown chemistry / bad concentration / missing label → validationFailed (web 400)
///   - low/high reading with no corrective note → needsCorrectiveAction (web 422)
public struct SanitizerRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    // ── GET — board snapshot ───────────────────────────────────────────

    public func load(
        date: String = ShiftDate.todayISO(),
        locationId: String = LocationScope.resolve()
    ) async throws -> SanitizerBoardSnapshot {
        try await readDB.pool.read { db in
            let rows = try SanitizerRow.fetchAll(
                db,
                sql: """
                  SELECT * FROM sanitizer_checks
                  WHERE location_id = ? AND shift_date = ?
                  ORDER BY created_at ASC
                  """,
                arguments: [locationId, date]
            )
            let latest = Self.latestByPoint(rows)
            return SanitizerBoardSnapshot(
                date: date,
                locationId: locationId,
                rows: rows,
                latest: latest,
                knownPoints: SanitizerCompute.defaultPoints
            )
        }
    }

    /// Latest reading per point_label, sorted by point_label ascending. Mirrors
    /// the web `latestByPoint` Map roll-up: rows arrive in created_at ASC order so
    /// the LAST row per label wins, then the map values are sorted by label.
    static func latestByPoint(_ rows: [SanitizerRow]) -> [SanitizerRow] {
        var latestByPoint: [String: SanitizerRow] = [:]
        for r in rows {
            latestByPoint[r.pointLabel] = r
        }
        return latestByPoint.values.sorted { $0.pointLabel < $1.pointLabel }
    }

    // ── POST — record a reading ────────────────────────────────────────

    public struct RecordResult: Sendable {
        public let row: SanitizerRow
        public let classification: SanitizerClassification
    }

    @discardableResult
    public func record(input: SanitizerCheckInput, context: RegulatedWriteContext) throws -> RecordResult {
        // Validate against the raw input (parity with web `validateSanitizerCheck`).
        // An unknown chemistry, non-finite/off-the-charts ppm, missing point_label,
        // or implausible water temp all fail here → web 400.
        let v = SanitizerCompute.validateSanitizerCheck(
            chemistryRaw: input.chemistry,
            concentrationPpm: input.concentrationPpm,
            waterTempF: input.waterTempF,
            pointLabel: input.pointLabel
        )
        guard v.ok else {
            throw SanitizerWriteError.validationFailed(v.reason ?? "Invalid sanitizer check")
        }

        // Safe after validation: chemistry is one of the four, concentration finite.
        guard let chemistry = SanitizerChemistry(rawValue: input.chemistry),
              let concentrationPpm = input.concentrationPpm else {
            throw SanitizerWriteError.validationFailed("Invalid sanitizer check")
        }
        let waterTempF = input.waterTempF

        let correctiveAction = SanitizerCompute.normalizeCorrectiveAction(input.correctiveAction)
        if let note = correctiveAction, note.count > SanitizerCompute.correctiveNoteMaxLength {
            throw SanitizerWriteError.correctiveNoteTooLong(length: note.count)
        }
        // Web clips corrective_action to 500 (slice) rather than rejecting; mirror
        // the clip so an over-long note is truncated the same way the web does.
        let clippedNote = correctiveAction.map { String($0.prefix(SanitizerCompute.correctiveNoteMaxLength)) }

        let pointLabel = clip(input.pointLabel, max: 120)
        let stationId = clip(input.stationId, max: 64)
        let shiftDate = clip(input.shiftDate, max: 32) ?? context.shiftDate
        let locationId = context.locationId
        let cookId = clip(input.cookId, max: 64) ?? context.actorCookId

        guard let pointLabel else {
            throw SanitizerWriteError.validationFailed("point_label is required")
        }

        let decision = SanitizerCompute.classifySanitizer(
            chemistry, concentrationPpm: concentrationPpm, waterTempF: waterTempF
        )

        // Low/high reading without a corrective action is an incomplete record —
        // FDA wants evidence of WHAT the line did. Web returns 422 so the UI can
        // prompt inline rather than silently accepting a bad log.
        if decision.status != .ok && clippedNote == nil {
            throw SanitizerWriteError.needsCorrectiveAction(
                reason: decision.breachReason ?? "reading out of spec",
                status: decision.status,
                requiredMinPpm: decision.requiredMinPpm,
                requiredMaxPpm: decision.requiredMaxPpm
            )
        }

        let row = try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: """
                  INSERT INTO sanitizer_checks
                    (shift_date, location_id, station_id, point_label, chemistry,
                     concentration_ppm, required_min_ppm, required_max_ppm, water_temp_f,
                     status, corrective_action, cook_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  """,
                arguments: [
                    shiftDate,
                    locationId,
                    stationId,
                    pointLabel,
                    chemistry.rawValue,
                    concentrationPpm,
                    decision.requiredMinPpm,
                    decision.requiredMaxPpm,
                    waterTempF,
                    decision.status.rawValue,
                    clippedNote,
                    cookId,
                ]
            )
            let newId = db.lastInsertedRowID
            guard let inserted = try SanitizerRow.fetchOne(
                db, sql: "SELECT * FROM sanitizer_checks WHERE id = ?", arguments: [newId]
            ) else {
                throw SanitizerWriteError.persistenceFailed
            }
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "sanitizer_checks",
                    entityId: newId,
                    action: .insert,
                    actorCookId: context.actorCookId ?? cookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(inserted),
                    note: decision.breachReason,
                    shiftDate: shiftDate,
                    locationId: locationId
                )
            )
            return inserted
        }

        return RecordResult(row: row, classification: decision)
    }

    private func clip(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }
}
