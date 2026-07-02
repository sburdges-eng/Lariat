import Foundation
import GRDB

/// TPHC write failures — mirror web `/api/tphc` status semantics.
/// `validationFailed` → 400, `notFound` → 404 (unknown id OR cross-location IDOR),
/// `alreadyDiscarded` → 409 (carries the existing row).
public enum TphcWriteError: Error, LocalizedError, Equatable {
    case validationFailed(String)
    case notFound
    case alreadyDiscarded(entry: TphcRow)
    case persistenceFailed

    public var errorDescription: String? {
        switch self {
        case .validationFailed(let msg): return msg
        case .notFound: return "unknown tphc entry"
        case .alreadyDiscarded: return "already discarded"
        case .persistenceFailed: return "Could not save TPHC batch"
        }
    }
}

/// Full `tphc_entries` row for board display and audit payload. Column names/types
/// match the EXISTING web schema in `lib/db.ts` (no migration).
public struct TphcRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let shiftDate: String
    public let locationId: String
    public let stationId: String?
    public let item: String
    public let batchRef: String?
    public let startedAt: String
    public let cutoffAt: String
    public let discardedAt: String?
    public let discardReason: String?
    public let cookId: String?
    public let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case shiftDate = "shift_date"
        case locationId = "location_id"
        case stationId = "station_id"
        case item
        case batchRef = "batch_ref"
        case startedAt = "started_at"
        case cutoffAt = "cutoff_at"
        case discardedAt = "discarded_at"
        case discardReason = "discard_reason"
        case cookId = "cook_id"
        case createdAt = "created_at"
    }
}

/// Input for starting a TPHC batch (POST /api/tphc).
public struct TphcStartInput: Sendable {
    public let item: String
    public let startedAt: String
    /// Raw kind string (validated in the repository, parity with the web route).
    public let kind: String
    public let stationId: String?
    public let batchRef: String?
    public let cookId: String?
    public let shiftDate: String?

    public init(
        item: String,
        startedAt: String,
        kind: String,
        stationId: String? = nil,
        batchRef: String? = nil,
        cookId: String? = nil,
        shiftDate: String? = nil
    ) {
        self.item = item
        self.startedAt = startedAt
        self.kind = kind
        self.stationId = stationId
        self.batchRef = batchRef
        self.cookId = cookId
        self.shiftDate = shiftDate
    }
}

/// Input for discarding a TPHC batch (PATCH /api/tphc).
public struct TphcDiscardInput: Sendable {
    public let id: Int64
    /// Raw discard-reason string (validated in the repository).
    public let discardReason: String
    public let cookId: String?

    public init(id: Int64, discardReason: String, cookId: String? = nil) {
        self.id = id
        self.discardReason = discardReason
        self.cookId = cookId
    }
}

/// Board snapshot for the TPHC screen (mirrors the web GET envelope: active rows
/// plus their per-batch scan classification).
public struct TphcBoardSnapshot: Sendable {
    public let locationId: String
    public let now: String
    public let active: [TphcRow]
    public let scan: [TphcBatchStatus]
    public let recent: [TphcRow]

    public init(locationId: String, now: String, active: [TphcRow], scan: [TphcBatchStatus], recent: [TphcRow]) {
        self.locationId = locationId
        self.now = now
        self.active = active
        self.scan = scan
        self.recent = recent
    }

    /// Scan entry for a given row id, for the live per-row countdown.
    public func scanEntry(id: Int64) -> TphcBatchStatus? {
        scan.first { $0.id == id }
    }
}
