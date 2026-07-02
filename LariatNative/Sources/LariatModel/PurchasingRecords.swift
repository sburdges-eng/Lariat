import Foundation
import GRDB

// A4.4 Purchasing records — mirrors the row shapes in `lib/vendorCompare.ts`,
// `lib/vendorMapping.ts`, `lib/vendorMappingRepo.ts`, and
// `lib/orderGuideEnrichment.ts`.
//
// ── Money convention (binding, same as A4.2) ────────────────────────────────
// `vendor_prices` / `order_guide_items` money columns (`pack_price`,
// `unit_price`, `reconciled_unit_price`) are REAL **dollars** in the web
// schema. They stay `Double` dollars end to end here — no cents conversion,
// no implicit unit conversion.

/// The two vendors the purchasing boards compare — `COMPARE_VENDORS` in
/// `lib/vendorCompare.ts`.
public enum CompareVendor: String, Sendable, Codable, CaseIterable, Hashable {
    case sysco
    case shamrock

    /// The other compare vendor (used for `missing_vendor` derivation).
    public var counterpart: CompareVendor { self == .sysco ? .shamrock : .sysco }
}

/// `CompareOfferStatus` in `lib/vendorCompare.ts` — 'ok' | 'cannot_compare'.
public enum CompareOfferStatus: String, Sendable, Codable, Hashable {
    case ok
    case cannotCompare = "cannot_compare"
}

/// One `vendor_prices` row as the compare compute consumes it — mirrors the
/// private `VendorPriceRow` type in `lib/vendorCompare.ts`.
public struct VendorPriceOfferRow: Decodable, FetchableRecord, Sendable, Equatable {
    public let vendor: String?
    public let sku: String?
    public let ingredient: String
    public let packSize: Double?
    public let packUnit: String?
    public let packPrice: Double?             // REAL dollars
    public let unitPrice: Double?             // REAL dollars
    public let reconciledUnitPrice: Double?   // REAL dollars
    public let masterId: String?

    enum CodingKeys: String, CodingKey {
        case vendor, sku, ingredient,
             packSize = "pack_size", packUnit = "pack_unit",
             packPrice = "pack_price", unitPrice = "unit_price",
             reconciledUnitPrice = "reconciled_unit_price", masterId = "master_id"
    }

    public init(
        vendor: String?, sku: String?, ingredient: String,
        packSize: Double?, packUnit: String?, packPrice: Double?,
        unitPrice: Double?, reconciledUnitPrice: Double?, masterId: String?
    ) {
        self.vendor = vendor
        self.sku = sku
        self.ingredient = ingredient
        self.packSize = packSize
        self.packUnit = packUnit
        self.packPrice = packPrice
        self.unitPrice = unitPrice
        self.reconciledUnitPrice = reconciledUnitPrice
        self.masterId = masterId
    }
}

/// `ComparableUnitPriceResult` in `lib/vendorCompare.ts`.
public struct ComparableUnitPriceResult: Sendable, Equatable {
    public let price: Double?          // dollars per `unit`
    public let unit: String?
    public let status: CompareOfferStatus
    public let reason: String?         // 'no_price' | 'unknown_unit' | 'unit_mismatch' | 'count_bridge' | 'need_density'

    public init(price: Double?, unit: String?, status: CompareOfferStatus, reason: String?) {
        self.price = price
        self.unit = unit
        self.status = status
        self.reason = reason
    }
}

/// `VendorOfferSnapshot` in `lib/vendorCompare.ts`.
public struct VendorOfferSnapshot: Sendable, Equatable {
    public let vendor: CompareVendor
    public let sku: String?
    public let packLabel: String?
    public let normalizedPrice: Double?   // dollars per normalizedUnit
    public let normalizedUnit: String?
    public let status: CompareOfferStatus
    public let reason: String?

    public init(
        vendor: CompareVendor, sku: String?, packLabel: String?,
        normalizedPrice: Double?, normalizedUnit: String?,
        status: CompareOfferStatus, reason: String?
    ) {
        self.vendor = vendor
        self.sku = sku
        self.packLabel = packLabel
        self.normalizedPrice = normalizedPrice
        self.normalizedUnit = normalizedUnit
        self.status = status
        self.reason = reason
    }
}

