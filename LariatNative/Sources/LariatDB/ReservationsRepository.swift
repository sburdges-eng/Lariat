import Foundation
import GRDB
import LariatModel

/// Reservations-book repository — parity with `app/api/reservations/route.js`
/// (GET/POST), `app/api/reservations/[id]/route.js` (PATCH/DELETE), and the
/// /reservations page queries (`app/reservations/page.jsx`).
///
/// Every regulated write posts its `audit_events` row inside the SAME
/// transaction as the source mutation. The PATCH verbs mirror reservation
/// state onto the linked `dining_tables` row in that same transaction
/// (seat → seated; complete → dirty; cancel → open only if previously
/// seated; no_show → no touch; stale table_id skipped silently).
public struct ReservationsRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    private static let dateRE = #/^\d{4}-\d{2}-\d{2}$/#

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    // ── reads ────────────────────────────────────────────────────────────

    private static let projection = """
        SELECT id, party_name, party_size, reservation_at, status, table_id,
               phone, email, notes, source, source_ref,
               seated_at, completed_at, cook_id, created_at, updated_at
          FROM reservations
        """

    /// GET /api/reservations — chronological; `date` (prefix match) wins
    /// over `from`/`to`; malformed dates ignored; LIMIT 500.
    public func list(
        filter: ReservationListFilter = ReservationListFilter(),
        locationId: String = LocationScope.resolve()
    ) async throws -> [ReservationRow] {
        var wheres = ["location_id = ?"]
        var args: [DatabaseValueConvertible] = [locationId]

        if let date = filter.date, date.wholeMatch(of: Self.dateRE) != nil {
            wheres.append("reservation_at LIKE ?")
            args.append("\(date)%")
        } else if let from = filter.from, let to = filter.to,
                  from.wholeMatch(of: Self.dateRE) != nil, to.wholeMatch(of: Self.dateRE) != nil {
            wheres.append("reservation_at >= ?")
            wheres.append("reservation_at <= ?")
            args.append(from)
            // Include the entire `to` day by extending past 23:59 (web parity).
            args.append("\(to) 99:99")
        }

        if let status = filter.status?.trimmingCharacters(in: .whitespaces), !status.isEmpty {
            wheres.append("status = ?")
            args.append(status)
        }

        let sql = """
            \(Self.projection)
             WHERE \(wheres.joined(separator: " AND "))
             ORDER BY reservation_at ASC, id ASC
             LIMIT 500
            """
        return try await readDB.pool.read { db in
            try ReservationRow.fetchAll(db, sql: sql, arguments: StatementArguments(args))
        }
    }

    /// Page 'today' view — `reservation_at LIKE '<date>%'`, no limit.
    public func today(
        date: String = ShiftDate.todayISO(),
        locationId: String = LocationScope.resolve()
    ) async throws -> [ReservationRow] {
        try await readDB.pool.read { db in
            try ReservationRow.fetchAll(
                db,
                sql: """
                  \(Self.projection)
                   WHERE location_id = ?
                     AND reservation_at LIKE ?
                   ORDER BY reservation_at ASC, id ASC
                  """,
                arguments: [locationId, "\(date)%"]
            )
        }
    }

    /// Page 'upcoming' view — open reservations from `date` on, LIMIT 100.
    public func upcoming(
        from date: String = ShiftDate.todayISO(),
        locationId: String = LocationScope.resolve()
    ) async throws -> [ReservationRow] {
        try await readDB.pool.read { db in
            try ReservationRow.fetchAll(
                db,
                sql: """
                  \(Self.projection)
                   WHERE location_id = ?
                     AND reservation_at >= ?
                     AND status NOT IN ('cancelled','completed','no_show')
                   ORDER BY reservation_at ASC, id ASC
                   LIMIT 100
                  """,
                arguments: [locationId, date]
            )
        }
    }

    // ── writes ───────────────────────────────────────────────────────────

    /// POST /api/reservations. Returns the new row id.
    @discardableResult
    public func create(input: ReservationCreateInput, context: RegulatedWriteContext) throws -> Int64 {
        guard let partyName = clip(input.partyName, max: 200) else {
            throw ReservationWriteError.partyNameRequired
        }
        guard let partySize = input.partySize, (1...50).contains(partySize) else {
            throw ReservationWriteError.partySizeOutOfRange
        }
        guard let reservationAt = clip(input.reservationAt, max: 64) else {
            throw ReservationWriteError.reservationAtRequired
        }

        let locationId = context.locationId
        let cookId = clip(input.cookId, max: 64)

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: """
                  INSERT INTO reservations
                    (party_name, party_size, reservation_at, table_id, phone, email,
                     notes, source, source_ref, cook_id, location_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  """,
                arguments: [
                    partyName,
                    partySize,
                    reservationAt,
                    clip(input.tableId, max: 64),
                    clip(input.phone, max: 64),
                    clip(input.email, max: 200),
                    clip(input.notes, max: 1000),
                    clip(input.source, max: 32) ?? "manual",
                    clip(input.sourceRef, max: 200),
                    cookId,
                    locationId,
                ]
            )
            let id = db.lastInsertedRowID
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "reservations",
                    entityId: id,
                    action: .insert,
                    actorCookId: context.actorCookId ?? cookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(
                        ReservationInsertPayload(
                            partyName: partyName, partySize: partySize, reservationAt: reservationAt
                        )
                    ),
                    locationId: locationId
                )
            )
            return id
        }
    }

    /// PATCH /api/reservations/:id — one optional verb + field edits, with
    /// the dining_tables mirror in the same transaction.
    public func update(id: Int64, patch: ReservationPatch, context: RegulatedWriteContext) throws {
        let activeVerbs = patch.activeVerbs
        guard activeVerbs.count <= 1 else { throw ReservationWriteError.multipleVerbs }
        let verb = activeVerbs.first

        let locationId = context.locationId
        let cookId = clip(patch.cookId, max: 64)

        try AuditedWriteRunner.perform(db: writeDB) { db in
            guard let row = try ReservationRow.fetchOne(
                db,
                sql: "SELECT * FROM reservations WHERE id = ? AND location_id = ?",
                arguments: [id, locationId]
            ) else {
                throw ReservationWriteError.notFound
            }

            var sets: [String] = []
            var args: [DatabaseValueConvertible?] = []
            var nextStatus = row.status

            switch verb {
            case .seat:
                nextStatus = "seated"
                sets.append("status = ?"); args.append(nextStatus)
                sets.append("seated_at = datetime('now')")
                if let tableField = patch.tableId {
                    let tid = tableField.flatMap { clip($0, max: 64) }
                    sets.append("table_id = ?"); args.append(tid)
                }
            case .complete:
                nextStatus = "completed"
                sets.append("status = ?"); args.append(nextStatus)
                sets.append("completed_at = datetime('now')")
            case .cancel:
                nextStatus = "cancelled"
                sets.append("status = ?"); args.append(nextStatus)
                sets.append("completed_at = datetime('now')")
            case .noShow:
                nextStatus = "no_show"
                sets.append("status = ?"); args.append(nextStatus)
                sets.append("completed_at = datetime('now')")
            case nil:
                break
            }

            // Field edits — only when present. table_id under `seat` was
            // already handled above.
            if let v = clip(patch.partyName, max: 200), v != row.partyName {
                sets.append("party_name = ?"); args.append(v)
            }
            if let n = patch.partySize, (1...50).contains(n), n != row.partySize {
                sets.append("party_size = ?"); args.append(n)
            }
            if let v = clip(patch.reservationAt, max: 64), v != row.reservationAt {
                sets.append("reservation_at = ?"); args.append(v)
            }
            if let tableField = patch.tableId, verb != .seat {
                let v = tableField.flatMap { clip($0, max: 64) }
                if v != row.tableId { sets.append("table_id = ?"); args.append(v) }
            }
            if let phoneField = patch.phone {
                let v = phoneField.flatMap { clip($0, max: 64) }
                if v != row.phone { sets.append("phone = ?"); args.append(v) }
            }
            if let emailField = patch.email {
                let v = emailField.flatMap { clip($0, max: 200) }
                if v != row.email { sets.append("email = ?"); args.append(v) }
            }
            if let notesField = patch.notes {
                let v = notesField.flatMap { clip($0, max: 1000) }
                if v != row.notes { sets.append("notes = ?"); args.append(v) }
            }

            guard !sets.isEmpty else { throw ReservationWriteError.noChange }

            sets.append("updated_at = datetime('now')")
            args.append(id)
            try db.execute(
                sql: "UPDATE reservations SET \(sets.joined(separator: ", ")) WHERE id = ?",
                arguments: StatementArguments(args)
            )

            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "reservations",
                    entityId: id,
                    action: .update,
                    actorCookId: context.actorCookId ?? cookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(
                        ReservationUpdatePayload(
                            fromStatus: row.status, toStatus: nextStatus, verb: verb?.rawValue
                        )
                    ),
                    locationId: locationId
                )
            )

            // Mirror reservation state onto the linked dining_tables row —
            // SAME transaction, so the two updates are atomic (web parity).
            func touchTable(_ tableId: String?, toStatus: String, triggeredBy: String) throws {
                guard let tableId, !tableId.isEmpty else { return }
                guard let tRow = try Row.fetchOne(
                    db,
                    sql: "SELECT id, status FROM dining_tables WHERE id = ? AND location_id = ?",
                    arguments: [tableId, locationId]
                ) else {
                    return // stale table_id — skip silently
                }
                let fromStatus: String = tRow["status"]
                try db.execute(
                    sql: """
                      UPDATE dining_tables
                         SET status = ?, updated_at = datetime('now')
                       WHERE id = ? AND location_id = ?
                      """,
                    arguments: [toStatus, tableId, locationId]
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
                            DiningTableStatusChangePayload(
                                id: tableId, fromStatus: fromStatus, toStatus: toStatus,
                                triggeredBy: triggeredBy
                            )
                        ),
                        locationId: locationId
                    )
                )
            }

            switch verb {
            case .seat:
                let newTableId: String?
                if let tableField = patch.tableId {
                    newTableId = tableField.flatMap { clip($0, max: 64) }
                } else {
                    newTableId = row.tableId
                }
                try touchTable(newTableId, toStatus: "seated", triggeredBy: "reservation_seat")
            case .complete:
                try touchTable(row.tableId, toStatus: "dirty", triggeredBy: "reservation_complete")
            case .cancel:
                if row.status == "seated" {
                    try touchTable(row.tableId, toStatus: "open", triggeredBy: "reservation_cancel")
                }
            case .noShow, nil:
                break // no table change
            }
        }
    }

    /// DELETE /api/reservations/:id.
    public func delete(id: Int64, context: RegulatedWriteContext) throws {
        let locationId = context.locationId
        try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: "DELETE FROM reservations WHERE id = ? AND location_id = ?",
                arguments: [id, locationId]
            )
            guard db.changesCount > 0 else { throw ReservationWriteError.notFound }
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "reservations",
                    entityId: id,
                    action: .delete,
                    actorCookId: context.actorCookId,
                    actorSource: context.actorSource,
                    payloadJSON: "{}",
                    locationId: locationId
                )
            )
        }
    }

    private func clip(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }
}

/// Insert audit payload — web posts `{ party_name, party_size, reservation_at }`
/// with a numeric party_size.
private struct ReservationInsertPayload: Encodable {
    let partyName: String
    let partySize: Int
    let reservationAt: String
}

/// Update audit payload — web posts `{ from_status, to_status, verb? }`.
private struct ReservationUpdatePayload: Encodable {
    let fromStatus: String
    let toStatus: String
    let verb: String?
}
