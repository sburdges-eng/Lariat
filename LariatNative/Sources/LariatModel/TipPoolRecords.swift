import Foundation
import GRDB

// Records + write-error types for the tip-pool board (A3 / L3, COMPS #39).
// Column names/types match the EXISTING web schema (`tip_pool_distributions`
// in `lib/db.ts` ~L2839) — no migration. Mirrors the `SickLeaveBalanceRow`
// convention: the row conforms to GRDB `FetchableRecord` here in LariatModel
// (which already depends on GRDB) so the repository can decode it directly, and
// it feeds the pure `TipPoolCompute.summarizePool` rule.
//
// Compliance: COMPS Order #39 §3.3/§3.4 (7 CCR 1103-1) + 29 CFR 531.52. Money is
// INTEGER cents (`amount_cents INTEGER NOT NULL`), never `Double` dollars.

/// Tip-pool write failures — mirror `app/api/tip-pool/route.js` status semantics.
/// `validationFailed` carries the shape reason (web 400 for bad kind/pool_ref/
/// cook_id/shift_date/negative amount; web 422 for a non-integer/float amount —
/// both surface as this native case). `poolIneligible` is the COMPS §3.4 gate
/// (web 422): a manager/owner may not receive a `tip_pool` line — thrown INSIDE
/// the transaction BEFORE any INSERT so no row + no audit survive.
public enum TipPoolWriteError: Error, LocalizedError, Equatable {
    case validationFailed(String)
    /// Cook is excluded from the tip pool under COMPS §3.4. Carries the citation
    /// (`7 CCR 1103-1 §3.4`) for the UI to surface (web 422 body).
    case poolIneligible(citation: String)
    case persistenceFailed

    public var errorDescription: String? {
        switch self {
        case .validationFailed(let msg): return msg
        case .poolIneligible:
            return "cook is excluded from tip pool — managers/owners may not receive pooled tips per COMPS §3.4"
        case .persistenceFailed: return "Could not record tip-pool line"
        }
    }
}

/// Input for one tip-pool write — mirrors the web POST body. Money is `Int`
/// cents; the view converts dollars→cents (round half-away-from-zero) before
/// building this, and the repository/compute re-reject a negative amount.
public struct TipDistributionInput: Sendable, Equatable {
    public let shiftDate: String?
    public let poolRef: String?
    public let cookId: String?
    public let role: String?
    public let kind: String?
    public let amountCents: Int
    public let note: String?

    public init(
        shiftDate: String?,
        poolRef: String?,
        cookId: String?,
        role: String? = nil,
        kind: String?,
        amountCents: Int,
        note: String? = nil
    ) {
        self.shiftDate = shiftDate
        self.poolRef = poolRef
        self.cookId = cookId
        self.role = role
        self.kind = kind
        self.amountCents = amountCents
        self.note = note
    }
}

/// Full `tip_pool_distributions` row for board display + audit payload + the pure
/// `TipPoolCompute.summarizePool` rule. Column names/types match the EXISTING web
/// schema in `lib/db.ts` (~L2839) — no migration. `amount_cents` is `Int`; `kind`
/// decodes to the `TipKind` enum (DB CHECK guarantees a valid raw value).
public struct TipDistributionRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let shiftDate: String
    public let locationId: String
    public let poolRef: String
    public let cookId: String
    public let role: String?
    public let kind: TipKind
    public let amountCents: Int
    public let note: String?
    public let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case shiftDate = "shift_date"
        case locationId = "location_id"
        case poolRef = "pool_ref"
        case cookId = "cook_id"
        case role
        case kind
        case amountCents = "amount_cents"
        case note
        case createdAt = "created_at"
    }

    public init(
        id: Int64, shiftDate: String, locationId: String, poolRef: String,
        cookId: String, role: String?, kind: TipKind, amountCents: Int,
        note: String?, createdAt: String?
    ) {
        self.id = id
        self.shiftDate = shiftDate
        self.locationId = locationId
        self.poolRef = poolRef
        self.cookId = cookId
        self.role = role
        self.kind = kind
        self.amountCents = amountCents
        self.note = note
        self.createdAt = createdAt
    }
}

/// Result of a successful tip-pool write — mirrors the web POST 200 body
/// (`{ ok: true, entry: row }`).
public struct TipPoolWriteResult: Sendable, Equatable {
    public let entry: TipDistributionRow

    public init(entry: TipDistributionRow) {
        self.entry = entry
    }
}
