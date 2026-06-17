import Foundation
import GRDB

public enum BreakKind: String, CaseIterable, Identifiable, Sendable, Codable {
    case meal, rest

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .meal: return "Meal"
        case .rest: return "Rest"
        }
    }
}

public enum BreakWriteError: Error, LocalizedError, Equatable {
    case kindRequired
    case cookIdRequired
    case startedAtInvalid
    case openBreakExists(Int64)
    case notFound
    case alreadyEnded
    case endedAtInvalid
    case validationFailed(String)

    public var errorDescription: String? {
        switch self {
        case .kindRequired: return "Break kind must be meal or rest"
        case .cookIdRequired: return "Cook identity required"
        case .startedAtInvalid: return "Start time must be a valid ISO timestamp"
        case .openBreakExists: return "Cook already has an open break"
        case .notFound: return "Break not found"
        case .alreadyEnded: return "Break already ended"
        case .endedAtInvalid: return "End time must be after start time"
        case .validationFailed(let msg): return msg
        }
    }
}

public struct ShiftBreakRow: Codable, FetchableRecord, Sendable, Identifiable {
    public let id: Int64
    public let shiftDate: String
    public let locationId: String
    public let cookId: String
    public let kind: String
    public let startedAt: String
    public let endedAt: String?
    public let durationMin: Double?
    public let waived: Int
    public let waiverRef: String?
    public let note: String?
    public let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case shiftDate = "shift_date"
        case locationId = "location_id"
        case cookId = "cook_id"
        case kind
        case startedAt = "started_at"
        case endedAt = "ended_at"
        case durationMin = "duration_min"
        case waived
        case waiverRef = "waiver_ref"
        case note
        case createdAt = "created_at"
    }

    public var breakKind: BreakKind? { BreakKind(rawValue: kind) }
}

public struct BreakStartInput: Sendable {
    public let kind: BreakKind
    public let cookId: String
    public let startedAt: String?
    public let shiftDate: String?
    public let waived: Bool
    public let waiverRef: String?
    public let note: String?

    public init(
        kind: BreakKind,
        cookId: String,
        startedAt: String? = nil,
        shiftDate: String? = nil,
        waived: Bool = false,
        waiverRef: String? = nil,
        note: String? = nil
    ) {
        self.kind = kind
        self.cookId = cookId
        self.startedAt = startedAt
        self.shiftDate = shiftDate
        self.waived = waived
        self.waiverRef = waiverRef
        self.note = note
    }
}

public struct BreakBoardSnapshot: Sendable {
    public let locationId: String
    public let date: String
    public let cookId: String?
    public let breaks: [ShiftBreakRow]
    public let evaluation: BreakCompute.ShiftEvaluation?

    public init(
        locationId: String,
        date: String,
        cookId: String?,
        breaks: [ShiftBreakRow],
        evaluation: BreakCompute.ShiftEvaluation? = nil
    ) {
        self.locationId = locationId
        self.date = date
        self.cookId = cookId
        self.breaks = breaks
        self.evaluation = evaluation
    }
}
