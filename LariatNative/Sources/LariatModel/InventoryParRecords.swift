import Foundation
import GRDB

// Records for the inventory PAR board (A4.1). Column names/types match the
// EXISTING web schema (`inventory_par` in `lib/db.ts` ~L1087) — no migration.
// Parity target: `app/api/inventory/par/route.js` (+ the par-page latest-count
// LEFT JOIN). Quantities are REAL (`Double?`) — NOT currency; no money math.
//
// Invariants (from the web route): `sku` is empty-string-not-NULL (load-bearing
// for UNIQUE(location_id, ingredient, sku) and the COALESCE(sku,'') join key);
// upsert is by (location_id, ingredient, sku); NO PIN gate on /inventory.

/// A standing par row. Mirrors the GET projection + the upsert columns.
public struct InventoryParRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let vendor: String?
    public let ingredient: String
    public let sku: String
    public let parQty: Double?
    public let parUnit: String?
    public let packSize: String?
    public let packUnit: String?
    public let category: String?
    public let note: String?
    public let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, vendor, ingredient, sku
        case parQty = "par_qty"
        case parUnit = "par_unit"
        case packSize = "pack_size"
        case packUnit = "pack_unit"
        case category, note
        case updatedAt = "updated_at"
    }

    public init(
        id: Int64, vendor: String?, ingredient: String, sku: String, parQty: Double?,
        parUnit: String?, packSize: String?, packUnit: String?, category: String?,
        note: String?, updatedAt: String?
    ) {
        self.id = id; self.vendor = vendor; self.ingredient = ingredient; self.sku = sku
        self.parQty = parQty; self.parUnit = parUnit; self.packSize = packSize
        self.packUnit = packUnit; self.category = category; self.note = note
        self.updatedAt = updatedAt
    }
}

/// A par row joined to its latest counted on-hand (par-page LEFT JOIN). `onHandQty`
/// is nil when the item has never been counted. `isLow` per `InventoryParCompute`.
public struct InventoryParWithOnHand: Sendable, Identifiable, Equatable {
    public let par: InventoryParRow
    public let onHandQty: Double?
    public let onHandUnit: String?
    public let countedAt: String?
    public let countedBy: String?

    public var id: Int64 { par.id }
    public var isLow: Bool { InventoryParCompute.isLowPar(parQty: par.parQty, onHand: onHandQty) }

    public init(par: InventoryParRow, onHandQty: Double?, onHandUnit: String?, countedAt: String?, countedBy: String?) {
        self.par = par; self.onHandQty = onHandQty; self.onHandUnit = onHandUnit
        self.countedAt = countedAt; self.countedBy = countedBy
    }
}

/// Upsert input — mirrors the web POST body (all optional except ingredient).
public struct InventoryParUpsertInput: Sendable, Equatable {
    public let ingredient: String?
    public let sku: String?
    public let vendor: String?
    public let parQty: Double?
    public let parUnit: String?
    public let packSize: String?
    public let packUnit: String?
    public let category: String?
    public let note: String?

    public init(
        ingredient: String?, sku: String? = nil, vendor: String? = nil, parQty: Double? = nil,
        parUnit: String? = nil, packSize: String? = nil, packUnit: String? = nil,
        category: String? = nil, note: String? = nil
    ) {
        self.ingredient = ingredient; self.sku = sku; self.vendor = vendor; self.parQty = parQty
        self.parUnit = parUnit; self.packSize = packSize; self.packUnit = packUnit
        self.category = category; self.note = note
    }
}

/// Result of an upsert — mirrors the web `{ id, isInsert }`.
public struct InventoryParUpsertResult: Sendable, Equatable {
    public let id: Int64
    public let isInsert: Bool
    public init(id: Int64, isInsert: Bool) { self.id = id; self.isInsert = isInsert }
}

public enum InventoryParWriteError: Error, LocalizedError, Equatable {
    case ingredientRequired
    case badId
    case notFound
    case persistenceFailed

    public var errorDescription: String? {
        switch self {
        case .ingredientRequired: return "Ingredient is required"
        case .badId: return "Invalid id"
        case .notFound: return "Par row not found"
        case .persistenceFailed: return "Could not save par row"
        }
    }
}
