import Foundation
import GRDB

// Records + write-error types for the staff-certifications board (A3 / L3).
// Column names/types match the EXISTING web schema (`staff_certifications` in
// `lib/db.ts` ~L2646) — no migration. Mirrors the `SickWorkerRow` convention:
// the row conforms to GRDB `FetchableRecord` here in LariatModel (which already
// depends on GRDB) so the repository can decode it directly.
//
// Compliance: CO 6 CCR 1010-2 §2-102 (a Certified Food Protection Manager must
// be on duty during service). Carried as a doc note; not a stored field here.

/// Cert-write failures — mirror `app/api/certifications/route.js` status semantics.
/// `validationFailed` → web 400 (bad shape / bad cert_type / bad date / empty patch);
/// `notFound` → web 404 (unknown id on PATCH). Reads are never gated.
public enum StaffCertWriteError: Error, LocalizedError, Equatable {
    case validationFailed(String)
    case notFound
    case persistenceFailed

    public var errorDescription: String? {
        switch self {
        case .validationFailed(let msg): return msg
        case .notFound: return "Unknown certification"
        case .persistenceFailed: return "Could not save certification"
        }
    }
}

/// Cert type allow-set — the CHECK on `staff_certifications.cert_type` and the
/// route's `CERT_TYPES` guard. Rejected BEFORE any INSERT so a raw SQLite CHECK
/// error never surfaces (parity with the web 400).
public enum StaffCertType: String, Sendable, Equatable, CaseIterable {
    case cfpm
    case foodHandler = "food_handler"
    case tips
    case allergen
    case other

    /// Human labels — mirror `CERT_TYPES` in `CertBoard.jsx`.
    public var label: String {
        switch self {
        case .cfpm: return "CFPM (Certified Food Protection Manager)"
        case .foodHandler: return "Food-handler card"
        case .tips: return "TIPS / alcohol service"
        case .allergen: return "Allergen awareness"
        case .other: return "Other"
        }
    }
}

/// Tone bucket for a cert row — parity with `withStatus` in `CertBoard.jsx` and
/// the `<0 red / <=30 amber / muted-if-inactive-or-null` thresholds that
/// `CommandCompute.classifyCerts` already uses (board + Command must not disagree).
public enum StaffCertTone: String, Sendable, Equatable {
    case green
    case amber
    case red
    case muted
}

/// Input for recording a new cert (POST /api/certifications). Raw client keys;
/// the repository clips + validates via `StaffCertCompute` before writing.
public struct StaffCertCreateInput: Sendable {
    public let cookId: String
    public let certType: String
    public let certLabel: String
    public let issuer: String?
    public let certNumber: String?
    public let issuedOn: String?
    public let expiresOn: String?
    public let documentPath: String?

    public init(
        cookId: String,
        certType: String,
        certLabel: String,
        issuer: String? = nil,
        certNumber: String? = nil,
        issuedOn: String? = nil,
        expiresOn: String? = nil,
        documentPath: String? = nil
    ) {
        self.cookId = cookId
        self.certType = certType
        self.certLabel = certLabel
        self.issuer = issuer
        self.certNumber = certNumber
        self.issuedOn = issuedOn
        self.expiresOn = expiresOn
        self.documentPath = documentPath
    }
}

/// One patchable field on PATCH /api/certifications. `active` is coerced 1/0;
/// the string columns are clipped by `StaffCertCompute.clip`. Only the columns
/// the web route allows are representable here.
public enum StaffCertPatchField: Sendable, Equatable {
    case certLabel(String?)
    case issuer(String?)
    case certNumber(String?)
    case issuedOn(String?)
    case expiresOn(String?)
    case documentPath(String?)
    case active(Bool)
}

/// A set of edits to apply to one cert (PATCH). Empty → `validationFailed`
/// ("nothing to update"), mirroring the web 400.
public struct StaffCertPatchInput: Sendable {
    public let id: Int64
    public let fields: [StaffCertPatchField]

    public init(id: Int64, fields: [StaffCertPatchField]) {
        self.id = id
        self.fields = fields
    }
}

/// Full `staff_certifications` row for board display + audit payload. Column
/// names/types match the EXISTING web schema in `lib/db.ts` (no migration).
public struct StaffCertRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let locationId: String
    public let cookId: String
    public let certType: String
    public let certLabel: String
    public let issuer: String?
    public let certNumber: String?
    public let issuedOn: String?
    public let expiresOn: String?
    public let documentPath: String?
    public let active: Int
    public let createdAt: String?
    public let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case locationId = "location_id"
        case cookId = "cook_id"
        case certType = "cert_type"
        case certLabel = "cert_label"
        case issuer
        case certNumber = "cert_number"
        case issuedOn = "issued_on"
        case expiresOn = "expires_on"
        case documentPath = "document_path"
        case active
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    public init(
        id: Int64, locationId: String, cookId: String, certType: String,
        certLabel: String, issuer: String?, certNumber: String?,
        issuedOn: String?, expiresOn: String?, documentPath: String?,
        active: Int, createdAt: String?, updatedAt: String?
    ) {
        self.id = id
        self.locationId = locationId
        self.cookId = cookId
        self.certType = certType
        self.certLabel = certLabel
        self.issuer = issuer
        self.certNumber = certNumber
        self.issuedOn = issuedOn
        self.expiresOn = expiresOn
        self.documentPath = documentPath
        self.active = active
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