/// `VendorCompareRow` in `lib/vendorCompare.ts`.
public struct VendorCompareRow: Sendable, Equatable, Identifiable {
    public var id: String { masterId }
    public let masterId: String
    public let canonicalName: String
    public let preferredVendor: String?
    public let qualityLocked: Bool
    public let qualityLockReason: String?
    public let sysco: VendorOfferSnapshot?
    public let shamrock: VendorOfferSnapshot?
    public let compareStatus: CompareStatus
    public let cheaperVendor: CompareVendor?

    /// 'comparable' | 'cannot_compare'.
    public enum CompareStatus: String, Sendable, Codable, Hashable {
        case comparable
        case cannotCompare = "cannot_compare"
    }

    public init(
        masterId: String, canonicalName: String, preferredVendor: String?,
        qualityLocked: Bool, qualityLockReason: String?,
        sysco: VendorOfferSnapshot?, shamrock: VendorOfferSnapshot?,
        compareStatus: CompareStatus, cheaperVendor: CompareVendor?
    ) {
        self.masterId = masterId
        self.canonicalName = canonicalName
        self.preferredVendor = preferredVendor
        self.qualityLocked = qualityLocked
        self.qualityLockReason = qualityLockReason
        self.sysco = sysco
        self.shamrock = shamrock
        self.compareStatus = compareStatus
        self.cheaperVendor = cheaperVendor
    }
}

/// `VendorCompareSummary` in `lib/vendorCompare.ts`.
public struct VendorCompareSummary: Sendable, Equatable {
    public let mappedPairCount: Int
    public let mastersWithBothVendors: Int
    public let mastersSingleVendorOnly: Int
    public let rows: [VendorCompareRow]

    public init(mappedPairCount: Int, mastersWithBothVendors: Int, mastersSingleVendorOnly: Int, rows: [VendorCompareRow]) {
        self.mappedPairCount = mappedPairCount
        self.mastersWithBothVendors = mastersWithBothVendors
        self.mastersSingleVendorOnly = mastersSingleVendorOnly
        self.rows = rows
    }
}

// ── vendorMapping.ts (link boards) ──────────────────────────────────────────

/// `CatalogKey` in `lib/vendorMapping.ts`. `vendor` stays a raw String (the web
/// JSON boundary is untyped — `pairCatalogRows` normalizes + validates it), and
/// the write repo asserts it resolves to a `CompareVendor`.
public struct CatalogKey: Sendable, Equatable, Hashable {
    public let vendor: String
    public let sku: String
    public let ingredient: String

    public init(vendor: String, sku: String, ingredient: String) {
        self.vendor = vendor
        self.sku = sku
        self.ingredient = ingredient
    }
}

/// `CatalogRow` in `lib/vendorMapping.ts` — one deduped (vendor, sku) catalog
/// entry. `vendor` is guaranteed normalized sysco/shamrock by the read query.
public struct CatalogRow: Sendable, Equatable, Identifiable {
    public var id: String { "\(vendor.rawValue)\u{1F}\(sku)" }
    public let vendor: CompareVendor
    public let sku: String
    public let ingredient: String
    public let packLabel: String?
    public let unitPrice: Double?   // REAL dollars
    public let masterId: String?

    public init(vendor: CompareVendor, sku: String, ingredient: String, packLabel: String?, unitPrice: Double?, masterId: String?) {
        self.vendor = vendor
        self.sku = sku
        self.ingredient = ingredient
        self.packLabel = packLabel
        self.unitPrice = unitPrice
        self.masterId = masterId
    }

    /// The row's `CatalogKey` for the write layer.
    public var key: CatalogKey { CatalogKey(vendor: vendor.rawValue, sku: sku, ingredient: ingredient) }
}

/// `SingleVendorMaster` in `lib/vendorMapping.ts`.
public struct SingleVendorMaster: Sendable, Equatable, Identifiable {
    public var id: String { masterId }
    public let masterId: String
    public let canonicalName: String
    public let linkedVendor: CompareVendor
    public let missingVendor: CompareVendor

    public init(masterId: String, canonicalName: String, linkedVendor: CompareVendor, missingVendor: CompareVendor) {
        self.masterId = masterId
        self.canonicalName = canonicalName
        self.linkedVendor = linkedVendor
        self.missingVendor = missingVendor
    }
}

/// `MappingCoverageSummary` in `lib/vendorMapping.ts`.
public struct MappingCoverageSummary: Sendable, Equatable {
    public let mappedPairs: Int
    public let singleVendor: Int
    public let unlinkedSysco: Int
    public let unlinkedShamrock: Int

