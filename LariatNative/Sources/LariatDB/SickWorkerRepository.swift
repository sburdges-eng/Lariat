import Foundation
import GRDB
import LariatModel

/// Repository for employee-health sick reports — behavior parity with
/// `app/api/sick-worker/route.js` (F5 / FDA §2-201.11). Reads via the read-only
/// pool; regulated writes (file a report / clear return-to-work) go through
/// `AuditedWriteRunner` so the `sick_worker_reports` mutation and its
/// `audit_events` row commit (or roll back) in ONE transaction.
///
/// Status semantics mirror the web route:
///   - missing cook_id / non-ISO started_at / below-FDA-floor action → validationFailed (web 400)
///   - missing clearance_source on clear → validationFailed (web 400)
///   - unknown id / cross-location mismatch → notFound (web 404)
///   - clearing an already-cleared report → alreadyCleared (web 409)
///
/// Writes are tagged `actor_source = native_cook` (the web route uses `pic_ui`;
/// this is the native equivalent per the LariatNative write discipline).
public struct SickWorkerRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    // ── GET — board snapshot (active exclusions + optional cleared history) ─

    public func load(
        locationId: String = LocationScope.resolve(),
        includeHistory: Bool = true
    ) async throws -> SickWorkerBoardSnapshot {
        try await readDB.pool.read { db in
            // PHI projection (C1 verify-41 T2): the open active board is shown
            // without a manager PIN, so — matching the web thin projection — the
            // `symptoms` and `diagnosed_illness` columns are replaced by SQL
            // literals and never read off disk. Full PHI stays on the PIN-gated
            // `history` path below (SELECT *).
            let active = try SickWorkerRow.fetchAll(
                db,
                sql: """
                  SELECT id, shift_date, location_id, cook_id, reported_by_pic_id,
                         '' AS symptoms, NULL AS diagnosed_illness,
                         action, started_at, return_at, clearance_source, note, created_at
                  FROM sick_worker_reports
                  WHERE location_id = ? AND return_at IS NULL
                  ORDER BY started_at DESC
                  """,
                arguments: [locationId]
            )
            var history: [SickWorkerRow] = []
            if includeHistory {
                history = try SickWorkerRow.fetchAll(
                    db,
                    sql: """
                      SELECT * FROM sick_worker_reports
                      WHERE location_id = ? AND return_at IS NOT NULL
                      ORDER BY return_at DESC
                      LIMIT 100
                      """,
                    arguments: [locationId]
                )
            }
            return SickWorkerBoardSnapshot(locationId: locationId, active: active, history: history)
        }
    }

    // ── POST — file a sick report ──────────────────────────────────────

    @discardableResult
    public func file(input: SickReportFileInput, context: RegulatedWriteContext) throws -> SickWorkerRow {
        // Normalize + validate against the raw input (parity with web
        // `validateSickReport` in lib/sickWorker.ts). When the client omits an
        // action the FDA minimum is used — same fallback the board applies.
        let normalizedSymptoms = SickWorkerCompute.normalizeSymptoms(array: input.symptoms)
        let dxResult = SickWorkerCompute.normalizeDiagnosis(input.diagnosedIllness)

        let resolvedAction = resolveAction(
            requested: input.action,
            symptoms: normalizedSymptoms,
            diagnosis: dxResult
        )

        let validation = SickWorkerCompute.validateSickReport(
            SickReportInput(
                cookId: input.cookId,
                symptoms: .array(input.symptoms),
                diagnosedIllness: input.diagnosedIllness,
                action: resolvedAction,
                startedAt: input.startedAt
            )
        )
        guard validation.ok else {
            throw SickWorkerWriteError.validationFailed(validation.reason ?? "Invalid sick report")
        }

        // Post-validation the vocabulary is known-good; join canonical keys.
        let symptomsJoined = (normalizedSymptoms ?? []).map(\.rawValue).joined(separator: ",")
        let diagnosisValue: String? = {
            if case let .valid(dx) = dxResult { return dx.rawValue }
            return nil
        }()

        let shiftDate = clip(input.shiftDate, max: 32) ?? context.shiftDate
        let locationId = context.locationId
        let cookId = clip(input.cookId, max: 64) ?? input.cookId
        let reportedByPicId = clip(input.reportedByPicId, max: 64)
        let startedAt = clip(input.startedAt, max: 40) ?? input.startedAt
        let note = clip(input.note, max: 1000)

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: """
                  INSERT INTO sick_worker_reports
                    (shift_date, location_id, cook_id, reported_by_pic_id,
                     symptoms, diagnosed_illness, action, started_at, clearance_source, note)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
                  """,
                arguments: [shiftDate, locationId, cookId, reportedByPicId, symptomsJoined, diagnosisValue, resolvedAction, startedAt, note]
            )
            let newId = db.lastInsertedRowID
            guard let row = try SickWorkerRow.fetchOne(db, sql: "SELECT * FROM sick_worker_reports WHERE id = ?", arguments: [newId]) else {
                throw SickWorkerWriteError.persistenceFailed
            }
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "sick_worker_reports",
                    entityId: newId,
                    action: .insert,
                    actorCookId: reportedByPicId ?? context.actorCookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(row),
                    shiftDate: shiftDate,
                    locationId: locationId
                )
            )
            return row
        }
    }

    // ── PATCH — record return-to-work clearance ────────────────────────

    @discardableResult
    public func clear(input: SickReportClearInput, context: RegulatedWriteContext) throws -> SickWorkerRow {
        guard input.id > 0 else { throw SickWorkerWriteError.validationFailed("id is required") }
        guard let clearanceSource = clip(input.clearanceSource, max: 64) else {
            throw SickWorkerWriteError.validationFailed(
                "clearance_source is required (asymptomatic_24h|medical_clearance|health_dept|...)"
            )
        }
        let reportedByPicId = clip(input.reportedByPicId, max: 64)

        // The pre-check + UPDATE run in ONE transaction so two concurrent
        // clearances can't both pass the 409 guard and double-write.
        return try AuditedWriteRunner.perform(db: writeDB) { db in
            guard let existing = try SickWorkerRow.fetchOne(db, sql: "SELECT * FROM sick_worker_reports WHERE id = ?", arguments: [input.id]) else {
                throw SickWorkerWriteError.notFound
            }
            // Cross-location IDOR guard — surfaced as notFound (web 404) so the
            // existence of a report at another site doesn't leak.
            if existing.locationId != context.locationId {
                throw SickWorkerWriteError.notFound
            }
            if existing.returnAt != nil {
                throw SickWorkerWriteError.alreadyCleared
            }

            let now = ISO8601DateFormatter.sickWorker.string(from: Date())
            try db.execute(
                sql: """
                  UPDATE sick_worker_reports
                  SET return_at = ?, clearance_source = ?
                  WHERE id = ?
                  """,
                arguments: [now, clearanceSource, input.id]
            )
            guard let updated = try SickWorkerRow.fetchOne(db, sql: "SELECT * FROM sick_worker_reports WHERE id = ?", arguments: [input.id]) else {
                throw SickWorkerWriteError.persistenceFailed
            }
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "sick_worker_reports",
                    entityId: input.id,
                    action: .update,
                    actorCookId: reportedByPicId ?? context.actorCookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(updated),
                    note: "cleared: \(clearanceSource)",
                    shiftDate: existing.shiftDate,
                    locationId: existing.locationId
                )
            )
            return updated
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────

    /// Resolve the action to persist: use the client's when supplied, else fall
    /// back to the FDA minimum (parity with the web `action || suggestedAction`).
    private func resolveAction(
        requested: String?,
        symptoms: [SickSymptom]?,
        diagnosis: SickDiagnosisResult
    ) -> String {
        if let requested, !requested.trimmingCharacters(in: .whitespaces).isEmpty {
            return requested
        }
        let dx: SickDiagnosis? = { if case let .valid(d) = diagnosis { return d }; return nil }()
        return SickWorkerCompute.requiredActionFor(symptoms: symptoms ?? [], diagnosis: dx).rawValue
    }

    private func clip(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }
}

private extension ISO8601DateFormatter {
    static let sickWorker: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}
