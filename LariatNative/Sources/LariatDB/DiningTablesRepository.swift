import Foundation
import GRDB
import LariatModel

/// Floor-board repository — parity with `app/api/dining-tables/route.js`
/// (GET/POST) and `app/api/dining-tables/[id]/route.js` (PATCH/DELETE), plus
/// the floor page's open-reservations read (`app/floor/page.jsx`).
///
/// Every regulated write posts its `audit_events` row inside the SAME
/// transaction as the source mutation (parity with `postAuditEvent`).
/// Rule failures throw typed `DiningTableWriteError`s BEFORE any write.
public struct DiningTablesRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    // ── reads ────────────────────────────────────────────────────────────

    /// GET /api/dining-tables — ORDER BY id ASC (TEXT → lexicographic).
    public func list(locationId: String = LocationScope.resolve()) async throws -> [DiningTableRow] {
        try await readDB.pool.read { db in
            try DiningTableRow.fetchAll(
                db,
                sql: """
                  SELECT id, name, capacity, x, y, w, h, status, notes,
                         location_id, created_at, updated_at
                    FROM dining_tables
                   WHERE location_id = ?
                   ORDER BY id ASC
                  """,
                arguments: [locationId]
            )
        }
    }

    /// Floor page: today's booked (not yet seated) reservations for the
    /// seat-a-reservation panel.
    public func openReservationsToday(
        locationId: String = LocationScope.resolve(),
        today: String = ShiftDate.todayISO()
    ) async throws -> [FloorReservationRow] {
        try await readDB.pool.read { db in
            try FloorReservationRow.fetchAll(
                db,
                sql: """
                  SELECT id, party_name, party_size, reservation_at, status, table_id,
                         phone, notes
                    FROM reservations
                   WHERE location_id = ?
                     AND status = 'booked'
                     AND reservation_at LIKE ?
                   ORDER BY reservation_at ASC, id ASC
                  """,
                arguments: [locationId, "\(today)%"]
            )
        }
    }

    // ── writes ───────────────────────────────────────────────────────────

    /// POST /api/dining-tables. Returns the new table's id.
    @discardableResult
    public func create(input: DiningTableCreateInput, context: RegulatedWriteContext) throws -> String {
        guard let id = clip(input.id, max: 32) else { throw DiningTableWriteError.idRequired }
        guard let name = clip(input.name, max: 100) else { throw DiningTableWriteError.nameRequired }

        var capacity = 2
        if let c = input.capacity {
            guard (1...50).contains(c) else { throw DiningTableWriteError.capacityOutOfRange }
            capacity = c
        }

        let status = input.status ?? "open"
        guard DiningTableStatuses.all.contains(status) else { throw DiningTableWriteError.badStatus }

        let x = numOrDefault(input.x, 0)
        let y = numOrDefault(input.y, 0)
        let w = numOrDefault(input.w, 1)
        let h = numOrDefault(input.h, 1)
        let notes = clip(input.notes, max: 500)
        let cookId = clip(input.cookId, max: 64)
        let locationId = context.locationId

        do {
            try AuditedWriteRunner.perform(db: writeDB) { db in
                try db.execute(
                    sql: """
                      INSERT INTO dining_tables
                        (id, name, capacity, x, y, w, h, status, notes, location_id)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                      """,
                    arguments: [id, name, capacity, x, y, w, h, status, notes, locationId]
                )
                _ = try AuditEventWriter.post(
                    db: db,
                    input: AuditEventInput(
                        entity: "dining_tables",
                        entityId: 0,
                        action: .insert,
                        actorCookId: context.actorCookId ?? cookId,
                        actorSource: context.actorSource,
                        payloadJSON: AuditEventWriter.encodePayload(
                            DiningTableInsertPayload(id: id, name: name, capacity: capacity, status: status)
                        ),
                        locationId: locationId
                    )
                )
            }
        } catch let error as DatabaseError where isPrimaryKeyConflict(error) {
            // Web: 409 'id already in use' on duplicate (location_id, id).
            throw DiningTableWriteError.idAlreadyInUse
        }
        return id
    }

    /// PATCH /api/dining-tables/:id — status update and/or field edits.
    public func update(id rawId: String, patch: DiningTablePatch, context: RegulatedWriteContext) throws {
        guard let id = clip(rawId, max: 32) else { throw DiningTableWriteError.notFound }

        // Pre-transaction validation (web returns 400 before opening the tx).
        if let s = patch.status, !DiningTableStatuses.all.contains(s) {
            throw DiningTableWriteError.badStatus
        }
        if let c = patch.capacity, !(1...50).contains(c) {
            throw DiningTableWriteError.capacityOutOfRange
        }

        let locationId = context.locationId
        let cookId = clip(patch.cookId, max: 64)

        try AuditedWriteRunner.perform(db: writeDB) { db in
            guard let row = try DiningTableRow.fetchOne(
                db,
                sql: "SELECT * FROM dining_tables WHERE id = ? AND location_id = ?",
                arguments: [id, locationId]
            ) else {
                throw DiningTableWriteError.notFound
            }

            var sets: [String] = []
            var args: [DatabaseValueConvertible?] = []
            var nextStatus = row.status

            if let s = patch.status, s != row.status {
                sets.append("status = ?"); args.append(s); nextStatus = s
            }
            if let v = clip(patch.name, max: 100), v != row.name {
                sets.append("name = ?"); args.append(v)
            }
            if let n = patch.capacity, n != row.capacity {
                sets.append("capacity = ?"); args.append(n)
            }
            if let n = patch.x, n != row.x { sets.append("x = ?"); args.append(n) }
            if let n = patch.y, n != row.y { sets.append("y = ?"); args.append(n) }
            if let n = patch.w, n != row.w { sets.append("w = ?"); args.append(n) }
            if let n = patch.h, n != row.h { sets.append("h = ?"); args.append(n) }
            if let notesField = patch.notes {
                // Present: explicit nil clears, string is clipped to 500.
                let v = notesField.flatMap { clip($0, max: 500) }
                if v != row.notes { sets.append("notes = ?"); args.append(v) }
            }

            guard !sets.isEmpty else { throw DiningTableWriteError.noChange }

            sets.append("updated_at = datetime('now')")
            args.append(id)
            args.append(locationId)
            try db.execute(
                sql: "UPDATE dining_tables SET \(sets.joined(separator: ", ")) WHERE id = ? AND location_id = ?",
                arguments: StatementArguments(args)
            )

            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "dining_tables",
                    entityId: 0,
                    action: .update,
                    actorCookId: context.actorCookId ?? cookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(
                        DiningTableStatusChangePayload(id: id, fromStatus: row.status, toStatus: nextStatus)
                    ),
                    locationId: locationId
                )
            )
        }
    }

    /// DELETE /api/dining-tables/:id.
    public func delete(id rawId: String, context: RegulatedWriteContext) throws {
        guard let id = clip(rawId, max: 32) else { throw DiningTableWriteError.notFound }
        let locationId = context.locationId

        try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: "DELETE FROM dining_tables WHERE id = ? AND location_id = ?",
                arguments: [id, locationId]
            )
            guard db.changesCount > 0 else { throw DiningTableWriteError.notFound }
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "dining_tables",
                    entityId: 0,
                    action: .delete,
                    actorCookId: context.actorCookId,
                    actorSource: context.actorSource,
                    payload: ["id": id],
                    locationId: locationId
                )
            )
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private func clip(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }

    /// Web `numOrDefault`: absent/non-finite → default.
    private func numOrDefault(_ v: Double?, _ def: Double) -> Double {
        guard let v, v.isFinite else { return def }
        return v
    }

    private func isPrimaryKeyConflict(_ error: DatabaseError) -> Bool {
        guard error.resultCode == .SQLITE_CONSTRAINT else { return false }
        if error.extendedResultCode == .SQLITE_CONSTRAINT_PRIMARYKEY { return true }
        let msg = error.message ?? ""
        return msg.contains("UNIQUE constraint failed") || msg.contains("PRIMARY KEY")
    }
}

/// Insert audit payload — keeps `capacity` numeric in payload_json (web
/// posts `{ id, name, capacity, status }` with a number).
private struct DiningTableInsertPayload: Encodable {
    let id: String
    let name: String
    let capacity: Int
    let status: String
}

/// Update audit payload — web posts `{ id, from_status, to_status }`.
struct DiningTableStatusChangePayload: Encodable {
    let id: String
    let fromStatus: String
    let toStatus: String
    /// Only present on reservation-triggered table mutations
    /// (`reservation_seat` / `reservation_complete` / `reservation_cancel`).
    var triggeredBy: String?
}
