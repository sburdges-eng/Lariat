import Foundation
import GRDB
import LariatModel

/// Repository for the two-stage cooling log — behavior parity with
/// `app/api/cooling/route.js`. Reads via the read-only pool; regulated writes
/// (open batch / log stage reading) go through `AuditedWriteRunner` so the
/// `cooling_log` mutation and its `audit_events` row commit (or roll back) in
/// ONE transaction. Status semantics mirror the web route:
///   - missing item / non-ISO started_at → validationFailed (web 400)
///   - breach decision with no corrective note → needsCorrectiveAction (web 422)
///   - unknown id / cross-location mismatch → notFound (web 404)
public struct CoolingRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    // ── GET — board snapshot ───────────────────────────────────────────

    public func load(
        date: String = ShiftDate.todayISO(),
        locationId: String = LocationScope.resolve(),
        includeClosed: Bool = true,
        nowMs: Double = Date().timeIntervalSince1970 * 1000
    ) async throws -> CoolingBoardSnapshot {
        try await readDB.pool.read { db in
            let open = try CoolingRow.fetchAll(
                db,
                sql: """
                  SELECT * FROM cooling_log
                  WHERE location_id = ? AND status = 'in_progress'
                  ORDER BY started_at ASC
                  """,
                arguments: [locationId]
            )
            let scan = CoolingCompute.scanOpenBatches(open, nowMs: nowMs)
            var closed: [CoolingRow] = []
            if includeClosed {
                closed = try CoolingRow.fetchAll(
                    db,
                    sql: """
                      SELECT * FROM cooling_log
                      WHERE location_id = ? AND shift_date = ? AND status != 'in_progress'
                      ORDER BY id DESC
                      LIMIT 30
                      """,
                    arguments: [locationId, date]
                )
            }
            return CoolingBoardSnapshot(date: date, locationId: locationId, open: open, scan: scan, closed: closed)
        }
    }

    // ── POST — open a cooling batch ────────────────────────────────────

    @discardableResult
    public func start(input: CoolingStartInput, context: RegulatedWriteContext) throws -> CoolingRow {
        // Validate against the raw input (parity with web `validateCoolingStart`).
        let v = CoolingCompute.validateCoolingStart(
            item: input.item,
            startedAt: input.startedAt,
            startReadingF: input.startReadingF
        )
        guard v.ok else {
            throw CoolingWriteError.validationFailed(v.reason ?? "Invalid cooling batch")
        }

        let shiftDate = clip(input.shiftDate, max: 32) ?? context.shiftDate
        let locationId = context.locationId
        let item = clip(input.item, max: 200)
        let stationId = clip(input.stationId, max: 64)
        let cookId = clip(input.cookId, max: 64) ?? context.actorCookId
        let startedAt = clip(input.startedAt, max: 40)
        let startReadingF = input.startReadingF

        guard let item, let startedAt else {
            throw CoolingWriteError.validationFailed("Item name is required")
        }

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: """
                  INSERT INTO cooling_log
                    (shift_date, location_id, item, station_id, started_at, start_reading_f, status, cook_id)
                  VALUES (?, ?, ?, ?, ?, ?, 'in_progress', ?)
                  """,
                arguments: [shiftDate, locationId, item, stationId, startedAt, startReadingF, cookId]
            )
            let newId = db.lastInsertedRowID
            guard let row = try CoolingRow.fetchOne(db, sql: "SELECT * FROM cooling_log WHERE id = ?", arguments: [newId]) else {
                throw CoolingWriteError.persistenceFailed
            }
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "cooling_log",
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

    // ── PATCH — record a stage-1 or stage-2 reading ────────────────────

    public struct StageResult: Sendable {
        public let row: CoolingRow
        public let decision: CoolingStageDecision
    }

    @discardableResult
    public func logStage(input: CoolingStageInput, context: RegulatedWriteContext) throws -> StageResult {
        let correctiveAction = CoolingCompute.normalizeCorrectiveAction(input.correctiveAction)
        // Web rejects an over-long note with 400 BEFORE classification.
        if let note = correctiveAction, note.count > CoolingCompute.correctiveNoteMaxLength {
            throw CoolingWriteError.correctiveNoteTooLong(length: note.count)
        }
        let at = clip(input.at, max: 40)
        let cookId = clip(input.cookId, max: 64) ?? context.actorCookId

        // SELECT + classify + UPDATE + audit run in ONE transaction so two
        // concurrent stage-2 logs can't both decide off the same stale row.
        return try AuditedWriteRunner.perform(db: writeDB) { db in
            guard let existing = try CoolingRow.fetchOne(db, sql: "SELECT * FROM cooling_log WHERE id = ?", arguments: [input.id]) else {
                throw CoolingWriteError.notFound
            }
            // Cross-location IDOR guard — surfaced as notFound (web 404) so the
            // existence of a batch at another site doesn't leak.
            if existing.locationId != context.locationId {
                throw CoolingWriteError.notFound
            }

            let decision = CoolingCompute.classifyCoolingStage(
                startedAt: existing.startedAt,
                stage1At: existing.stage1At,
                status: existing.status,
                readingF: input.readingF,
                at: input.at
            )
            let stage: Int
            let status: CoolingStageStatus
            let breachReason: CoolingBreachReason?
            switch decision {
            case .invalid(let reason):
                throw CoolingWriteError.validationFailed(reason)
            case let .decided(s, st, br, _):
                stage = s; status = st; breachReason = br
            }
            if status == .breach && correctiveAction == nil {
                throw CoolingWriteError.needsCorrectiveAction(reason: "breach requires a corrective action note")
            }

            // Write only the stage-appropriate fields; the other stage's columns
            // stay NULL if they were NULL. corrective_action is COALESCE'd so a
            // nil note never clobbers an earlier one.
            if stage == 1 {
                try db.execute(
                    sql: """
                      UPDATE cooling_log
                      SET stage1_at = ?, stage1_reading_f = ?, status = ?, breach_reason = ?,
                          corrective_action = COALESCE(?, corrective_action)
                      WHERE id = ?
                      """,
                    arguments: [at, input.readingF, status.rawValue, breachReason?.rawValue, correctiveAction, input.id]
                )
            } else {
                try db.execute(
                    sql: """
                      UPDATE cooling_log
                      SET stage2_at = ?, stage2_reading_f = ?, status = ?, breach_reason = ?,
                          corrective_action = COALESCE(?, corrective_action),
                          closed_by_cook_id = ?
                      WHERE id = ?
                      """,
                    arguments: [at, input.readingF, status.rawValue, breachReason?.rawValue, correctiveAction, cookId, input.id]
                )
            }

            guard let updated = try CoolingRow.fetchOne(db, sql: "SELECT * FROM cooling_log WHERE id = ?", arguments: [input.id]) else {
                throw CoolingWriteError.persistenceFailed
            }
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "cooling_log",
                    entityId: input.id,
                    action: .update,
                    actorCookId: cookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(updated),
                    note: breachReason.map { "breach: \($0.rawValue)" },
                    shiftDate: existing.shiftDate,
                    locationId: existing.locationId
                )
            )
            return StageResult(row: updated, decision: decision)
        }
    }

    private func clip(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }
}