    public init(mappedPairs: Int, singleVendor: Int, unlinkedSysco: Int, unlinkedShamrock: Int) {
        self.mappedPairs = mappedPairs
        self.singleVendor = singleVendor
        self.unlinkedSysco = unlinkedSysco
        self.unlinkedShamrock = unlinkedShamrock
    }
}

// ── vendorMappingRepo.ts (write layer) ──────────────────────────────────────

/// `PairCatalogInput` in `lib/vendorMappingRepo.ts`. Location / actor metadata
/// travels in `RegulatedWriteContext` natively (web: locationId/cookId/actorSource
/// fields on the input).
public struct PairCatalogInput: Sendable, Equatable {
    public let syscoKey: CatalogKey
    public let shamrockKey: CatalogKey
    public let canonicalName: String

    public init(syscoKey: CatalogKey, shamrockKey: CatalogKey, canonicalName: String) {
        self.syscoKey = syscoKey
        self.shamrockKey = shamrockKey
        self.canonicalName = canonicalName
    }
}

/// `AttachCatalogInput` in `lib/vendorMappingRepo.ts`.
public struct AttachCatalogInput: Sendable, Equatable {
    public let masterId: String
    public let catalogKey: CatalogKey

    public init(masterId: String, catalogKey: CatalogKey) {
        self.masterId = masterId
        self.catalogKey = catalogKey
    }
}

/// Typed mirror of `VendorMappingRejectedError` (web carries an HTTP status;
/// native has no HTTP layer — a DELIBERATE divergence asserted in tests):
///   .validation ↔ 422, .conflict ↔ 409, .notFound ↔ 404.
/// Rule failures are thrown BEFORE any write/audit (audited-write ordering).
public enum VendorMappingWriteError: Error, LocalizedError, Sendable, Equatable {
    case validation(String)   // web 422
    case conflict(String)     // web 409
    case notFound(String)     // web 404
    case persistenceFailed

    public var errorDescription: String? {
        switch self {
        case .validation(let m), .conflict(let m), .notFound(let m): return m
        case .persistenceFailed: return "Could not save vendor link"
        }
    }
}

// ── orderGuideEnrichment.ts (purchasing hub) ────────────────────────────────

/// `OrderGuideRow` in `lib/orderGuideEnrichment.ts` — the raw
/// `order_guide_items` projection from `app/purchasing/page.jsx`.
public struct OrderGuideItemRow: Decodable, FetchableRecord, Sendable, Equatable {
    public let ingredient: String
    public let baseQty: Double?
    public let unit: String?
    public let vendor: String?
    public let unitPrice: Double?   // REAL dollars

    enum CodingKeys: String, CodingKey {
        case ingredient, unit, vendor,
             baseQty = "base_qty", unitPrice = "unit_price"
    }

    public init(ingredient: String, baseQty: Double?, unit: String?, vendor: String?, unitPrice: Double?) {
        self.ingredient = ingredient
        self.baseQty = baseQty
        self.unit = unit
        self.vendor = vendor
        self.unitPrice = unitPrice
    }
}

/// `OrderGuideEnrichment` in `lib/orderGuideEnrichment.ts`.
public struct OrderGuideEnrichment: Sendable, Equatable {
    public let preferredVendor: String?
    public let qualityLocked: Bool
    public let qualityLockReason: String?
    public let vendorMismatch: Bool

    public init(preferredVendor: String?, qualityLocked: Bool, qualityLockReason: String?, vendorMismatch: Bool) {
        self.preferredVendor = preferredVendor
        self.qualityLocked = qualityLocked
        self.qualityLockReason = qualityLockReason
        self.vendorMismatch = vendorMismatch
    }
}

/// One enriched hub row — `enrichOrderGuideRows` output element. `id` is the
/// fetch-order index (the web page keys rows by array index too).
public struct EnrichedOrderGuideRow: Sendable, Equatable, Identifiable {
    public let id: Int
    public let row: OrderGuideItemRow
    public let enrichment: OrderGuideEnrichment?

    public init(id: Int, row: OrderGuideItemRow, enrichment: OrderGuideEnrichment?) {
        self.id = id
        self.row = row
        self.enrichment = enrichment
    }
}

/// The purchasing hub bundle (`app/purchasing/page.jsx`): the 200-row table
/// plus the un-limited COUNT(*) headline.
public struct OrderGuideSummary: Sendable, Equatable {
    public let totalCount: Int
    public let rows: [EnrichedOrderGuideRow]

    public init(totalCount: Int, rows: [EnrichedOrderGuideRow]) {
        self.totalCount = totalCount
        self.rows = rows
    }
}
