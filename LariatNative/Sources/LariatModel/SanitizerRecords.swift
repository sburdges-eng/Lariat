import Foundation
import GRDB

/// Sanitizer write failures — mirror web `/api/sanitizer` status semantics.
/// `validationFailed` → 400, `needsCorrectiveAction` → 422, `persistenceFailed`
/// → 500. There is no PATCH and no 404/409 on this surface: every reading is a
/// point-in-time INSERT (parity with the web route, which has POST + GET only).
public enum SanitizerWriteError: Error, LocalizedError, Equatable {
    case validationFailed(String)
    case needsCorrectiveAction(reason: String, status: SanitizerStatus, requiredMinPpm: Double?, requiredMaxPpm: Double?)
    case correctiveNoteTooLong(length: Int)
    case persistenceFailed

    public var errorDescription: String? {
        switch self {
        case .validationFailed(let msg): return msg
        case .needsCorrectiveAction(let reason, _, _, _):
            return "\(reason) — needs a note on the fix"
        case .correctiveNoteTooLong:
            return "Corrective action too long (max 500 chars)"
        case .persistenceFailed: return "Could not save sanitizer check"
        }
    }

    /// Web maps a low/high decision with no corrective note to HTTP 422 with
    /// `needs_corrective_action: true`. This flag carries that signal to the UI.
    public var needsCorrectiveAction: Bool {
        if case .needsCorrectiveAction = self { return true }
        return false
    }
}

/// Full `sanitizer_checks` row for board display and audit payload. Column
/// names/types match the EXISTING web schema in `lib/db.ts` (no migration).
public struct SanitizerRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let shiftDate: String
    public let locationId: String
    public let stationId: String?
    public let pointLabel: String
    public let chemistry: String
    public let concentrationPpm: Double
    public let requiredMinPpm: Double?
    public let requiredMaxPpm: Double?
    public let waterTempF: Double?
    public let status: String
    public let correctiveAction: String?
    public let cookId: String?
    public let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case shiftDate = "shift_date"
        case locationId = "location_id"
        case stationId = "station_id"
        case pointLabel = "point_label"
        case chemistry
        case concentrationPpm = "concentration_ppm"
        case requiredMinPpm = "required_min_ppm"
        case requiredMaxPpm = "required_max_ppm"
        case waterTempF = "water_temp_f"
        case status
        case correctiveAction = "corrective_action"
        case cookId = "cook_id"
        case createdAt = "created_at"
    }
}

/// Input for recording a sanitizer reading (POST /api/sanitizer).
public struct SanitizerCheckInput: Sendable {
    public let pointLabel: String
    public let chemistry: String
    public let concentrationPpm: Double?
    public let waterTempF: Double?
    public let correctiveAction: String?
    public let stationId: String?
    public let cookId: String?
    public let shiftDate: String?

    public init(
        pointLabel: String,
        chemistry: String,
        concentrationPpm: Double?,
        waterTempF: Double? = nil,
        correctiveAction: String? = nil,
        stationId: String? = nil,
        cookId: String? = nil,
        shiftDate: String? = nil
    ) {
        self.pointLabel = pointLabel
        self.chemistry = chemistry
        self.concentrationPpm = concentrationPpm
        self.waterTempF = waterTempF
        self.correctiveAction = correctiveAction
        self.stationId = stationId
        self.cookId = cookId
        self.shiftDate = shiftDate
    }
}

/// Board snapshot for the Sanitizer screen — mirrors the GET /api/sanitizer
/// response: today's full log + the latest-per-point roll-up + the well-known
/// default points so the UI can nudge surfaces not yet checked.
public struct SanitizerBoardSnapshot: Sendable {
    public let date: String
    public let locationId: String
    public let rows: [SanitizerRow]
    public let latest: [SanitizerRow]
    public let knownPoints: [SanitizerPoint]

    public init(
        date: String,
        locationId: String,
        rows: [SanitizerRow],
        latest: [SanitizerRow],
        knownPoints: [SanitizerPoint]
    ) {
        self.date = date
        self.locationId = locationId
        self.rows = rows
        self.latest = latest
        self.knownPoints = knownPoints
    }
}
