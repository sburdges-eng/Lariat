import Foundation
import GRDB

public enum CleaningWriteError: Error, LocalizedError, Equatable {
    case validationFailed(String)
    case notFound

    public var errorDescription: String? {
        switch self {
        case .validationFailed(let msg): return msg
        case .notFound: return "Cleaning entry not found"
        }
    }
}

public struct CleaningLogRow: Codable, FetchableRecord, Sendable, Identifiable {
    public let id: Int64
    public let shiftDate: String
    public let locationId: String
    public let scheduleId: Int64?
    public let area: String
    public let task: String
    public let completedAt: String
    public let cookId: String?
    public let verifiedByCookId: String?
    public let notes: String?
    public let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case shiftDate = "shift_date"
        case locationId = "location_id"
        case scheduleId = "schedule_id"
        case area, task
        case completedAt = "completed_at"
        case cookId = "cook_id"
        case verifiedByCookId = "verified_by_cook_id"
        case notes
        case createdAt = "created_at"
    }
}

public struct CleaningTickInput: Sendable {
    public let task: String?
    public let item: String?
    public let area: String?
    public let notes: String?
    public let scheduleId: Int64?
    public let shiftDate: String?
    public let completedAt: String?
    public let cookId: String?
    public let verifiedByCookId: String?

    public init(
        task: String? = nil,
        item: String? = nil,
        area: String? = nil,
        notes: String? = nil,
        scheduleId: Int64? = nil,
        shiftDate: String? = nil,
        completedAt: String? = nil,
        cookId: String? = nil,
        verifiedByCookId: String? = nil
    ) {
        self.task = task
        self.item = item
        self.area = area
        self.notes = notes
        self.scheduleId = scheduleId
        self.shiftDate = shiftDate
        self.completedAt = completedAt
        self.cookId = cookId
        self.verifiedByCookId = verifiedByCookId
    }
}

public struct CleaningBoardSnapshot: Sendable {
    public let locationId: String
    public let date: String
    public let rows: [CleaningLogRow]

    public init(locationId: String, date: String, rows: [CleaningLogRow]) {
        self.locationId = locationId
        self.date = date
        self.rows = rows
    }
}
