import Foundation
import GRDB

// Records + write-error types for the wage-notices board (A3 / L4). Column
// names/types match the EXISTING web schema (`wage_notices` in `lib/db.ts`
// ~L2873) — no migration. Mirrors the `TipDistributionRow` convention: the row
// conforms to GRDB `FetchableRecord` here in LariatModel so the repository can
// decode it directly and it feeds the pure `WageNoticeCompute` rules.
//
// Compliance: C.R.S. §8-4-103 (CO Wage Theft Transparency Act) + COMPS §3.3.
// Money is INTEGER cents (`wage_rate_cents`/`tip_credit_cents`), never Double.

/// Wage-notice write failures — mirror `app/api/wage-notices/route.js` status
/// semantics. `validationFailed` carries the shape reason (web 400). The sign act
/// itself is the acknowledgement — there is no separate ack row/table.
public enum WageNoticeWriteError: Error, LocalizedError, Equatable {
    case validationFailed(String)
    case persistenceFailed

    public var errorDescription: String? {
        switch self {
        case .validationFailed(let msg): return msg
        case .persistenceFailed: return "Could not record wage notice"
        }
    }
}

/// Input for signing a wage notice — mirrors the web POST body. Money is `Int`
/// cents; the view converts dollars→cents before building this.
public struct WageNoticeSignInput: Sendable, Equatable {
    public let cookId: String?
    public let reason: String?
    public let payBasis: String?
    public let wageRateCents: Int?
    public let tipCreditCents: Int?
    public let signedOn: String?
    public let documentPath: String?

    public init(
        cookId: String?,
        reason: String?,
        payBasis: String?,
        wageRateCents: Int?,
        tipCreditCents: Int? = nil,
        signedOn: String?,
        documentPath: String? = nil
    ) {
        self.cookId = cookId
        self.reason = reason
        self.payBasis = payBasis
        self.wageRateCents = wageRateCents
        self.tipCreditCents = tipCreditCents
        self.signedOn = signedOn
        self.documentPath = documentPath
    }
}

/// Full `wage_notices` row for board display + audit payload + the pure
/// `WageNoticeCompute` rules. Column names/types match the EXISTING web schema in
/// `lib/db.ts` (~L2873) — no migration. `reason`/`pay_basis` decode to their
/// enums (the DB CHECK guarantees valid raw values); cents are `Int`.
public struct WageNoticeRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let locationId: String
    public let cookId: String
    public let reason: WageNoticeReason
    public let wageRateCents: Int
    public let payBasis: WageNoticePayBasis
    public let tipCreditCents: Int?
    public let documentPath: String?
    public let signedOn: String
    public let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case locationId = "location_id"
        case cookId = "cook_id"
        case reason
        case wageRateCents = "wage_rate_cents"
        case payBasis = "pay_basis"
        case tipCreditCents = "tip_credit_cents"
        case documentPath = "document_path"
        case signedOn = "signed_on"
        case createdAt = "created_at"
    }

    public init(
        id: Int64, locationId: String, cookId: String, reason: WageNoticeReason,
        wageRateCents: Int, payBasis: WageNoticePayBasis, tipCreditCents: Int?,
        documentPath: String?, signedOn: String, createdAt: String?
    ) {
        self.id = id
        self.locationId = locationId
        self.cookId = cookId
        self.reason = reason
        self.wageRateCents = wageRateCents
        self.payBasis = payBasis
        self.tipCreditCents = tipCreditCents
        self.documentPath = documentPath
        self.signedOn = signedOn
        self.createdAt = createdAt
    }
}

/// Board snapshot for the latest-per-cook GET (no cook_id) — the latest notice
/// per cook plus the per-cook freshness tiles. Mirrors the web list-mode GET.
public struct WageNoticeBoardSnapshot: Sendable, Equatable {
    public let latestPerCook: [WageNoticeRow]
    public let freshness: [NoticeFreshness]

    public init(latestPerCook: [WageNoticeRow], freshness: [NoticeFreshness]) {
        self.latestPerCook = latestPerCook
        self.freshness = freshness
    }
}

/// History snapshot for the single-cook GET (`?cook_id=`) — full history (latest
/// first), the latest notice, its freshness, and whether a new notice is due.
public struct WageNoticeHistory: Sendable, Equatable {
    public let history: [WageNoticeRow]
    public let latest: WageNoticeRow?
    public let freshness: NoticeFreshness
    public let refreshRequired: RequiresNewNoticeResult

    public init(history: [WageNoticeRow], latest: WageNoticeRow?, freshness: NoticeFreshness, refreshRequired: RequiresNewNoticeResult) {
        self.history = history
        self.latest = latest
        self.freshness = freshness
        self.refreshRequired = refreshRequired
    }
}
