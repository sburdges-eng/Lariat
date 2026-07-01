import Foundation
import GRDB

/// SDS-registry write failures — mirror web `/api/sds` status semantics.
/// The web route rejects every bad input with HTTP 400 (`{ error: reason }`);
/// there is no 422 corrective-note gate and no PIN gate on this surface.
/// `validationFailed` → 400, `persistenceFailed` → 500.
public enum SdsWriteError: Error, LocalizedError, Equatable {
    case validationFailed(String)
    case persistenceFailed

    public var errorDescription: String? {
        switch self {
        case .validationFailed(let msg): return msg
        case .persistenceFailed: return "Could not save SDS entry"
        }
    }
}

/// Full `sds_registry` row for board display and audit payload. Column names/types
/// match the EXISTING web schema in `lib/db.ts` (no migration). The `notes` column
/// exists in the schema but is not written by the web POST route; carried here so a
/// `SELECT *` round-trips.
public struct SdsRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let locationId: String
    public let productName: String
    public let manufacturer: String?
    public let hazardClass: String?
    public let storageLocation: String?
    public let pdfPath: String?
    public let url: String?
    public let lastReviewed: String?
    public let active: Int64
    public let notes: String?
    public let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case locationId = "location_id"
        case productName = "product_name"
        case manufacturer
        case hazardClass = "hazard_class"
        case storageLocation = "storage_location"
        case pdfPath = "pdf_path"
        case url
        case lastReviewed = "last_reviewed"
        case active
        case notes
        case createdAt = "created_at"
    }
}

/// Raw input for registering a product (POST /api/sds). Optional fields default to
/// nil; `active` nil ⇒ the route defaults to 1. Matches the web POST body shape.
public struct SdsInput: Sendable {
    public let productName: String?
    public let manufacturer: String?
    public let hazardClass: String?
    public let storageLocation: String?
    public let pdfPath: String?
    public let url: String?
    public let lastReviewed: String?
    public let active: Bool?
    public let cookId: String?

    public init(
        productName: String? = nil,
        manufacturer: String? = nil,
        hazardClass: String? = nil,
        storageLocation: String? = nil,
        pdfPath: String? = nil,
        url: String? = nil,
        lastReviewed: String? = nil,
        active: Bool? = nil,
        cookId: String? = nil
    ) {
        self.productName = productName
        self.manufacturer = manufacturer
        self.hazardClass = hazardClass
        self.storageLocation = storageLocation
        self.pdfPath = pdfPath
        self.url = url
        self.lastReviewed = lastReviewed
        self.active = active
        self.cookId = cookId
    }
}

/// Board snapshot for the SDS screen (mirrors the web GET response: active rows
/// for the location, ordered by product_name ASC).
public struct SdsBoardSnapshot: Sendable {
    public let locationId: String
    public let rows: [SdsRow]

    public init(locationId: String, rows: [SdsRow]) {
        self.locationId = locationId
        self.rows = rows
    }
}
