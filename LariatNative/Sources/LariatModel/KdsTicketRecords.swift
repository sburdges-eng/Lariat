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
    case ticketIdRequired
    case bumpTicketNotFound

    public var errorDescription: String? {
        switch self {
        case .orderNumberRequired: return "Order number required"
        case .linesRequired: return "At least one line is required"
        case .lineItemRequired(let i): return "Line \(i + 1): item name required"
        case .lineQuantityInvalid(let i): return "Line \(i + 1): quantity must be at least 1"
        case .lineStationRequired(let i): return "Line \(i + 1): station required"
        case .placedAtInvalid: return "Placed time must be a valid ISO timestamp"
        case .validationFailed(let msg): return msg
        case .ticketIdRequired: return "Ticket id is required"
        case .bumpTicketNotFound: return "Ticket not found"
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
    /// Latest bump-back time from `kds_ticket_states` (nil = never bumped).
    /// The ticket itself stays on the open board either way — web parity keeps
    /// `kds_tickets.bumped_at` NULL; only the state row records the bump.
    public let bumpedAt: String?

    public var identifier: String { id }

    public init(
        id: String,
        orderNumber: String,
        placedAt: String,
        destination: String?,
        lines: [KdsOpenTicketLine],
        bumpedAt: String? = nil
    ) {
        self.id = id
        self.orderNumber = orderNumber
        self.placedAt = placedAt
        self.destination = destination
        self.lines = lines
        self.bumpedAt = bumpedAt
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

/// Bump-back input — mirrors the optional `BumpPayload` fields in `lib/kds.ts`.
/// Swift `nil` == web absent/null; the repository validates present values.
public struct KdsBumpInput: Sendable {
    public let bumpedAt: String?
    public let station: String?
    public let cookPin: String?

    public init(bumpedAt: String? = nil, station: String? = nil, cookPin: String? = nil) {
        self.bumpedAt = bumpedAt
        self.station = station
        self.cookPin = cookPin
    }
}

/// Canonical bump response shape — parity with `BumpResponse` in `lib/kds.ts`.
public struct KdsBumpResult: Sendable, Equatable {
    public let id: String
    public let bumpedAt: String

    public init(id: String, bumpedAt: String) {
        self.id = id
        self.bumpedAt = bumpedAt
    }
}
