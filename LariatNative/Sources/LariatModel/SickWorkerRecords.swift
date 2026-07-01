import Foundation
import GRDB

// Records + write-error types for the sick-worker board (F5 / FDA §2-201.11).
// Column names/types match the EXISTING web schema (`sick_worker_reports` in
// `lib/db.ts` / `SickWorkerReport`) — no migration. Mirrors the `CoolingRow`
// convention: the row conforms to GRDB `FetchableRecord` here in LariatModel
// (which already depends on GRDB) so the repository can decode it directly.

/// Sick-worker write failures — mirror web `/api/sick-worker` status semantics.
/// `validationFailed` → 400, `notFound` → 404, `alreadyCleared` → 409.
public enum SickWorkerWriteError: Error, LocalizedError, Equatable {
    case validationFailed(String)
    case notFound
    case alreadyCleared
    case persistenceFailed

    public var errorDescription: String? {
        switch self {
        case .validationFailed(let msg): return msg
        case .notFound: return "Unknown sick report"
        case .alreadyCleared: return "This report was already cleared"
        case .persistenceFailed: return "Could not save sick report"
        }
    }
}

/// Input for filing a sick report (POST /api/sick-worker). `symptoms`/`diagnosis`
/// carry the raw client keys; the repository normalizes + validates via
/// `SickWorkerCompute` before writing (parity with the web route).
public struct SickReportFileInput: Sendable {
    public let cookId: String
    public let reportedByPicId: String?
    public let symptoms: [String]
    public let diagnosedIllness: String?
    public let action: String?          // nil ⇒ use FDA minimum
    public let startedAt: String
    public let note: String?
    public let shiftDate: String?

    public init(
        cookId: String,
        reportedByPicId: String? = nil,
        symptoms: [String],
        diagnosedIllness: String? = nil,
        action: String? = nil,
        startedAt: String,
        note: String? = nil,
        shiftDate: String? = nil
    ) {
        self.cookId = cookId
        self.reportedByPicId = reportedByPicId
        self.symptoms = symptoms
        self.diagnosedIllness = diagnosedIllness
        self.action = action
        self.startedAt = startedAt
        self.note = note
        self.shiftDate = shiftDate
    }
}

/// Input for clearing (return-to-work) a report (PATCH /api/sick-worker).
public struct SickReportClearInput: Sendable {
    public let id: Int64
    public let clearanceSource: String
    public let reportedByPicId: String?

    public init(id: Int64, clearanceSource: String, reportedByPicId: String? = nil) {
        self.id = id
        self.clearanceSource = clearanceSource
        self.reportedByPicId = reportedByPicId
    }
}

/// Board snapshot for the Sick worker screen — mirrors the web GET response
/// (`{ location_id, active, history }`). `active` = open exclusions/restrictions
/// (return_at IS NULL); `history` = recently cleared (return_at present).
public struct SickWorkerBoardSnapshot: Sendable {
    public let locationId: String
    public let active: [SickWorkerRow]
    public let history: [SickWorkerRow]

    public init(locationId: String, active: [SickWorkerRow], history: [SickWorkerRow]) {
        self.locationId = locationId
        self.active = active
        self.history = history
    }
}

/// Full `sick_worker_reports` row for board display + audit payload. Column
/// names/types match the EXISTING web schema in `lib/db.ts` (no migration).
public struct SickWorkerRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let shiftDate: String
    public let locationId: String
    public let cookId: String
    public let reportedByPicId: String?
    public let symptoms: String
    public let diagnosedIllness: String?
    public let action: String
    public let startedAt: String
    public let returnAt: String?
    public let clearanceSource: String?
    public let note: String?
    public let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case shiftDate = "shift_date"
        case locationId = "location_id"
        case cookId = "cook_id"
        case reportedByPicId = "reported_by_pic_id"
        case symptoms
        case diagnosedIllness = "diagnosed_illness"
        case action
        case startedAt = "started_at"
        case returnAt = "return_at"
        case clearanceSource = "clearance_source"
        case note
        case createdAt = "created_at"
    }

    public init(
        id: Int64, shiftDate: String, locationId: String, cookId: String,
        reportedByPicId: String?, symptoms: String, diagnosedIllness: String?,
        action: String, startedAt: String, returnAt: String?,
        clearanceSource: String?, note: String?, createdAt: String?
    ) {
        self.id = id
        self.shiftDate = shiftDate
        self.locationId = locationId
        self.cookId = cookId
        self.reportedByPicId = reportedByPicId
        self.symptoms = symptoms
        self.diagnosedIllness = diagnosedIllness
        self.action = action
        self.startedAt = startedAt
        self.returnAt = returnAt
        self.clearanceSource = clearanceSource
        self.note = note
        self.createdAt = createdAt
    }
}
