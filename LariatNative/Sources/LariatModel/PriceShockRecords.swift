import Foundation

/// Options for `PriceShockCompute` / `PriceShockRepository.load` — mirrors
/// `vendorPricesRepo.ts:428-444` (`listPriceShocks` option normalization).
/// This is the REPO-layer clamp: invalid/negative `minPctMove` falls back to
/// the default (5), unlike the API route's `asNum(v, 5, 0, 1000)` clamp which
/// maps negative values to 0. See `PriceShockComputeTests.testOptionClamps`.
public struct PriceShockOptions: Sendable {
    public let locationId: String
    public let windowDays: Int      // clamp [1,90], default 7
    public let minPctMove: Double   // clamp [0,1000], default 5
    public let limit: Int           // clamp [1,500], default 50

    public init(locationId: String = "default", windowDays: Int? = nil, minPctMove: Double? = nil, limit: Int? = nil) {
        let loc = locationId.trimmingCharacters(in: .whitespaces)
        self.locationId = loc.isEmpty ? "default" : loc
        if let w = windowDays, w > 0 { self.windowDays = min(90, max(1, w)) } else { self.windowDays = 7 }
        if let m = minPctMove, m >= 0 { self.minPctMove = min(1000, m) } else { self.minPctMove = 5 }
        if let l = limit, l > 0 { self.limit = min(500, l) } else { self.limit = 50 }
    }
}

/// One UNION row (either `vendor_prices_history` or `vendor_prices`) handed
/// in by the repository, pre-sorted `vendor, sku, ingredient, snapshot_at ASC,
/// source_order ASC, row_order ASC` (mirrors `vendorPricesRepo.ts:471-482`).
public struct PriceShockInput: Sendable {
    public let vendor: String
    public let sku: String
    public let ingredient: String
    public let category: String?
    public let snapshotAt: String
    public let unitPrice: Double

    public init(vendor: String, sku: String, ingredient: String, category: String?, snapshotAt: String, unitPrice: Double) {
        self.vendor = vendor
        self.sku = sku
        self.ingredient = ingredient
        self.category = category
        self.snapshotAt = snapshotAt
        self.unitPrice = unitPrice
    }
}

/// One live `vendor_prices` row used to overlay the latest comparison point
/// (mirrors `vendorPricesRepo.ts:551-571`).
public struct PriceShockLive: Sendable {
    public let vendor: String
    public let sku: String
    public let ingredient: String
    public let category: String?
    public let unitPrice: Double
    public let importedAt: String?

    public init(vendor: String, sku: String, ingredient: String, category: String?, unitPrice: Double, importedAt: String?) {
        self.vendor = vendor
        self.sku = sku
        self.ingredient = ingredient
        self.category = category
        self.unitPrice = unitPrice
        self.importedAt = importedAt
    }
}

public enum PriceShockDirection: String, Sendable, Equatable {
    case up, down
}

/// One resolved price-shock row. `Identifiable` so `PriceShocksView` can key
/// a `.sheet(item:)` presentation off a selected row for the drill-down.
public struct PriceShockRow: Sendable, Equatable, Identifiable {
    public let vendor: String
    public let sku: String
    public let ingredient: String
    public let category: String?
    public let baselineUnitPrice: Double
    public let baselineAt: String
    public let latestUnitPrice: Double
    public let latestAt: String
    public let deltaPct: Double
    public let direction: PriceShockDirection

    public var id: String { "\(vendor)|\(sku)|\(ingredient)" }

    public init(
        vendor: String, sku: String, ingredient: String, category: String?,
        baselineUnitPrice: Double, baselineAt: String,
        latestUnitPrice: Double, latestAt: String,
        deltaPct: Double, direction: PriceShockDirection
    ) {
        self.vendor = vendor
        self.sku = sku
        self.ingredient = ingredient
        self.category = category
        self.baselineUnitPrice = baselineUnitPrice
        self.baselineAt = baselineAt
        self.latestUnitPrice = latestUnitPrice
        self.latestAt = latestAt
        self.deltaPct = deltaPct
        self.direction = direction
    }
}

// MARK: - Price series (drill-down)

/// Options for `PriceShockRepository.series` — mirrors
/// `vendorPricesRepo.ts:319-338` (`listPriceSeries` option normalization).
public struct PriceSeriesOptions: Sendable {
    public let vendor: String
    public let sku: String
    public let locationId: String
    public let limit: Int   // clamp [1,1000], default 100

    public init(vendor: String, sku: String, locationId: String = "default", limit: Int? = nil) {
        self.vendor = vendor.trimmingCharacters(in: .whitespaces)
        self.sku = sku.trimmingCharacters(in: .whitespaces)
        let loc = locationId.trimmingCharacters(in: .whitespaces)
        self.locationId = loc.isEmpty ? "default" : loc
        if let l = limit, l > 0 { self.limit = min(1000, l) } else { self.limit = 100 }
    }

    /// Blank vendor or sku -> the caller returns `[]` (mirrors
    /// `vendorPricesRepo.ts:325`, "the caller may query on a blank field from
    /// the UI").
    public var isBlank: Bool { vendor.isEmpty || sku.isEmpty }
}

/// One `vendor_prices_history` snapshot row for the single-SKU drill-down.
/// `unitPrice` is nullable in schema (`REAL`, no `NOT NULL`), so it must stay
/// `Double?` here — a nil endpoint means "no delta" rather than crashing.
public struct PriceSeriesPoint: Sendable, Equatable {
    public let snapshotAt: String
    public let runId: Int?
    public let unitPrice: Double?
    public let packPrice: Double?
    public let packSize: Double?
    public let packUnit: String?

    public init(
        snapshotAt: String, runId: Int? = nil, unitPrice: Double?,
        packPrice: Double?, packSize: Double?, packUnit: String?
    ) {
        self.snapshotAt = snapshotAt
        self.runId = runId
        self.unitPrice = unitPrice
        self.packPrice = packPrice
        self.packSize = packSize
        self.packUnit = packUnit
    }
}

/// The drill-down result: the ordered snapshot series plus the derived
/// first-to-last % delta (display-only; no rounding here).
public struct PriceSeriesResult: Sendable, Equatable {
    public let points: [PriceSeriesPoint]
    public let deltaPct: Double?

    public init(points: [PriceSeriesPoint]) {
        self.points = points
        self.deltaPct = PriceSeriesCompute.summarize(points: points)
    }
}
