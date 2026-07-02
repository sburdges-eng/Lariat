import Foundation
import GRDB
import LariatModel

/// Box-office lines — behavior parity with `lib/boxOfficeRepo.ts` and the
/// `/api/shows/[id]/box-office{,/[lineId]}` routes. Cash custody is
/// REGULATED: every write posts to the `audit_events` DB stream inside the
/// same transaction as the source mutation (`AuditEventWriter` +
/// `AuditedWriteRunner`) — never the file stream. Money columns are REAL
/// dollars (`Double?`); settlement converts to Int cents at ITS read
/// boundary, not here.
///
/// `actor_source` is taken from the caller's `RegulatedWriteContext`
/// (`native_mac`) — the web tags `box_office` / `dice_ingest`; the per-write
/// native PIN gate is the established LariatNative analog (documented
/// divergence, same as tip-pool's `pic_ui` → `native_mac`).
public struct BoxOfficeRepository {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase?
    private let locationId: String

    public init(
        readDB: LariatDatabase,
        writeDB: LariatWriteDatabase? = nil,
        locationId: String = LocationScope.resolve()
    ) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.locationId = locationId
    }

    // ── Reads ─────────────────────────────────────────────────────────

    public func listLines(showId: Int64) async throws -> [BoxOfficeLineRow] {
        let loc = locationId
        return try await readDB.pool.read { db in
            try Self.fetchLines(db, showId: showId, locationId: loc)
        }
    }

    /// DB-side rollup — parity with `summarizeBoxOffice(db, …)` in
    /// `lib/boxOfficeRepo.ts` (revenue = Σ face×qty WITHOUT fees; fees
    /// counted once per line — the web quirk, ported faithfully).
    public func summarize(showId: Int64) async throws -> BoxOfficeDbSummary {
        let loc = locationId
        return try await readDB.pool.read { db in
            let lines = try Self.fetchLines(db, showId: showId, locationId: loc)
            return Self.summarize(lines: lines, showId: showId, locationId: loc)
        }
    }

    static func summarize(lines: [BoxOfficeLineRow], showId: Int64, locationId: String) -> BoxOfficeDbSummary {
        var totalQty = 0
        var totalRevenue = 0.0
        var totalFees = 0.0
        var bySource = BoxOfficeDbSummary.zeroBySource()
        var scannedQty = 0
        var unscannedQty = 0
        for l in lines {
            totalQty += l.qty
            let rev = (l.facePrice ?? 0) * Double(l.qty)
            totalRevenue += rev
            totalFees += l.fees ?? 0
            if let src = BoxOfficeSource(rawValue: l.source) {
                bySource[src]!.qty += l.qty
                bySource[src]!.revenue += rev
            }
            if l.scannedAt != nil { scannedQty += l.qty } else { unscannedQty += l.qty }
        }
        return BoxOfficeDbSummary(
            showId: showId, locationId: locationId, totalQty: totalQty,
            totalRevenue: totalRevenue, totalFees: totalFees, bySource: bySource,
            scannedQty: scannedQty, unscannedQty: unscannedQty
        )
    }

    // ── createLine (POST /box-office) ─────────────────────────────────

    @discardableResult
    public func createLine(
        _ input: BoxOfficeCreateLineInput,
        context: RegulatedWriteContext
    ) throws -> BoxOfficeLineRow {
        guard input.showId > 0 else {
            throw ShowsWriteError.validationFailed("show_id must be a positive integer")
        }
        guard BoxOfficeSource(rawValue: input.source) != nil else {
            throw ShowsWriteError.validationFailed("invalid source: \(input.source)")
        }
        guard input.qty > 0 else {
            throw ShowsWriteError.validationFailed("qty must be a positive integer")
        }
        let writeDB = try requireWriteDB()
        let loc = locationId
        // Route parity: notes clipped to 4000 chars.
        let notes = input.notes.map { String($0.prefix(4000)) }

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: """
                  INSERT INTO box_office_lines
                    (show_id, location_id, source, ticket_class, qty, face_price, fees, external_ref, notes)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                  """,
                arguments: [
                    input.showId, loc, input.source, input.ticketClass,
                    input.qty, input.facePrice, input.fees, input.externalRef, notes,
                ]
            )
            let id = db.lastInsertedRowID
            guard let row = try Self.fetchLine(db, id: id) else {
                throw ShowsWriteError.persistenceFailed
            }
            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "box_office_lines",
                entityId: id,
                action: .insert,
                actorCookId: context.actorCookId,
                actorSource: context.actorSource,
                payloadJSON: Self.payloadJSON([
                    "show_id": input.showId,
                    "source": input.source,
                    "ticket_class": input.ticketClass,
                    "qty": input.qty,
                    "face_price": input.facePrice,
                    "fees": input.fees,
                    "external_ref": input.externalRef,
                ]),
                shiftDate: context.shiftDate,
                locationId: loc
            ))
            return row
        }
    }

    // ── markScanned (PATCH /box-office/[lineId]) ──────────────────────

    /// Flip `scanned_at` on one line at the door. Scoped by show_id +
    /// location_id so a cross-show line id cannot be mutated. Returns nil
    /// when no eligible row matched (already scanned / missing / mismatch)
    /// — the web surfaces that as 404 with NO second audit row.
    public func markScanned(
        showId: Int64,
        lineId: Int64,
        context: RegulatedWriteContext
    ) throws -> BoxOfficeLineRow? {
        guard showId > 0 else {
            throw ShowsWriteError.validationFailed("show_id must be a positive integer")
        }
        guard lineId > 0 else {
            throw ShowsWriteError.validationFailed("line_id must be a positive integer")
        }
        let writeDB = try requireWriteDB()
        let loc = locationId

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: """
                  UPDATE box_office_lines
                     SET scanned_at = datetime('now')
                   WHERE id = ? AND show_id = ? AND location_id = ? AND scanned_at IS NULL
                  """,
                arguments: [lineId, showId, loc]
            )
            guard db.changesCount > 0 else { return nil }
            guard let row = try Self.fetchLine(db, id: lineId) else {
                throw ShowsWriteError.persistenceFailed
            }
            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "box_office_lines",
                entityId: lineId,
                action: .update,
                actorCookId: context.actorCookId,
                actorSource: context.actorSource,
                payloadJSON: Self.payloadJSON([
                    "op": "mark_scanned",
                    "show_id": row.showId,
                    "source": row.source,
                    "qty": row.qty,
                    "external_ref": row.externalRef,
                    "scanned_at": row.scannedAt,
                ]),
                shiftDate: context.shiftDate,
                locationId: loc
            ))
            return row
        }
    }

    // ── DICE bulk import (idempotent on (source='dice', external_ref)) ─

    /// Idempotent batch import keyed on the partial UNIQUE index
    /// `idx_box_office_external_ref_unique`. First call inserts; identical
    /// re-runs are audit-silent no-ops; revised rows UPDATE with a
    /// before/after `dice_revision` audit. Money-critical: a non-idempotent
    /// retry would inflate settlement grossCents and silently overpay talent.
    /// Not exposed in the native UI (script/edge surface) — ported for
    /// contract parity. Web tags `actor_source='dice_ingest'`; the native
    /// caller's context tags `native_mac` (documented divergence).
    @discardableResult
    public func bulkUpsertFromDice(
        _ lines: [DiceLineInput],
        context: RegulatedWriteContext
    ) throws -> DiceBulkUpsertResult {
        for l in lines {
            guard l.showId > 0 else {
                throw ShowsWriteError.validationFailed("bulkUpsertFromDice: every line.show_id must be a positive integer")
            }
            guard !l.externalRef.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw ShowsWriteError.validationFailed("bulkUpsertFromDice: every line.external_ref must be a non-empty string")
            }
            guard l.qty > 0 else {
                throw ShowsWriteError.validationFailed("bulkUpsertFromDice: every line.qty must be a positive integer")
            }
        }
        let writeDB = try requireWriteDB()
        let loc = locationId

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            var inserted = 0
            var updated = 0
            for l in lines {
                // One SELECT before each upsert tells us whether the conflict
                // path will INSERT or UPDATE so the audit row carries the
                // right action (web parity).
                let before = try Row.fetchOne(
                    db,
                    sql: """
                      SELECT id, qty, face_price, fees, ticket_class, notes
                        FROM box_office_lines
                       WHERE source = 'dice' AND external_ref = ?
                      """,
                    arguments: [l.externalRef]
                )

                // Bare ON CONFLICT DO UPDATE — the portable form for a
                // partial-unique-index conflict target (web comment parity).
                let idRow = try Row.fetchOne(
                    db,
                    sql: """
                      INSERT INTO box_office_lines
                        (show_id, location_id, source, ticket_class, qty, face_price, fees, external_ref, notes)
                      VALUES (?, ?, 'dice', ?, ?, ?, ?, ?, ?)
                      ON CONFLICT DO UPDATE SET
                        show_id      = excluded.show_id,
                        location_id  = excluded.location_id,
                        ticket_class = excluded.ticket_class,
                        qty          = excluded.qty,
                        face_price   = excluded.face_price,
                        fees         = excluded.fees,
                        notes        = excluded.notes
                      RETURNING id
                      """,
                    arguments: [l.showId, loc, l.ticketClass, l.qty, l.facePrice, l.fees, l.externalRef, l.notes]
                )
                guard let id: Int64 = idRow?["id"] else {
                    throw ShowsWriteError.persistenceFailed
                }

                if let before {
                    let changed =
                        (before["qty"] as Int) != l.qty
                        || (before["face_price"] as Double?) != l.facePrice
                        || (before["fees"] as Double?) != l.fees
                        || (before["ticket_class"] as String?) != l.ticketClass
                        || (before["notes"] as String?) != l.notes
                    if changed {
                        updated += 1
                        _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                            entity: "box_office_lines",
                            entityId: id,
                            action: .update,
                            actorCookId: context.actorCookId,
                            actorSource: context.actorSource,
                            payloadJSON: Self.payloadJSON([
                                "op": "dice_revision",
                                "show_id": l.showId,
                                "external_ref": l.externalRef,
                                "before": [
                                    "qty": before["qty"] as Int,
                                    "face_price": before["face_price"] as Double?,
                                    "fees": before["fees"] as Double?,
                                    "ticket_class": before["ticket_class"] as String?,
                                    "notes": before["notes"] as String?,
                                ] as [String: Any?],
                                "after": [
                                    "qty": l.qty,
                                    "face_price": l.facePrice,
                                    "fees": l.fees,
                                    "ticket_class": l.ticketClass,
                                    "notes": l.notes,
                                ] as [String: Any?],
                            ]),
                            shiftDate: context.shiftDate,
                            locationId: loc
                        ))
                    }
                    // Identical re-run: no audit row, no count bump —
                    // idempotency is the explicit promise.
                } else {
                    inserted += 1
                    _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                        entity: "box_office_lines",
                        entityId: id,
                        action: .insert,
                        actorCookId: context.actorCookId,
                        actorSource: context.actorSource,
                        payloadJSON: Self.payloadJSON([
                            "show_id": l.showId,
                            "source": "dice",
                            "external_ref": l.externalRef,
                            "ticket_class": l.ticketClass,
                            "qty": l.qty,
                            "face_price": l.facePrice,
                            "fees": l.fees,
                        ]),
                        shiftDate: context.shiftDate,
                        locationId: loc
                    ))
                }
            }
            return DiceBulkUpsertResult(inserted: inserted, updated: updated)
        }
    }

    // ── helpers ───────────────────────────────────────────────────────

    static func fetchLines(_ db: Database, showId: Int64, locationId: String) throws -> [BoxOfficeLineRow] {
        try BoxOfficeLineRow.fetchAll(
            db,
            sql: """
              SELECT * FROM box_office_lines
               WHERE show_id = ? AND location_id = ?
               ORDER BY created_at DESC, id DESC
              """,
            arguments: [showId, locationId]
        )
    }

    static func fetchLine(_ db: Database, id: Int64) throws -> BoxOfficeLineRow? {
        try BoxOfficeLineRow.fetchOne(
            db, sql: "SELECT * FROM box_office_lines WHERE id = ?", arguments: [id]
        )
    }

    /// Mixed-type payload → JSON (nulls preserved, keys sorted).
    static func payloadJSON(_ fields: [String: Any?]) -> String {
        var dict: [String: Any] = [:]
        for (k, v) in fields {
            if let nested = v as? [String: Any?] {
                var inner: [String: Any] = [:]
                for (nk, nv) in nested { inner[nk] = nv ?? NSNull() }
                dict[k] = inner
            } else {
                dict[k] = v ?? NSNull()
            }
        }
        guard let data = try? JSONSerialization.data(withJSONObject: dict, options: [.sortedKeys]),
              let s = String(data: data, encoding: .utf8) else {
            return "{\"_audit_serialization_error\":true}"
        }
        return s
    }

    private func requireWriteDB() throws -> LariatWriteDatabase {
        guard let writeDB else {
            throw ShowsWriteError.persistenceFailed
        }
        return writeDB
    }
}
