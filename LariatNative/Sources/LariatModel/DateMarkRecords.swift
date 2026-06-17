import Foundation
import GRDB

public enum DateMarkDiscardReason: String, CaseIterable, Identifiable, Sendable {
    case expired, earlyUse = "early_use", quality, contamination

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .expired: return "Expired"
        case .earlyUse: return "Early use"
        case .quality: return "Quality"
        case .contamination: return "Contamination"
        }
    }
}

public enum DateMarkWriteError: Error, LocalizedError, Equatable {
    case validationFailed(String)
    case notFound
    case alreadyDiscarded

    public var errorDescription: String? {
        switch self {
        case .validationFailed(let msg): return msg
        case .notFound: return "Date mark not found"
        case .alreadyDiscarded: return "Already discarded"
        }
    }
}

public struct DateMarkRow: Codable, FetchableRecord, Sendable, Identifiable {
    public let id: Int64
    public let locationId: String
    public let item: String
    public let batchRef: String?
    public let preparedOn: String
    public let discardOn: String
    public let discardedAt: String?
    public let discardedByCookId: String?
    public let discardReason: String?
    public let cookId: String?
    public let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case locationId = "location_id"
        case item
        case batchRef = "batch_ref"
        case preparedOn = "prepared_on"
        case discardOn = "discard_on"
        case discardedAt = "discarded_at"
        case discardedByCookId = "discarded_by_cook_id"
        case discardReason = "discard_reason"
        case cookId = "cook_id"
        case createdAt = "created_at"
    }
}

public struct DateMarkCreateInput: Sendable {
    public let item: String
    public let preparedOn: String
    public let batchRef: String?
    public let cookId: String?

    public init(item: String, preparedOn: String, batchRef: String? = nil, cookId: String? = nil) {
        self.item = item
        self.preparedOn = preparedOn
        self.batchRef = batchRef
        self.cookId = cookId
    }
}

public struct ExpiringBatch: Sendable, Identifiable {
    public let id: Int64
    public let item: String
    public let discardOn: String
    public let daysUntilDiscard: Int
    public let status: ExpiringBatchStatus

    public var identifier: Int64 { id }
}

public enum ExpiringBatchStatus: String, Sendable {
    case ok, dueToday = "due_today", expired
}

public struct DateMarkBoardSnapshot: Sendable {
    public let locationId: String
    public let today: String
    public let active: [DateMarkRow]
    public let scan: [ExpiringBatch]

    public init(locationId: String, today: String, active: [DateMarkRow], scan: [ExpiringBatch]) {
        self.locationId = locationId
        self.today = today
        self.active = active
        self.scan = scan
    }
}
