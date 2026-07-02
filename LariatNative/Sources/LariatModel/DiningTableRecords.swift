import Foundation
import GRDB

/// Canonical dining-table states — parity with `STATUSES` in
/// `app/api/dining-tables/route.js` (and the schema CHECK constraint).
public enum DiningTableStatuses {
    public static let all: [String] = ["open", "seated", "dirty", "closed"]
}

/// Typed write failures for the floor board. Mirrors the web route's
/// status-code semantics: 400 (validation / no change), 404 (not at this
/// location), 409 (duplicate `(location_id, id)`).
public enum DiningTableWriteError: Error, LocalizedError, Equatable {
    case idRequired            // 400 'id required'
    case nameRequired          // 400 'name required'
    case capacityOutOfRange    // 400 'capacity must be 1..50'
    case badStatus             // 400 'bad status'
    case idAlreadyInUse        // 409 'id already in use'
    case notFound              // 404 'not found'
    case noChange              // 400 'no change'

    public var errorDescription: String? {
        switch self {
        case .idRequired: return "Table id required"
        case .nameRequired: return "Table name required"
        case .capacityOutOfRange: return "Capacity must be 1..50"
        case .badStatus: return "Bad table status"
        case .idAlreadyInUse: return "Table id already in use"
        case .notFound: return "Table not found"
        case .noChange: return "Nothing would change"
        }
    }
}

/// One `dining_tables` row — parity with the GET projection in
/// `app/api/dining-tables/route.js`.
public struct DiningTableRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: String
    public let name: String
    public let capacity: Int
    public let x: Double
    public let y: Double
    public let w: Double
    public let h: Double
    public let status: String
    public let notes: String?
    public let locationId: String
    public let createdAt: String?
    public let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, name, capacity, x, y, w, h, status, notes
        case locationId = "location_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

/// Today's open (booked, not yet seated) reservation as loaded by the floor
/// page for the seat-a-reservation panel (`app/floor/page.jsx`).
public struct FloorReservationRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let partyName: String
    public let partySize: Int
    public let reservationAt: String
    public let status: String
    public let tableId: String?
    public let phone: String?
    public let notes: String?

    enum CodingKeys: String, CodingKey {
        case id, status, phone, notes
        case partyName = "party_name"
        case partySize = "party_size"
        case reservationAt = "reservation_at"
        case tableId = "table_id"
    }
}

/// POST /api/dining-tables body. Optionals mirror absent JSON fields —
/// the repository applies the web defaults (capacity 2, status 'open',
/// x/y 0, w/h 1).
public struct DiningTableCreateInput: Sendable {
    public let id: String?
    public let name: String?
    public let capacity: Int?
    public let x: Double?
    public let y: Double?
    public let w: Double?
    public let h: Double?
    public let status: String?
    public let notes: String?
    public let cookId: String?

    public init(
        id: String?,
        name: String?,
        capacity: Int? = nil,
        x: Double? = nil,
        y: Double? = nil,
        w: Double? = nil,
        h: Double? = nil,
        status: String? = nil,
        notes: String? = nil,
        cookId: String? = nil
    ) {
        self.id = id
        self.name = name
        self.capacity = capacity
        self.x = x
        self.y = y
        self.w = w
        self.h = h
        self.status = status
        self.notes = notes
        self.cookId = cookId
    }
}

/// PATCH /api/dining-tables/:id body. `nil` == field absent (web
/// `undefined`, skipped). `notes` is double-optional because the web route
/// distinguishes absent (skip) from explicit null (clear the notes).
public struct DiningTablePatch: Sendable {
    public var status: String?
    public var name: String?
    public var capacity: Int?
    public var x: Double?
    public var y: Double?
    public var w: Double?
    public var h: Double?
    public var notes: String??
    public var cookId: String?

    public init(
        status: String? = nil,
        name: String? = nil,
        capacity: Int? = nil,
        x: Double? = nil,
        y: Double? = nil,
        w: Double? = nil,
        h: Double? = nil,
        notes: String?? = nil,
        cookId: String? = nil
    ) {
        self.status = status
        self.name = name
        self.capacity = capacity
        self.x = x
        self.y = y
        self.w = w
        self.h = h
        self.notes = notes
        self.cookId = cookId
    }
}
