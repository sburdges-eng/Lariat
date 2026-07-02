import Foundation
import GRDB
import LariatModel

/// Repository for the pest-control log — behavior parity with
/// `app/api/pest/route.ts` (FDA §6-501.111). Reads via the read-only pool;
/// the regulated write (log an entry) goes through `AuditedWriteRunner` so the
/// `pest_control_log` INSERT and its `audit_events` row commit (or roll back)
/// in ONE transaction. Status semantics mirror the web route:
///   - missing/unknown entry_type, sighting-without-pest, unknown pest/severity
///     → validationFailed (web 400)
///   - audit/insert failure → persistenceFailed (web 500)
///
/// The web route has no 422 corrective-note gate and no PIN gate — a pest entry
/// is an append-only observation, so there is intentionally no RuleGate here.
public struct PestRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    // Field caps mirror `clip(...)` / `.slice()` in the web route.
    private static let shiftDateMax = 32
    private static let entryTypeMax = 64
    private static let vendorMax = 100
    private static let technicianMax = 100
    private static let findingsMax = 1000
    private static let pestMax = 64
    private static let severityMax = 64
    private static let correctiveActionMax = 500
    private static let reportPathMax = 300
    private static let cookIdMax = 64

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    // ── GET — board snapshot ───────────────────────────────────────────

    public func load(
        locationId: String = LocationScope.resolve()
    ) async throws -> PestBoardSnapshot {
        try await readDB.pool.read { db in
            let rows = try PestRow.fetchAll(
                db,
                sql: """
                  SELECT * FROM pest_control_log
                   WHERE location_id = ?
                   ORDER BY created_at DESC LIMIT 100
                  """,
                arguments: [locationId]
            )
            return PestBoardSnapshot(locationId: locationId, rows: rows)
        }
    }

    // ── POST — log a pest-control entry ────────────────────────────────

    @discardableResult
    public func log(input: PestControlInput, context: RegulatedWriteContext) throws -> PestRow {
        // Validate against the raw input (parity with web `validatePestControl`).
        let v = PestCompute.validate(input)
        guard v.ok else {
            throw PestWriteError.validationFailed(v.reason ?? "Invalid pest control log")
        }

        // Clip fields exactly as the web route does before the INSERT.
        let shiftDate = clip(input.shiftDate, max: Self.shiftDateMax) ?? context.shiftDate
        let locationId = context.locationId
        let entryType = clip(input.entryType, max: Self.entryTypeMax)
        let vendor = clip(input.vendor, max: Self.vendorMax)
        let technician = clip(input.technician, max: Self.technicianMax)
        // findings/corrective_action are trimmed then hard-sliced (not nil-on-empty
        // beyond trim) — parity with the web route's `.trim().slice(...)`.
        let findings = trimSlice(input.findings, max: Self.findingsMax)
        let pest = clip(input.pest, max: Self.pestMax)
        let severity = clip(input.severity, max: Self.severityMax)
        let correctiveAction = trimSlice(input.correctiveAction, max: Self.correctiveActionMax)
        let reportPath = clip(input.reportPath, max: Self.reportPathMax)
        let cookId = clip(input.cookId, max: Self.cookIdMax) ?? context.actorCookId

        guard let entryType else {
            // validate() already guarantees a known entry_type; this is a guard
            // against an all-whitespace value slipping past clip.
            throw PestWriteError.validationFailed("invalid entry_type")
        }

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: """
                  INSERT INTO pest_control_log
                    (shift_date, location_id, entry_type, vendor, technician, findings, pest, severity, corrective_action, report_path, cook_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  """,
                arguments: [
                    shiftDate, locationId, entryType, vendor, technician, findings,
                    pest, severity, correctiveAction, reportPath, cookId,
                ]
            )
            let newId = db.lastInsertedRowID
            guard let row = try PestRow.fetchOne(
                db, sql: "SELECT * FROM pest_control_log WHERE id = ?", arguments: [newId]
            ) else {
                throw PestWriteError.persistenceFailed
            }
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "pest_control_log",
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

    // ── clipping helpers (parity with lib/clip.ts + route trimming) ────

    /// `clip(v, n)` — trim, cap length, nil when empty.
    private func clip(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }

    /// `typeof v === 'string' ? v.trim().slice(0, n) : null` — trim then hard-cap,
    /// keeping an empty string as nil (an all-whitespace trim collapses to "").
    private func trimSlice(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return String(trimmed.prefix(max))
    }
}
