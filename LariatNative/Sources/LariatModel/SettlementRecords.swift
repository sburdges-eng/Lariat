import Foundation
import GRDB

// Records for the per-show settlement (A6.4 — MONEY-CRITICAL). Column
// names/types match the EXISTING web schema (`show_deals` in `lib/db.ts`
// ~L2039) — no migration. Money is INTEGER cents at every boundary inside
// the settlement domain; legacy REAL columns (box_office_lines.face_price,
// fees; toast_sales_daily.net_sales) are rounded at the read boundary.

/// One itemized cost off the top — mirrors `DealCost` (Int cents).
public struct DealCost: Sendable, Equatable, Codable {
    public let label: String
    public let cents: Int

    public init(label: String, cents: Int) {
        self.label = label
        self.cents = cents
    }
}

/// Internal cents-based deal shape — mirrors `DealPoint` in `lib/dealPoints.ts`.
public struct DealPoint: Sendable, Equatable {
    public let guaranteeCents: Int
    public let vsPctAfterCosts: Double?
    public let costsOffTop: [DealCost]
    public let buyoutCents: Int

    public init(
        guaranteeCents: Int, vsPctAfterCosts: Double?,
        costsOffTop: [DealCost], buyoutCents: Int
    ) {
        self.guaranteeCents = guaranteeCents
        self.vsPctAfterCosts = vsPctAfterCosts
        self.costsOffTop = costsOffTop
        self.buyoutCents = buyoutCents
    }
}

/// Raw `show_deals` row — mirrors `ShowDealRow`.
public struct ShowDealRow: Codable, FetchableRecord, Sendable, Equatable {
    public let guaranteeCents: Int
    public let vsPctAfterCosts: Double?
    public let costsOffTopJson: String
    public let buyoutCents: Int

    enum CodingKeys: String, CodingKey {
        case guaranteeCents = "guarantee_cents"
        case vsPctAfterCosts = "vs_pct_after_costs"
        case costsOffTopJson = "costs_off_top_json"
        case buyoutCents = "buyout_cents"
    }

    public init(guaranteeCents: Int, vsPctAfterCosts: Double?, costsOffTopJson: String, buyoutCents: Int) {
        self.guaranteeCents = guaranteeCents
        self.vsPctAfterCosts = vsPctAfterCosts
        self.costsOffTopJson = costsOffTopJson
        self.buyoutCents = buyoutCents
    }
}

/// External / raw-JSON deal shape (USD, unknown provenance) — mirrors
/// `DealTerms`. Values are dollars; convert via `dealTermsToDealPoint`.
public struct DealTerms: Sendable, Equatable {
    public let guaranteeUsd: Double
    /// Three-state: `.some(.some(x))` present, `.some(.none)` explicit null,
    /// `nil` absent — mirrors the JS undefined/null distinction.
    public let vsPctAfterCosts: Double??
    public let costsOffTop: [DealTermsCostItem]?
    public let buyoutUsd: Double?

    public init(
        guaranteeUsd: Double, vsPctAfterCosts: Double?? = nil,
        costsOffTop: [DealTermsCostItem]? = nil, buyoutUsd: Double? = nil
    ) {
        self.guaranteeUsd = guaranteeUsd
        self.vsPctAfterCosts = vsPctAfterCosts
        self.costsOffTop = costsOffTop
        self.buyoutUsd = buyoutUsd
    }
}

public struct DealTermsCostItem: Sendable, Equatable {
    public let label: String
    public let amountUsd: Double

    public init(label: String, amountUsd: Double) {
        self.label = label
        self.amountUsd = amountUsd
    }
}

/// Talent payout breakdown — mirrors `TalentPayout` (Int cents).
public struct TalentPayout: Sendable, Equatable {
    public let guaranteeCents: Int
    public let vsBonusCents: Int
    public let buyoutCents: Int
    public let totalCents: Int

    public init(guaranteeCents: Int, vsBonusCents: Int, buyoutCents: Int, totalCents: Int) {
        self.guaranteeCents = guaranteeCents
        self.vsBonusCents = vsBonusCents
        self.buyoutCents = buyoutCents
        self.totalCents = totalCents
    }
}

/// Full settlement rollup — mirrors `SettlementSummary` in `lib/settlementRepo.ts`.
public struct SettlementSummary: Sendable, Equatable {
    public struct Show: Sendable, Equatable {
        public let id: Int64
        public let bandName: String
        public let date: String
        public let locationId: String

        public init(id: Int64, bandName: String, date: String, locationId: String) {
            self.id = id
            self.bandName = bandName
            self.date = date
            self.locationId = locationId
        }
    }

    public struct SourceRollup: Sendable, Equatable {
        public var qty: Int
        public var grossCents: Int
        public init(qty: Int, grossCents: Int) {
            self.qty = qty
            self.grossCents = grossCents
        }
    }

    public struct Ticketing: Sendable, Equatable {
        public let grossCents: Int
        public let feesCents: Int
        public let netCents: Int
        public let bySource: [BoxOfficeSource: SourceRollup]

        public init(grossCents: Int, feesCents: Int, netCents: Int, bySource: [BoxOfficeSource: SourceRollup]) {
            self.grossCents = grossCents
            self.feesCents = feesCents
            self.netCents = netCents
            self.bySource = bySource
        }
    }

    public struct Toast: Sendable, Equatable {
        public let totalCents: Int
        public let ordersCount: Int
        public let guestsCount: Int
        public let attributionDate: String
        public let rowsFound: Int

        public init(totalCents: Int, ordersCount: Int, guestsCount: Int, attributionDate: String, rowsFound: Int) {
            self.totalCents = totalCents
            self.ordersCount = ordersCount
            self.guestsCount = guestsCount
            self.attributionDate = attributionDate
            self.rowsFound = rowsFound
        }
    }

    public let show: Show
    public let deal: DealPoint
    public let ticketing: Ticketing
    public let toast: Toast
    public let talent: TalentPayout
    public let costsOffTopCents: Int
    public let netDoorCents: Int
    public let computedAt: String

    public init(
        show: Show, deal: DealPoint, ticketing: Ticketing, toast: Toast,
        talent: TalentPayout, costsOffTopCents: Int, netDoorCents: Int, computedAt: String
    ) {
        self.show = show
        self.deal = deal
        self.ticketing = ticketing
        self.toast = toast
        self.talent = talent
        self.costsOffTopCents = costsOffTopCents
        self.netDoorCents = netDoorCents
        self.computedAt = computedAt
    }
}

/// Settlement failures — mirror the web route status semantics
/// (401 is the native PIN gate; 400/422 → `.validation`; 404 → `.showNotFound`).
public enum SettlementError: Error, LocalizedError, Equatable {
    case showNotFound(Int64)
    case validation(String)
    case invalidDealShape(String)
    case badDealRow(String)

    public var errorDescription: String? {
        switch self {
        case .showNotFound(let id): return "getSettlement: show \(id) not found"
        case .validation(let msg): return msg
        case .invalidDealShape(let msg): return msg
        case .badDealRow(let msg): return msg
        }
    }
}
