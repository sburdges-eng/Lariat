import Foundation
import GRDB

public enum TempLogWriteError: Error, LocalizedError, Equatable {
    case missingFields
    case readingRequired
    case unknownPoint(String)
    case pinRequiredForPastDate

    public var errorDescription: String? {
        switch self {
        case .missingFields: return "Missing required fields"
        case .readingRequired: return "Enter a temperature in °F"
        case .unknownPoint(let id): return "Unknown temp point: \(id)"
        case .pinRequiredForPastDate: return "Manager PIN required for past dates"
        }
    }
}

/// Full `temp_log` row for board display and audit payload.
public struct TempLogRow: Codable, FetchableRecord, Sendable, Identifiable {
    public let id: Int64
    public let shiftDate: String
    public let locationId: String
    public let pointId: String?
    public let readingF: Double?
    public let requiredMinF: Double?
    public let requiredMaxF: Double?
    public let correctiveAction: String?
    public let cookId: String?
    public let probeId: String?
    public let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case shiftDate = "shift_date"
        case locationId = "location_id"
        case pointId = "point_id"
        case readingF = "reading_f"
        case requiredMinF = "required_min_f"
        case requiredMaxF = "required_max_f"
        case correctiveAction = "corrective_action"
        case cookId = "cook_id"
        case probeId = "probe_id"
        case createdAt = "created_at"
    }
}

public struct TempLogPostInput: Sendable {
    public let shiftDate: String
    public let pointId: String
    public let readingF: Double
    public let correctiveAction: String?
    public let cookId: String?
    public let probeId: String?

    public init(
        shiftDate: String,
        pointId: String,
        readingF: Double,
        correctiveAction: String? = nil,
        cookId: String? = nil,
        probeId: String? = nil
    ) {
        self.shiftDate = shiftDate
        self.pointId = pointId
        self.readingF = readingF
        self.correctiveAction = correctiveAction
        self.cookId = cookId
        self.probeId = probeId
    }
}

public struct TempLogBoardSnapshot: Sendable {
    public let date: String
    public let locationId: String
    public let entries: [TempLogRow]
    public let summary: [TempPointSummary]

    public init(date: String, locationId: String, entries: [TempLogRow], summary: [TempPointSummary]) {
        self.date = date
        self.locationId = locationId
        self.entries = entries
        self.summary = summary
    }
}
