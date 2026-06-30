import Foundation
import GRDB

/// Cooling write failures — mirror web `/api/cooling` status semantics.
/// `validationFailed` → 400, `needsCorrectiveAction` → 422, `notFound` → 404,
/// `correctiveNoteTooLong` → 400 (web rejects > 500 chars before the rule gate).
public enum CoolingWriteError: Error, LocalizedError, Equatable {
    case validationFailed(String)
    case needsCorrectiveAction(reason: String)
    case correctiveNoteTooLong(length: Int)
    case notFound
    case persistenceFailed

    public var errorDescription: String? {
        switch self {
        case .validationFailed(let msg): return msg
        case .needsCorrectiveAction(let reason): return reason
        case .correctiveNoteTooLong:
            return "Corrective action too long (max 500 chars)"
        case .notFound: return "Unknown cooling batch"
        case .persistenceFailed: return "Could not save cooling batch"
        }
    }

    /// Web PATCH maps a `breach` decision with no corrective note to HTTP 422
    /// with `needs_corrective_action: true`. This flag carries that signal.
    public var needsCorrectiveAction: Bool {
        if case .needsCorrectiveAction = self { return true }
        return false
    }
}

/// Full `cooling_log` row for board display and audit payload. Column names/types
/// match the EXISTING web schema in `lib/db.ts` (no migration).
public struct CoolingRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let shiftDate: String
    public let locationId: String
    public let item: String
    public let stationId: String?
    public let startedAt: String
    public let startReadingF: Double?
    public let stage1At: String?
    public let stage1ReadingF: Double?
    public let stage2At: String?
    public let stage2ReadingF: Double?
    public let status: String
    public let breachReason: String?
    public let correctiveAction: String?
    public let cookId: String?
    public let closedByCookId: String?
    public let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case shiftDate = "shift_date"
        case locationId = "location_id"
        case item
        case stationId = "station_id"
        case startedAt = "started_at"
        case startReadingF = "start_reading_f"
        case stage1At = "stage1_at"
        case stage1ReadingF = "stage1_reading_f"
        case stage2At = "stage2_at"
        case stage2ReadingF = "stage2_reading_f"
        case status
        case breachReason = "breach_reason"
        case correctiveAction = "corrective_action"
        case cookId = "cook_id"
        case closedByCookId = "closed_by_cook_id"
        case createdAt = "created_at"
    }
}

/// Input for opening a cooling batch (POST /api/cooling).
public struct CoolingStartInput: Sendable {
    public let item: String
    public let startedAt: String
    public let startReadingF: Double?
    public let stationId: String?
    public let cookId: String?
    public let shiftDate: String?

    public init(
        item: String,
        startedAt: String,
        startReadingF: Double? = nil,
        stationId: String? = nil,
        cookId: String? = nil,
        shiftDate: String? = nil
    ) {
        self.item = item
        self.startedAt = startedAt
        self.startReadingF = startReadingF
        self.stationId = stationId
        self.cookId = cookId
        self.shiftDate = shiftDate
    }
}

/// Input for recording a stage reading (PATCH /api/cooling).
public struct CoolingStageInput: Sendable {
    public let id: Int64
    public let readingF: Double
    public let at: String
    public let correctiveAction: String?
    public let cookId: String?

    public init(
        id: Int64,
        readingF: Double,
        at: String,
        correctiveAction: String? = nil,
        cookId: String? = nil
    ) {
        self.id = id
        self.readingF = readingF
        self.at = at
        self.correctiveAction = correctiveAction
        self.cookId = cookId
    }
}

/// Per-batch countdown for the dashboard scan (mirrors `OpenBatchScan`).
public struct CoolingScanEntry: Sendable, Identifiable, Equatable {
    public let id: Int64
    public let item: String
    public let startedAt: String
    public let stage: Int                // 1 or 2
    public let minutesRemaining: Double  // may be negative = breached
    public let breached: Bool

    public init(id: Int64, item: String, startedAt: String, stage: Int, minutesRemaining: Double, breached: Bool) {
        self.id = id
        self.item = item
        self.startedAt = startedAt
        self.stage = stage
        self.minutesRemaining = minutesRemaining
        self.breached = breached
    }
}

/// Board snapshot for the Cooling screen.
public struct CoolingBoardSnapshot: Sendable {
    public let date: String
    public let locationId: String
    public let open: [CoolingRow]
    public let scan: [CoolingScanEntry]
    public let closed: [CoolingRow]

    public init(date: String, locationId: String, open: [CoolingRow], scan: [CoolingScanEntry], closed: [CoolingRow]) {
        self.date = date
        self.locationId = locationId
        self.open = open
        self.scan = scan
        self.closed = closed
    }
}
