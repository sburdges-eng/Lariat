import Foundation
import GRDB
import LariatModel

/// Repository for Time as Public Health Control (F11 / FDA §3-501.19) — behavior
/// parity with `app/api/tphc/route.js`. Reads via the read-only pool; regulated
/// writes (start batch / discard) go through `AuditedWriteRunner` so the
/// `tphc_entries` mutation and its `audit_events` row commit (or roll back) in
/// ONE transaction. Status semantics mirror the web route:
///   - missing item / non-ISO started_at / unknown kind → validationFailed (web 400)
///   - unknown id / cross-location IDOR mismatch → notFound (web 404)
///   - already-discarded batch → alreadyDiscarded (web 409, carries the row)
public struct TphcRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    // ── GET — board snapshot ───────────────────────────────────────────

    /// Active (not-discarded) batches for the location, classified against `now`,
    /// plus recently-discarded rows for the day. Mirrors the web GET query:
    /// `WHERE location_id=? AND discarded_at IS NULL ORDER BY cutoff_at ASC, id ASC`.
    public func load(
        date: String = ShiftDate.todayISO(),
        locationId: String = LocationScope.resolve(),
        now: String = TphcRepository.nowISO(),
        includeRecent: Bool = true
    ) async throws -> TphcBoardSnapshot {
        try await readDB.pool.read { db in
            let active = try TphcRow.fetchAll(
                db,
                sql: """
                  SELECT * FROM tphc_entries
                  WHERE location_id = ? AND discarded_at IS NULL
                  ORDER BY cutoff_at ASC, id ASC
                  """,
                arguments: [locationId]
            )
            let snapshots = active.map {
                TphcRowSnapshot(id: $0.id, item: $0.item, stationId: $0.stationId,
                                startedAt: $0.startedAt, cutoffAt: $0.cutoffAt, discardedAt: $0.discardedAt)
            }
            let scan = TphcCompute.scanActiveTphc(snapshots, now: now) ?? []

            var recent: [TphcRow] = []
            if includeRecent {
                recent = try TphcRow.fetchAll(
                    db,
                    sql: """
                      SELECT * FROM tphc_entries
                      WHERE location_id = ? AND shift_date = ? AND discarded_at IS NOT NULL
                      ORDER BY discarded_at DESC
                      LIMIT 30
                      """,
                    arguments: [locationId, date]
                )
            }
            return TphcBoardSnapshot(locationId: locationId, now: now, active: active, scan: scan, recent: recent)
        }
    }

    // ── POST — start a TPHC batch ──────────────────────────────────────

    @discardableResult
    public func start(input: TphcStartInput, context: RegulatedWriteContext) throws -> TphcRow {
        // Validate against the raw input (parity with web `validateTphcCreate`).
        let v = TphcCompute.validateTphcCreate(item: input.item, startedAt: input.startedAt, kind: input.kind)
        guard v.ok else {
            throw TphcWriteError.validationFailed(v.reason ?? "Invalid TPHC batch")
        }
        // validateTphcCreate guarantees kind is a known enum value here.
        guard let kind = TphcKind(rawValue: input.kind) else {
            throw TphcWriteError.validationFailed("kind must be one of: \(TphcKind.allCases.map(\.rawValue).joined(separator: ", "))")
        }

        let item = clip(input.item, max: 200)
        let startedAt = clip(input.startedAt, max: 40)
        let batchRef = clip(input.batchRef, max: 120)
        let stationId = clip(input.stationId, max: 64)
        let cookId = clip(input.cookId, max: 64) ?? context.actorCookId
        let shiftDate = clip(input.shiftDate, max: 10) ?? context.shiftDate
        let locationId = context.locationId

        guard let item, let startedAt else {
            throw TphcWriteError.validationFailed("Item is required")
        }
        // cutoff computed server-side (parity with route's computeCutoffAt).
        guard let cutoffAt = TphcCompute.computeCutoffAt(startedAt: startedAt, kind: kind) else {
            throw TphcWriteError.validationFailed("started_at must be an ISO 8601 timestamp")
        }

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: """
                  INSERT INTO tphc_entries
                    (shift_date, location_id, station_id, item, batch_ref, started_at, cutoff_at, cook_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                  """,
                arguments: [shiftDate, locationId, stationId, item, batchRef, startedAt, cutoffAt, cookId]
            )
            let newId = db.lastInsertedRowID
            guard let row = try TphcRow.fetchOne(db, sql: "SELECT * FROM tphc_entries WHERE id = ?", arguments: [newId]) else {
                throw TphcWriteError.persistenceFailed
            }
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "tphc_entries",
                    entityId: newId,
                    action: .insert,
                    actorCookId: context.actorCookId ?? cookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(row),
                    note: "TPHC started: kind=\(kind.rawValue) cutoff=\(cutoffAt)",
                    shiftDate: shiftDate,
                    locationId: locationId
                )
            )
            return row
        }
    }

    // ── PATCH — discard a TPHC batch ───────────────────────────────────

    /// Mark a batch discarded/consumed. `discardedAt` defaults to now; a param so
    /// tests can freeze time. SELECT + IDOR guard + already-discarded guard +
    /// UPDATE + audit run in ONE transaction so two concurrent PATCHes on the
    /// same id can't both pass `discarded_at IS NULL` against a stale snapshot.
    @discardableResult
    public func discard(
        input: TphcDiscardInput,
        context: RegulatedWriteContext,
        discardedAt: String = TphcRepository.nowISO()
    ) throws -> TphcRow {
        guard input.id > 0 else {
            throw TphcWriteError.validationFailed("id is required")
        }
        let reason = clip(input.discardReason, max: 64)
        guard let reason, TphcCompute.isTphcDiscardReason(reason) else {
            throw TphcWriteError.validationFailed(
                "discard_reason must be one of: \(TphcDiscardReason.allCases.map(\.rawValue).joined(separator: ", "))")
        }
        let cookId = clip(input.cookId, max: 64) ?? context.actorCookId

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            guard let existing = try TphcRow.fetchOne(db, sql: "SELECT * FROM tphc_entries WHERE id = ?", arguments: [input.id]) else {
                throw TphcWriteError.notFound
            }
            // Cross-location IDOR guard — surfaced as notFound (web 404, NOT 403)
            // so the existence of a batch at another site doesn't leak.
            if existing.locationId != context.locationId {
                throw TphcWriteError.notFound
            }
            // Already-discarded → 409, carrying the existing row (parity).
            if existing.discardedAt != nil {
                throw TphcWriteError.alreadyDiscarded(entry: existing)
            }

            try db.execute(
                sql: """
                  UPDATE tphc_entries
                  SET discarded_at = ?, discard_reason = ?
                  WHERE id = ?
                  """,
                arguments: [discardedAt, reason, input.id]
            )
            guard let updated = try TphcRow.fetchOne(db, sql: "SELECT * FROM tphc_entries WHERE id = ?", arguments: [input.id]) else {
                throw TphcWriteError.persistenceFailed
            }
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "tphc_entries",
                    entityId: input.id,
                    action: .update,
                    actorCookId: cookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(updated),
                    note: "discarded: \(reason)",
                    shiftDate: existing.shiftDate,
                    locationId: existing.locationId
                )
            )
            return updated
        }
    }

    // ── helpers ────────────────────────────────────────────────────────

    /// ISO-8601 "now" with fractional seconds + Z (parity with JS `toISOString()`).
    public static func nowISO() -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        f.timeZone = TimeZone(secondsFromGMT: 0)
        return f.string(from: Date())
    }

    private func clip(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }
}
