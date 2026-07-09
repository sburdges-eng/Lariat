import Foundation
import GRDB

// Records + write-error types for doctor's-note documents attached to a
// sick-worker report (design 2026-07-08-lariat-sick-note-docs §3). Column
// names/types match the web schema (`sick_note_documents` in `lib/db.ts`) —
// no migration. Mirrors the `CoolingRow` convention: the row conforms to GRDB
// `FetchableRecord` here in LariatModel so the repository can decode it directly.

/// Document category for a sick-note attachment: the doctor's note itself, or
/// the return-to-work clearance paperwork.
public enum SickNoteKind: String, Codable, Sendable, CaseIterable, Equatable {
    case note
    case clearance
}

/// Sick-note document write failures. `reportNotFound` → the parent
/// sick-worker report does not exist at this location (404 semantics).
public enum SickNoteWriteError: Error, LocalizedError, Equatable {
    case reportNotFound
    case persistenceFailed

    public var errorDescription: String? {
        switch self {
        case .reportNotFound: return "Unknown sick report for this location"
        case .persistenceFailed: return "Could not save the doctor's note"
        }
    }
}

/// Input for attaching one doctor's-note document to a sick-worker report.
/// `filePath` is the already-derived relative path (the App layer copies the
/// picked file BEFORE recording it); `location_id`/`uploaded_by` come from the
/// `RegulatedWriteContext` at write time.
public struct SickNoteAttachInput: Sendable {
    public let reportId: Int64
    public let filePath: String
    public let kind: SickNoteKind
    public let originalFilename: String?
    public let uploadedAt: String

    public init(
        reportId: Int64,
        filePath: String,
        kind: SickNoteKind,
        originalFilename: String? = nil,
        uploadedAt: String
    ) {
        self.reportId = reportId
        self.filePath = filePath
        self.kind = kind
        self.originalFilename = originalFilename
        self.uploadedAt = uploadedAt
    }
}

/// Full `sick_note_documents` row for display + audit payload. `filePath` is
/// relative to `data/uploads/` (`sick-notes/<report_id>/<uuid>.<ext>`);
/// `originalFilename` is display-only (PHI-adjacent — PIN-gated in the UI).
/// `kind` stays a raw string like `SickWorkerRow.action` so an unexpected DB
/// value degrades to display instead of failing the whole board decode.
public struct SickNoteDocumentRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let reportId: Int64
    public let locationId: String
    public let filePath: String
    public let kind: String
    public let originalFilename: String?
    public let uploadedBy: String?
    public let uploadedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case reportId = "report_id"
        case locationId = "location_id"
        case filePath = "file_path"
        case kind
        case originalFilename = "original_filename"
        case uploadedBy = "uploaded_by"
        case uploadedAt = "uploaded_at"
    }

    public init(
        id: Int64, reportId: Int64, locationId: String, filePath: String,
        kind: String, originalFilename: String?, uploadedBy: String?, uploadedAt: String
    ) {
        self.id = id
        self.reportId = reportId
        self.locationId = locationId
        self.filePath = filePath
        self.kind = kind
        self.originalFilename = originalFilename
        self.uploadedBy = uploadedBy
        self.uploadedAt = uploadedAt
    }

    /// Typed view of `kind`; nil for a value outside the known set.
    public var kindValue: SickNoteKind? { SickNoteKind(rawValue: kind) }
}
