import Foundation
import GRDB

// Records for the inventory LOG + WASTE boards (A4.1). Column names/types match
// the EXISTING web schema (`inventory_updates` in lib/db.ts ~L1029) — no
// migration. Parity targets:
//   app/api/inventory/route.ts        (GET log + POST update, incl. T8 shrinkage)
//   app/inventory/log/page.jsx        (log view — today's rows, newest first)
//   app/inventory/waste/page.jsx      (waste view — direction='waste', range window)
//
// Invariants (from the web route):
//   - `delta` is a free-text string column (e.g. "-10.667 oz", "half a bunch");
//     the T8 depletion path formats it, non-toast callers pass it verbatim
//   - shrinkage math fires ONLY when source='toast' (see InventoryShrinkage)
//   - NO PIN gate on /inventory; writes audited (actor_source native_cook, web 'api')
//   - quantities are free-text/REAL — NOT currency
//
// The row type is `InventoryUpdateRow` — already defined in ReceivingRecords.swift
// (the receiving board reuses `inventory_updates` for closed-loop crediting), so
// this file reuses it rather than redeclaring. The log/waste SELECTs omit the
// receiving-only columns (master_id, receiving_log_id); GRDB maps the absent
// optional columns to nil.

/// The waste `byItem` rollup — count of waste hits per item over the window.
public struct WasteByItemRow: Codable, FetchableRecord, Identifiable, Sendable, Equatable {
    public let item: String
    public let hits: Int
    public let lastAt: String?

    public var id: String { item }

    enum CodingKeys: String, CodingKey {
        case item, hits
        case lastAt = "last_at"
    }

    public init(item: String, hits: Int, lastAt: String?) {
        self.item = item; self.hits = hits; self.lastAt = lastAt
    }
}

/// Log-an-update input — mirrors the `POST /api/inventory` body. `qty` is the
/// cooked qty when `source == "toast"`; non-toast callers pass a free-text `delta`.
public struct InventoryLogInput: Sendable, Equatable {
    public let item: String?
    public let qty: Double?
    public let unit: String?
    public let delta: String?
    public let direction: String?
    public let source: String?
    public let recipeId: String?
    public let ingredient: String?
    public let note: String?
    public let stationId: String?
    public let shiftDate: String?

    public init(item: String?, qty: Double? = nil, unit: String? = nil, delta: String? = nil, direction: String? = nil, source: String? = nil, recipeId: String? = nil, ingredient: String? = nil, note: String? = nil, stationId: String? = nil, shiftDate: String? = nil) {
        self.item = item; self.qty = qty; self.unit = unit; self.delta = delta
        self.direction = direction; self.source = source; self.recipeId = recipeId
        self.ingredient = ingredient; self.note = note; self.stationId = stationId
        self.shiftDate = shiftDate
    }
}

/// Result of a log write — mirrors the web response
/// `{ id, source, delta, shrinkage_applied, shrinkage_reason, raw_qty }`.
public struct InventoryLogResult: Sendable, Equatable {
    public let id: Int64
    public let source: String
    public let delta: String?
    public let shrinkageApplied: Bool
    public let shrinkageReason: String?
    public let rawQty: Double?

    public init(id: Int64, source: String, delta: String?, shrinkageApplied: Bool, shrinkageReason: String?, rawQty: Double?) {
        self.id = id; self.source = source; self.delta = delta
        self.shrinkageApplied = shrinkageApplied; self.shrinkageReason = shrinkageReason; self.rawQty = rawQty
    }
}

public enum InventoryUpdateWriteError: Error, LocalizedError, Equatable {
    case itemRequired
    case persistenceFailed

    public var errorDescription: String? {
        switch self {
        case .itemRequired: return "Item is required"
        case .persistenceFailed: return "Could not save inventory update"
        }
    }
}
