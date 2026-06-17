import Foundation
import GRDB

/// Mirrors `lib/kds.ts` KNOWN_STATIONS.
public let KDS_KNOWN_STATIONS: [String] = ["grill", "sides", "bar"]

public enum KdsWriteError: Error, LocalizedError, Equatable {
    case orderNumberRequired
    case linesRequired
    case lineItemRequired(Int)
    case lineQuantityInvalid(Int)
    case lineStationRequired(Int)
    case placedAtInvalid
    case validationFailed(String)

    public var errorDescription: String? {
        switch self {
        case .orderNumberRequired: return "Order number required"
        case .linesRequired: return "At least one line is required"
        case .lineItemRequired(let i): return "Line \(i + 1): item name required"
        case .lineQuantityInvalid(let i): return "Line \(i + 1): quantity must be at least 1"
        case .lineStationRequired(let i): return "Line \(i + 1): station required"
        case .placedAtInvalid: return "Placed time must be a valid ISO timestamp"
        case .validationFailed(let msg): return msg
        }
    }
}

public struct KdsTicketRow: Codable, FetchableRecord, Sendable, Identifiable {
    public let id: String
    public let locationId: String
    public let orderNumber: String
    public let placedAt: String
    public let destination: String?
    public let bumpedAt: String?
    public let createdByCookId: String?
    public let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case locationId = "location_id"
        case orderNumber = "order_number"
        case placedAt = "placed_at"
        case destination
        case bumpedAt = "bumped_at"
        case createdByCookId = "created_by_cook_id"
        case createdAt = "created_at"
    }
}

public struct KdsTicketLineRow: Codable, FetchableRecord, Sendable, Identifiable {
    public let id: String
    public let ticketId: String
    public let sortOrder: Int
    public let itemName: String
    public let quantity: Int
    public let station: String
    public let modifiers: String?

    enum CodingKeys: String, CodingKey {
        case id
        case ticketId = "ticket_id"
        case sortOrder = "sort_order"
        case itemName = "item_name"
        case quantity, station, modifiers
    }
}

public struct KdsPunchLineInput: Sendable {
    public let itemName: String
    public let quantity: Int
    public let station: String
    public let modifiers: String?

    public init(itemName: String, quantity: Int, station: String, modifiers: String? = nil) {
        self.itemName = itemName
        self.quantity = quantity
        self.station = station
        self.modifiers = modifiers
    }
}

public struct KdsPunchInput: Sendable {
    public let orderNumber: String
    public let destination: String?
    public let placedAt: String?
    public let lines: [KdsPunchLineInput]
    public let cookId: String?

    public init(
        orderNumber: String,
        destination: String? = nil,
        placedAt: String? = nil,
        lines: [KdsPunchLineInput],
        cookId: String? = nil
    ) {
        self.orderNumber = orderNumber
        self.destination = destination
        self.placedAt = placedAt
        self.lines = lines
        self.cookId = cookId
    }
}

public struct KdsOpenTicketLine: Sendable, Identifiable {
    public let id: String
    public let itemName: String
    public let quantity: Int
    public let station: String
    public let modifiers: String?

    public var identifier: String { id }

    public init(id: String, itemName: String, quantity: Int, station: String, modifiers: String?) {
        self.id = id
        self.itemName = itemName
        self.quantity = quantity
        self.station = station
        self.modifiers = modifiers
    }
}

public struct KdsOpenTicket: Sendable, Identifiable {
    public let id: String
    public let orderNumber: String
    public let placedAt: String
    public let destination: String?
    public let lines: [KdsOpenTicketLine]

    public var identifier: String { id }

    public init(id: String, orderNumber: String, placedAt: String, destination: String?, lines: [KdsOpenTicketLine]) {
        self.id = id
        self.orderNumber = orderNumber
        self.placedAt = placedAt
        self.destination = destination
        self.lines = lines
    }
}

public struct KdsBoardSnapshot: Sendable {
    public let locationId: String
    public let tickets: [KdsOpenTicket]

    public init(locationId: String, tickets: [KdsOpenTicket]) {
        self.locationId = locationId
        self.tickets = tickets
    }
}
