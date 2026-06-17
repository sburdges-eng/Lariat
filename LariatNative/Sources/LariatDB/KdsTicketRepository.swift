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
            let open = tickets.map { t in
                KdsOpenTicket(
                    id: t.id,
                    orderNumber: t.orderNumber,
                    placedAt: t.placedAt,
                    destination: t.destination,
                    lines: linesByTicket[t.id] ?? []
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
