import Foundation
import GRDB

/// Pest-control write failures — mirror web `/api/pest` status semantics.
/// `validationFailed` → 400 (the `validatePestControl` guard), `persistenceFailed`
/// → 500. The web route has no 422 / corrective-note gate and no PIN gate; a
/// pest entry is an append-only observation, so there is intentionally no
/// `needsCorrectiveAction` case here.
public enum PestWriteError: Error, LocalizedError, Equatable {
    case validationFailed(String)
    case persistenceFailed

    public var errorDescription: String? {
        switch self {
        case .validationFailed(let msg): return msg
        case .persistenceFailed: return "Could not save pest control log"
        }
    }
}

/// Full `pest_control_log` row for board display and audit payload. Column
/// names/types match the EXISTING web schema in `lib/db.ts` (no migration).
public struct PestRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let shiftDate: String
    public let locationId: String?
    public let entryType: String
    public let vendor: String?
    public let technician: String?
    public let findings: String?
    public let pest: String?
    public let severity: String?
    public let correctiveAction: String?
    public let reportPath: String?
    public let cookId: String?
    public let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case shiftDate = "shift_date"
        case locationId = "location_id"
        case entryType = "entry_type"
        case vendor
        case technician
        case findings
        case pest
        case severity
        case correctiveAction = "corrective_action"
        case reportPath = "report_path"
        case cookId = "cook_id"
        case createdAt = "created_at"
    }
}

/// Typed input for logging a pest-control entry (POST /api/pest). Mirrors the
/// web route body (`Partial<PestControlEntry>`) after JSON parse.
public struct PestControlInput: Sendable {
    public let entryType: String?
    public let vendor: String?
    public let technician: String?
    public let findings: String?
    public let pest: String?
    public let severity: String?
    public let correctiveAction: String?
    public let reportPath: String?
    public let cookId: String?
    public let shiftDate: String?

    public init(
        entryType: String? = nil,
        vendor: String? = nil,
        technician: String? = nil,
        findings: String? = nil,
        pest: String? = nil,
        severity: String? = nil,
        correctiveAction: String? = nil,
        reportPath: String? = nil,
        cookId: String? = nil,
        shiftDate: String? = nil
    ) {
        self.entryType = entryType
        self.vendor = vendor
        self.technician = technician
        self.findings = findings
        self.pest = pest
        self.severity = severity
        self.correctiveAction = correctiveAction
        self.reportPath = reportPath
        self.cookId = cookId
        self.shiftDate = shiftDate
    }
}

/// Board snapshot for the Pest control screen (GET /api/pest).
public struct PestBoardSnapshot: Sendable {
    public let locationId: String
    public let rows: [PestRow]

    public init(locationId: String, rows: [PestRow]) {
        self.locationId = locationId
        self.rows = rows
    }
}
