import Foundation
import GRDB

// Records + inputs for the box-office board (A6.4). Column names/types match
// the EXISTING web schema (`box_office_lines` in `lib/db.ts` ~L2004) — no
// migration. `face_price` / `fees` are REAL dollars columns (`Double?`);
// `qty` is INTEGER. Money conversion to Int cents happens only at the
// settlement read boundary (`ShowSettlementRepository`), never here.

/// The five valid ticket sources — mirrors the web union + the DB CHECK.
public enum BoxOfficeSource: String, CaseIterable, Sendable, Codable {
    case dice
    case walkup
    case comp
    case will_call
    case guestlist
}

/// One `box_office_lines` row. `source` stays a raw `String` (parity with the
/// web rows, and so the tonight rollup can silently skip an unknown source
/// exactly like `lib/showsTonight.summarizeBoxOffice`).
public struct BoxOfficeLineRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let showId: Int64
    public let locationId: String
    public let source: String
    public let ticketClass: String?
    public let qty: Int
    public let facePrice: Double?
    public let fees: Double?
    public let externalRef: String?
    public let scannedAt: String?
    public let notes: String?
    public let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case showId = "show_id"
        case locationId = "location_id"
        case source
        case ticketClass = "ticket_class"
        case qty
        case facePrice = "face_price"
        case fees
        case externalRef = "external_ref"
        case scannedAt = "scanned_at"
        case notes
        case createdAt = "created_at"
    }

    public init(
        id: Int64, showId: Int64, locationId: String, source: String,
        ticketClass: String?, qty: Int, facePrice: Double?, fees: Double?,
        externalRef: String?, scannedAt: String?, notes: String?, createdAt: String?
    ) {
        self.id = id
        self.showId = showId
        self.locationId = locationId
        self.source = source
        self.ticketClass = ticketClass
        self.qty = qty
        self.facePrice = facePrice
        self.fees = fees
        self.externalRef = externalRef
        self.scannedAt = scannedAt
        self.notes = notes
        self.createdAt = createdAt
    }
}

/// Input for one box-office line insert — mirrors `CreateLineInput` in
/// `lib/boxOfficeRepo.ts`.
public struct BoxOfficeCreateLineInput: Sendable, Equatable {
    public let showId: Int64
    public let source: String
    public let ticketClass: String?
    public let qty: Int
    public let facePrice: Double?
    public let fees: Double?
    public let externalRef: String?
    public let notes: String?

    public init(
        showId: Int64, source: String, ticketClass: String? = nil, qty: Int,
        facePrice: Double? = nil, fees: Double? = nil,
        externalRef: String? = nil, notes: String? = nil
    ) {
        self.showId = showId
        self.source = source
        self.ticketClass = ticketClass
        self.qty = qty
        self.facePrice = facePrice
        self.fees = fees
        self.externalRef = externalRef
        self.notes = notes
    }
}

/// Input for one DICE bulk-import line — mirrors `DiceLineInput`.
/// `externalRef` (the DICE order id) is the dedupe key.
public struct DiceLineInput: Sendable, Equatable {
    public let showId: Int64
    public let externalRef: String
    public let ticketClass: String?
    public let qty: Int
    public let facePrice: Double?
    public let fees: Double?
    public let notes: String?

    public init(
        showId: Int64, externalRef: String, ticketClass: String? = nil,
        qty: Int, facePrice: Double? = nil, fees: Double? = nil, notes: String? = nil
    ) {
        self.showId = showId
        self.externalRef = externalRef
        self.ticketClass = ticketClass
        self.qty = qty
        self.facePrice = facePrice
        self.fees = fees
        self.notes = notes
    }
}

/// Result of a DICE bulk upsert — mirrors `BulkUpsertResult`.
public struct DiceBulkUpsertResult: Sendable, Equatable {
    public let inserted: Int
    public let updated: Int

    public init(inserted: Int, updated: Int) {
        self.inserted = inserted
        self.updated = updated
    }
}

/// Per-show DB-side rollup — mirrors `BoxOfficeSummary` in `lib/boxOfficeRepo.ts`.
/// NOTE (web quirk, ported faithfully): `totalRevenue` is `Σ face×qty` WITHOUT
/// fees, and `totalFees` counts each line's `fees` once (not ×qty) — different
/// from both the tonight rollup and the settlement math.
public struct BoxOfficeDbSummary: Sendable, Equatable {
    public let showId: Int64
    public let locationId: String
    public let totalQty: Int
    public let totalRevenue: Double
    public let totalFees: Double
    public let bySource: [BoxOfficeSource: SourceBucket]
    public let scannedQty: Int
    public let unscannedQty: Int

    public struct SourceBucket: Sendable, Equatable {
        public var qty: Int
        public var revenue: Double
        public init(qty: Int, revenue: Double) {
            self.qty = qty
            self.revenue = revenue
        }
    }

    public init(
        showId: Int64, locationId: String, totalQty: Int, totalRevenue: Double,
        totalFees: Double, bySource: [BoxOfficeSource: SourceBucket],
        scannedQty: Int, unscannedQty: Int
    ) {
        self.showId = showId
        self.locationId = locationId
        self.totalQty = totalQty
        self.totalRevenue = totalRevenue
        self.totalFees = totalFees
        self.bySource = bySource
        self.scannedQty = scannedQty
        self.unscannedQty = unscannedQty
    }

    /// Web `ZERO_BY_SOURCE()` — every source present at zero.
    public static func zeroBySource() -> [BoxOfficeSource: SourceBucket] {
        Dictionary(uniqueKeysWithValues: BoxOfficeSource.allCases.map {
            ($0, SourceBucket(qty: 0, revenue: 0))
        })
    }
}

/// Completeness signal — mirrors `boxOfficeCompleteness`.
public struct BoxOfficeCompleteness: Sendable, Equatable {
    public let hasAnyLines: Bool
    public let hasDiceLines: Bool
    public let hasWalkupLines: Bool
    /// 0..1: any-lines + dice-lines + walkup-lines milestones / 3.
    public let score: Double

    public init(hasAnyLines: Bool, hasDiceLines: Bool, hasWalkupLines: Bool, score: Double) {
        self.hasAnyLines = hasAnyLines
        self.hasDiceLines = hasDiceLines
        self.hasWalkupLines = hasWalkupLines
        self.score = score
    }

    public static func from(summary: BoxOfficeDbSummary) -> BoxOfficeCompleteness {
        let any = summary.totalQty > 0
        let dice = (summary.bySource[.dice]?.qty ?? 0) > 0
        let walkup = (summary.bySource[.walkup]?.qty ?? 0) > 0
        let milestones = [any, dice, walkup].filter { $0 }.count
        return BoxOfficeCompleteness(
            hasAnyLines: any, hasDiceLines: dice, hasWalkupLines: walkup,
            score: Double(milestones) / 3.0
        )
    }
}
