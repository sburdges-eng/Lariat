import Foundation
import GRDB

/// Reservation statuses — the schema CHECK constraint's five values.
public enum ReservationStatuses {
    public static let all: [String] = ["booked", "seated", "completed", "cancelled", "no_show"]
}

/// PATCH verbs — parity with `VERBS` in `app/api/reservations/[id]/route.js`.
/// Mutually exclusive; the raw value is what the audit payload records.
public enum ReservationVerb: String, Sendable, CaseIterable {
    case seat
    case complete
    case cancel
    case noShow = "no_show"
}

/// Typed write failures. Mirrors the web routes' status-code semantics:
/// 400 (validation / no change / multiple verbs) and 404 (not at location).
public enum ReservationWriteError: Error, LocalizedError, Equatable {
    case partyNameRequired       // 400 'party_name required'
    case partySizeOutOfRange     // 400 'party_size must be 1..50'
    case reservationAtRequired   // 400 'reservation_at required'
    case multipleVerbs           // 400 'multiple verbs'
    case notFound                // 404 'not found'
    case noChange                // 400 'no change'

    public var errorDescription: String? {
        switch self {
        case .partyNameRequired: return "Party name required"
        case .partySizeOutOfRange: return "Party size must be 1..50"
        case .reservationAtRequired: return "Reservation time required"
        case .multipleVerbs: return "Multiple verbs in one update"
        case .notFound: return "Reservation not found"
        case .noChange: return "Nothing would change"
        }
    }
}

/// One `reservations` row — the full projection used by both the API GET
/// and the /reservations page queries.
public struct ReservationRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let partyName: String
    public let partySize: Int
    public let reservationAt: String
    public let status: String
    public let tableId: String?
    public let phone: String?
    public let email: String?
    public let notes: String?
    public let source: String?
    public let sourceRef: String?
    public let seatedAt: String?
    public let completedAt: String?
    public let cookId: String?
    public let createdAt: String?
    public let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, status, phone, email, notes, source
        case partyName = "party_name"
        case partySize = "party_size"
        case reservationAt = "reservation_at"
        case tableId = "table_id"
        case sourceRef = "source_ref"
        case seatedAt = "seated_at"
        case completedAt = "completed_at"
        case cookId = "cook_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

/// POST /api/reservations body.
public struct ReservationCreateInput: Sendable {
    public let partyName: String?
    public let partySize: Int?
    public let reservationAt: String?
    public let tableId: String?
    public let phone: String?
    public let email: String?
    public let notes: String?
    public let source: String?
    public let sourceRef: String?
    public let cookId: String?

    public init(
        partyName: String?,
        partySize: Int?,
        reservationAt: String?,
        tableId: String? = nil,
        phone: String? = nil,
        email: String? = nil,
        notes: String? = nil,
        source: String? = nil,
        sourceRef: String? = nil,
        cookId: String? = nil
    ) {
        self.partyName = partyName
        self.partySize = partySize
        self.reservationAt = reservationAt
        self.tableId = tableId
        self.phone = phone
        self.email = email
        self.notes = notes
        self.source = source
        self.sourceRef = sourceRef
        self.cookId = cookId
    }
}

/// PATCH /api/reservations/:id body. Verb flags are mutually exclusive.
/// Single-optional fields: `nil` == absent (and, matching the route, an
/// explicit null is also skipped). Double-optional fields (`tableId`,
/// `phone`, `email`, `notes`): outer nil == absent, inner nil == explicit
/// null, which CLEARS the column (web `clip(null) === null` then
/// `v !== row.x` sets NULL).
public struct ReservationPatch: Sendable {
    public var seat: Bool
    public var complete: Bool
    public var cancel: Bool
    public var noShow: Bool
    public var partyName: String?
    public var partySize: Int?
    public var reservationAt: String?
    public var tableId: String??
    public var phone: String??
    public var email: String??
    public var notes: String??
    public var cookId: String?

    public init(
        seat: Bool = false,
        complete: Bool = false,
        cancel: Bool = false,
        noShow: Bool = false,
        partyName: String? = nil,
        partySize: Int? = nil,
        reservationAt: String? = nil,
        tableId: String?? = nil,
        phone: String?? = nil,
        email: String?? = nil,
        notes: String?? = nil,
        cookId: String? = nil
    ) {
        self.seat = seat
        self.complete = complete
        self.cancel = cancel
        self.noShow = noShow
        self.partyName = partyName
        self.partySize = partySize
        self.reservationAt = reservationAt
        self.tableId = tableId
        self.phone = phone
        self.email = email
        self.notes = notes
        self.cookId = cookId
    }

    /// Active verbs in `VERBS` order (seat, complete, cancel, no_show).
    public var activeVerbs: [ReservationVerb] {
        var verbs: [ReservationVerb] = []
        if seat { verbs.append(.seat) }
        if complete { verbs.append(.complete) }
        if cancel { verbs.append(.cancel) }
        if noShow { verbs.append(.noShow) }
        return verbs
    }
}

/// GET /api/reservations query params. `date` (YYYY-MM-DD) wins over
/// `from`/`to`; malformed dates are ignored (web DATE_RE posture).
public struct ReservationListFilter: Sendable {
    public var date: String?
    public var from: String?
    public var to: String?
    public var status: String?

    public init(date: String? = nil, from: String? = nil, to: String? = nil, status: String? = nil) {
        self.date = date
        self.from = from
        self.to = to
        self.status = status
    }
}
