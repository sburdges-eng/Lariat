import Foundation
import GRDB

public enum CalibrationMethod: String, CaseIterable, Identifiable, Sendable {
    case icePoint = "ice_point"
    case boilingPoint = "boiling_point"

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .icePoint: return "Ice point"
        case .boilingPoint: return "Boiling point"
        }
    }
}

public enum CalibrationWriteError: Error, LocalizedError, Equatable {
    case validationFailed(String)
    case thermometerRequired
    case unknownMethod

    public var errorDescription: String? {
        switch self {
        case .validationFailed(let msg): return msg
        case .thermometerRequired: return "Probe id is required"
        case .unknownMethod: return "Unknown calibration method"
        }
    }
}

public struct CalibrationRow: Codable, FetchableRecord, Sendable, Identifiable {
    public let id: Int64
    public let locationId: String
    public let thermometerId: String
    public let method: String
    public let beforeReadingF: Double?
    public let afterReadingF: Double?
    public let passed: Int
    public let actionTaken: String?
    public let cookId: String?
    public let calibratedAt: String?
    public let frequencyDays: Int?
    public let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case locationId = "location_id"
        case thermometerId = "thermometer_id"
        case method
        case beforeReadingF = "before_reading_f"
        case afterReadingF = "after_reading_f"
        case passed
        case actionTaken = "action_taken"
        case cookId = "cook_id"
        case calibratedAt = "calibrated_at"
        case frequencyDays = "frequency_days"
        case createdAt = "created_at"
    }
}

public struct CalibrationPostInput: Sendable {
    public let thermometerId: String
    public let method: CalibrationMethod
    public let readingF: Double
    public let note: String?
    public let cookId: String?
    public let shiftDate: String?
    public let elevationFt: Double?
    public let frequencyDays: Int?

    public init(
        thermometerId: String,
        method: CalibrationMethod,
        readingF: Double,
        note: String? = nil,
        cookId: String? = nil,
        shiftDate: String? = nil,
        elevationFt: Double? = nil,
        frequencyDays: Int? = nil
    ) {
        self.thermometerId = thermometerId
        self.method = method
        self.readingF = readingF
        self.note = note
        self.cookId = cookId
        self.shiftDate = shiftDate
        self.elevationFt = elevationFt
        self.frequencyDays = frequencyDays
    }
}

public struct CalibrationDecision: Sendable {
    public let passed: Bool
    public let expectedF: Double
    public let deviationF: Double
    public let reason: String?
}

public struct CalibrationBoardSnapshot: Sendable {
    public let rows: [CalibrationRow]

    public init(rows: [CalibrationRow]) {
        self.rows = rows
    }
}
