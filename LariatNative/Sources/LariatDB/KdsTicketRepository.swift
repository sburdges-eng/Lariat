import Foundation
import GRDB
import LariatModel

public struct KdsTicketRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let auditLogger: ManagementAuditLogger

    public init(
        readDB: LariatDatabase,
        writeDB: LariatWriteDatabase,
        auditLogger: ManagementAuditLogger? = nil
    ) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.auditLogger = auditLogger ?? ManagementAuditLogger(auditPath: resolveManagementAuditPath())
    }

    public func loadOpen(locationId: String = LocationScope.resolve()) async throws -> KdsBoardSnapshot {
        try await readDB.pool.read { db in
            let tickets = try KdsTicketRow.fetchAll(
                db,
                sql: """
                  SELECT id, location_id, order_number, placed_at, destination, bumped_at, created_by_cook_id, created_at
                    FROM kds_tickets
                   WHERE location_id = ? AND bumped_at IS NULL
                   ORDER BY placed_at ASC, id ASC
                  """,
                arguments: [locationId]
            )
            guard !tickets.isEmpty else {
                return KdsBoardSnapshot(locationId: locationId, tickets: [])
            }
            let ids = tickets.map(\.id)
            let placeholders = Array(repeating: "?", count: ids.count).joined(separator: ",")
            let lines = try KdsTicketLineRow.fetchAll(
                db,
                sql: """
                  SELECT id, ticket_id, sort_order, item_name, quantity, station, modifiers
                    FROM kds_ticket_lines
                   WHERE ticket_id IN (\(placeholders))
                   ORDER BY ticket_id, sort_order, id
                  """,
                arguments: StatementArguments(ids)
            )
            var linesByTicket: [String: [KdsOpenTicketLine]] = [:]
            for line in lines {
                var arr = linesByTicket[line.ticketId] ?? []
                arr.append(KdsOpenTicketLine(
                    id: line.id,
                    itemName: line.itemName,
                    quantity: line.quantity,
                    station: line.station,
                    modifiers: line.modifiers
                ))
                linesByTicket[line.ticketId] = arr
            }
            // Bump-back state (kds_ticket_states) — the ticket stays on the
            // open board after a bump (web parity: kds_tickets.bumped_at is
            // never set), so surface the state row's bumped_at for display.
            let stateRows = try Row.fetchAll(
                db,
                sql: """
                  SELECT ticket_id, bumped_at
                    FROM kds_ticket_states
                   WHERE location_id = ? AND ticket_id IN (\(placeholders))
                  """,
                arguments: StatementArguments([locationId]) + StatementArguments(ids)
            )
            var bumpedByTicket: [String: String] = [:]
            for row in stateRows {
                if let tid: String = row["ticket_id"], let at: String = row["bumped_at"] {
                    bumpedByTicket[tid] = at
                }
            }
            let open = tickets.map { t in
                KdsOpenTicket(
                    id: t.id,
                    orderNumber: t.orderNumber,
                    placedAt: t.placedAt,
                    destination: t.destination,
                    lines: linesByTicket[t.id] ?? [],
                    bumpedAt: bumpedByTicket[t.id]
                )
            }
            return KdsBoardSnapshot(locationId: locationId, tickets: open)
        }
    }

    @discardableResult
    public func punch(input: KdsPunchInput, context: RegulatedWriteContext) throws -> KdsOpenTicket {
        let validated = try validatePunch(input)

        let locationId = context.locationId
        let cookId = clip(input.cookId, max: 64) ?? context.actorCookId
        let ticketId = UuidV7.generate()

        let ticket = try writeDB.write { db in
            try db.execute(
                sql: """
                  INSERT INTO kds_tickets
                    (id, location_id, order_number, placed_at, destination, created_by_cook_id)
                  VALUES (?, ?, ?, ?, ?, ?)
                  """,
                arguments: [
                    ticketId,
                    locationId,
                    validated.orderNumber,
                    validated.placedAt,
                    validated.destination,
                    cookId,
                ]
            )

            var outLines: [KdsOpenTicketLine] = []
            for (i, line) in validated.lines.enumerated() {
                let lineId = UuidV7.generate()
                try db.execute(
                    sql: """
                      INSERT INTO kds_ticket_lines
                        (id, ticket_id, sort_order, item_name, quantity, station, modifiers)
                      VALUES (?, ?, ?, ?, ?, ?, ?)
                      """,
                    arguments: [
                        lineId,
                        ticketId,
                        i,
                        line.itemName,
                        line.quantity,
                        line.station,
                        line.modifiers,
                    ]
                )
                outLines.append(KdsOpenTicketLine(
                    id: lineId,
                    itemName: line.itemName,
                    quantity: line.quantity,
                    station: line.station,
                    modifiers: line.modifiers
                ))
            }

            try auditLogger.logKdsTicketCreate(
                ticketId: ticketId,
                locationId: locationId,
                orderNumber: validated.orderNumber,
                destination: validated.destination,
                lineCount: validated.lines.count,
                cookId: cookId
            )

            return KdsOpenTicket(
                id: ticketId,
                orderNumber: validated.orderNumber,
                placedAt: validated.placedAt,
                destination: validated.destination,
                lines: outLines
            )
        }

        return ticket
    }

    /// Bump-back — port of `app/api/kds/tickets/[id]/bump/route.js`.
    ///
    /// 404s an unknown ticket (scoped by location), upserts `kds_ticket_states`
    /// with kept-latest semantics, and emits an `insert`/`correction` audit to
    /// the `audit_events` table (mirrors web `postAuditEvent`) INSIDE the write
    /// transaction, so an audit failure rolls back the upsert.
    ///
    /// Latent web behavior carried forward: this NEVER sets `kds_tickets.bumped_at`,
    /// so a bumped ticket stays on the open board (see `loadOpen`'s
    /// `WHERE bumped_at IS NULL`). That reconciliation is a product decision.
    @discardableResult
    public func bump(ticketId rawTicketId: String, input: KdsBumpInput, context: RegulatedWriteContext) throws -> KdsBumpResult {
        // Web `parseTicketId` (route.js) REJECTS an over-length id (400) — it does
        // not truncate. Mirror that: trim, then reject empty or > 200 chars rather
        // than clip-truncating (which could otherwise look up a truncated id).
        let trimmedId = rawTicketId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedId.isEmpty, trimmedId.count <= 200 else { throw KdsWriteError.ticketIdRequired }
        let ticketId = trimmedId

        let validated: (bumpedAt: String?, station: String?, cookPin: String?)
        switch KdsBumpRules.validateBumpPayload(bumpedAt: input.bumpedAt, station: input.station, cookPin: input.cookPin) {
        case .invalid(let reason): throw KdsWriteError.validationFailed(reason)
        case .ok(let b, let s, let p): validated = (b, s, p)
        }

        let locationId = context.locationId
        let bumpedAt = validated.bumpedAt ?? KdsBumpRules.nowIsoCanonical()
        let station = validated.station
        let pinHash = validated.cookPin.map { KdsBumpRules.hashPin($0) }

        return try writeDB.write { db in
            // 404 — ticket must be known to Lariat, scoped by location.
            let known = try Int.fetchOne(
                db,
                sql: "SELECT 1 FROM kds_tickets WHERE id = ? AND location_id = ?",
                arguments: [ticketId, locationId]
            )
            guard known != nil else { throw KdsWriteError.bumpTicketNotFound }

            // Existing state → insert vs correction; capture prior bumped_at for the trail.
            let priorBumpedAt = try String.fetchOne(
                db,
                sql: "SELECT bumped_at FROM kds_ticket_states WHERE ticket_id = ? AND location_id = ?",
                arguments: [ticketId, locationId]
            )
            let action = KdsBumpRules.bumpActionForExisting(hasExisting: priorBumpedAt != nil)

            // INSERT…ON CONFLICT kept-latest (created_at preserved on conflict).
            try db.execute(
                sql: """
                  INSERT INTO kds_ticket_states
                    (ticket_id, location_id, bumped_at, bumped_station, bumped_pin_hash)
                  VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT (ticket_id, location_id) DO UPDATE SET
                    bumped_at       = excluded.bumped_at,
                    bumped_station  = excluded.bumped_station,
                    bumped_pin_hash = excluded.bumped_pin_hash,
                    updated_at      = datetime('now')
                  """,
                arguments: [ticketId, locationId, bumpedAt, station, pinHash]
            )

            // rowid is 0 on the pure-UPDATE path — resolve it for the audit entity id.
            var entityRowid = db.lastInsertedRowID
            if entityRowid == 0 {
                entityRowid = try Int64.fetchOne(
                    db,
                    sql: "SELECT rowid FROM kds_ticket_states WHERE ticket_id = ? AND location_id = ?",
                    arguments: [ticketId, locationId]
                ) ?? 0
            }

            // DB audit (mirrors web postAuditEvent) — inside the tx; failure rolls back.
            var payload: [String: String] = ["ticket_id": ticketId, "bumped_at": bumpedAt]
            if let station { payload["station"] = station }
            if let priorBumpedAt { payload["prior_bumped_at"] = priorBumpedAt }
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "kds_ticket_state",
                    entityId: entityRowid == 0 ? nil : entityRowid,
                    action: action == .insert ? .insert : .correction,
                    actorCookId: nil,
                    actorSource: "kds_app",
                    payload: payload,
                    shiftDate: nil,
                    locationId: locationId
                )
            )

            return KdsBumpResult(id: ticketId, bumpedAt: bumpedAt)
        }
    }

    private struct ValidatedPunch: Sendable {
        let orderNumber: String
        let destination: String?
        let placedAt: String
        let lines: [(itemName: String, quantity: Int, station: String, modifiers: String?)]
    }

    private func validatePunch(_ input: KdsPunchInput) throws -> ValidatedPunch {
        guard let orderNumber = clip(input.orderNumber, max: 32) else {
            throw KdsWriteError.orderNumberRequired
        }
        let destination = clip(input.destination, max: 64)
        guard !input.lines.isEmpty else { throw KdsWriteError.linesRequired }

        var validatedLines: [(itemName: String, quantity: Int, station: String, modifiers: String?)] = []
        for (i, raw) in input.lines.enumerated() {
            guard let itemName = clip(raw.itemName, max: 200) else {
                throw KdsWriteError.lineItemRequired(i)
            }
            guard raw.quantity >= 1 else {
                throw KdsWriteError.lineQuantityInvalid(i)
            }
            guard let stationRaw = clip(raw.station, max: 32) else {
                throw KdsWriteError.lineStationRequired(i)
            }
            let station = stationRaw.lowercased()
            let modifiers: String? = {
                guard let m = raw.modifiers else { return nil }
                let t = m.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !t.isEmpty else { return nil }
                return String(t.prefix(500))
            }()
            validatedLines.append((itemName, raw.quantity, station, modifiers))
        }

        let placedAt: String
        if let raw = clip(input.placedAt, max: 40) {
            guard let ms = ISO8601DateFormatter().date(from: raw)?.timeIntervalSince1970
                    ?? DateFormatter.kdsPlacedAt.date(from: raw)?.timeIntervalSince1970 else {
                throw KdsWriteError.placedAtInvalid
            }
            placedAt = ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: ms))
        } else {
            placedAt = ISO8601DateFormatter().string(from: Date())
        }

        return ValidatedPunch(
            orderNumber: orderNumber,
            destination: destination,
            placedAt: placedAt,
            lines: validatedLines
        )
    }

    private func clip(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }
}

private extension DateFormatter {
    static let kdsPlacedAt: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
        f.timeZone = TimeZone(secondsFromGMT: 0)
        return f
    }()
}
