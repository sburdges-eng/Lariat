import Foundation
import GRDB

/// Full `eighty_six` row for board display and resolve audit payload.
public struct EightySixRow: Codable, FetchableRecord, Sendable, Identifiable {
    public let id: Int64
    public let shiftDate: String
    public let stationId: String?
    public let item: String
    public let kind: String?
    public let reason: String?
    public let quantity: String?
    public let cookId: String?
    public let resolvedAt: String?
    public let resolvedBy: String?
    public let createdAt: String?
    public let locationId: String

    enum CodingKeys: String, CodingKey {
        case id
        case shiftDate = "shift_date"
        case stationId = "station_id"
        case item, kind, reason, quantity
        case cookId = "cook_id"
        case resolvedAt = "resolved_at"
        case resolvedBy = "resolved_by"
        case createdAt = "created_at"
        case locationId = "location_id"
    }
}

public struct EightySixAddInput: Sendable {
    public let item: String
    public let stationId: String?
    public let kind: String
    public let reason: String?
    public let quantity: String?
    public let cookId: String?
    public let shiftDate: String

    public init(
        item: String,
        stationId: String?,
        kind: String = "item",
        reason: String?,
        quantity: String?,
        cookId: String?,
        shiftDate: String
    ) {
        self.item = item
        self.stationId = stationId
        self.kind = kind
        self.reason = reason
        self.quantity = quantity
        self.cookId = cookId
        self.shiftDate = shiftDate
    }
}

public enum EightySixWriteError: Error, LocalizedError, Equatable {
    case itemRequired
    case notFound
    case alreadyResolved

    public var errorDescription: String? {
        switch self {
        case .itemRequired: return "Item required"
        case .notFound: return "Could not find that 86"
        case .alreadyResolved: return "Already back on menu"
        }
    }
}

public struct EightySixBoardSnapshot: Sendable {
    public let active: [EightySixRow]
    public let resolved: [EightySixRow]
    public let cascaded: [CascadedRecipe]

    public init(active: [EightySixRow], resolved: [EightySixRow], cascaded: [CascadedRecipe]) {
        self.active = active
        self.resolved = resolved
        self.cascaded = cascaded
    }
}
