import Foundation
import GRDB

/// Typed write failures for the host-stand waitlist. Mirrors the web
/// routes' status-code semantics: 400 (invalid payload / bad status),
/// 404 (unknown party), 409 (illegal transition — double-seat, undo-left).
public enum WaitlistWriteError: Error, LocalizedError, Equatable {
    case invalidInput                          // 400 'party_name and party_size (>0) required'
    case badStatus                             // 400 'status must be one of seated, left'
    case notFound                              // 404 'Party not found'
    case badTransition(from: String, to: String) // 409 'Cannot transition from X to Y'

    public var errorDescription: String? {
        switch self {
        case .invalidInput: return "Party name and party size (>0) required"
        case .badStatus: return "Status must be one of seated, left"
        case .notFound: return "Party not found"
        case .badTransition(let from, let to):
            return "Cannot transition from \(from) to \(to)"
        }
    }
}

/// One `waitlist_parties` row (WaitlistPartyRow in lib/hostStand.ts).
public struct WaitlistPartyRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let locationId: String
    public let partyName: String
    public let partySize: Int
    public let joinedAt: String
    public let status: String
    public let seatedAt: String?
    public let leftAt: String?
    public let phone: String?
    public let notes: String?

    enum CodingKeys: String, CodingKey {
        case id, status, phone, notes
        case locationId = "location_id"
        case partyName = "party_name"
        case partySize = "party_size"
        case joinedAt = "joined_at"
        case seatedAt = "seated_at"
        case leftAt = "left_at"
    }

    public init(
        id: Int64,
        locationId: String,
        partyName: String,
        partySize: Int,
        joinedAt: String,
        status: String,
        seatedAt: String?,
        leftAt: String?,
        phone: String?,
        notes: String?
    ) {
        self.id = id
        self.locationId = locationId
        self.partyName = partyName
        self.partySize = partySize
        self.joinedAt = joinedAt
        self.status = status
        self.seatedAt = seatedAt
        self.leftAt = leftAt
        self.phone = phone
        self.notes = notes
    }
}

/// POST /api/host/waitlist body (raw, pre-sanitize — the repository runs
/// `HostStandCompute.sanitizeWaitlistInput` and maps nil → invalidInput).
public struct WaitlistAddInput: Sendable {
    public let partyName: String?
    public let partySize: Double?
    public let phone: String?
    public let notes: String?

    public init(partyName: String?, partySize: Double?, phone: String? = nil, notes: String? = nil) {
        self.partyName = partyName
        self.partySize = partySize
        self.phone = phone
        self.notes = notes
    }
}

/// GET /api/host/waitlist response bundle (parties + summary).
public struct WaitlistSnapshot: Sendable {
    public let locationId: String
    public let parties: [WaitlistPartyRow]
    public let summary: WaitlistSummary

    public init(locationId: String, parties: [WaitlistPartyRow], summary: WaitlistSummary) {
        self.locationId = locationId
        self.parties = parties
        self.summary = summary
    }
}
