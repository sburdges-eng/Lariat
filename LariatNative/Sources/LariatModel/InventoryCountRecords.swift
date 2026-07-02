import Foundation
import GRDB

// Records for the inventory COUNTS board (A4.1). Column names/types match the
// EXISTING web schema (`inventory_counts` / `inventory_count_lines` in lib/db.ts
// ~L1051) — no migration. Parity targets:
//   app/api/inventory/counts/route.js            (list + open)
//   app/api/inventory/counts/[id]/route.js       (detail + close/reopen)
//   app/api/inventory/counts/[id]/lines/route.js (line upsert)
//
// Invariants (from the web routes):
//   - lines upsert by (count_id, ingredient, sku); `sku` is empty-string-not-NULL
//     (load-bearing for UNIQUE(count_id, ingredient, sku))
//   - `ingredient` is stored as its canonical `IngredientKey.normalize` form so
//     cross-cook capitalization ("Chicken Stock" / "chicken stock") can't split
//     one ingredient into two count rows
//   - a line can only be written while the count is open (`closed_at IS NULL`)
//   - NO PIN gate on /inventory (unregulated relative to safety/labor)
//   - quantities are REAL (`Double?`) — NOT currency; no money math

/// One count header as projected by the LIST endpoint (with its line tally).
/// Mirrors `GET /api/inventory/counts`.
public struct InventoryCountSummary: Codable, FetchableRecord, Identifiable, Sendable, Equatable {
    public let id: Int64
    public let countDate: String
    public let label: String?
    public let openedAt: String?
    public let closedAt: String?
    public let cookId: String?
    public let lineCount: Int

    enum CodingKeys: String, CodingKey {
        case id
        case countDate = "count_date"
        case label
        case openedAt = "opened_at"
        case closedAt = "closed_at"
        case cookId = "cook_id"
        case lineCount = "line_count"
    }

    public var isOpen: Bool { closedAt == nil }

    public init(id: Int64, countDate: String, label: String?, openedAt: String?, closedAt: String?, cookId: String?, lineCount: Int) {
        self.id = id; self.countDate = countDate; self.label = label
        self.openedAt = openedAt; self.closedAt = closedAt; self.cookId = cookId
        self.lineCount = lineCount
    }
}

/// The count header returned by the DETAIL endpoint. Mirrors the `count` field of
/// `GET /api/inventory/counts/[id]`.
public struct InventoryCountRow: Codable, FetchableRecord, Identifiable, Sendable, Equatable {
    public let id: Int64
    public let countDate: String
    public let label: String?
    public let openedAt: String?
    public let closedAt: String?
    public let cookId: String?

    enum CodingKeys: String, CodingKey {
        case id
        case countDate = "count_date"
        case label
        case openedAt = "opened_at"
        case closedAt = "closed_at"
        case cookId = "cook_id"
    }

    public var isOpen: Bool { closedAt == nil }

    public init(id: Int64, countDate: String, label: String?, openedAt: String?, closedAt: String?, cookId: String?) {
        self.id = id; self.countDate = countDate; self.label = label
        self.openedAt = openedAt; self.closedAt = closedAt; self.cookId = cookId
    }
}

/// One counted line. Mirrors the `lines` projection of `GET /api/inventory/counts/[id]`.
public struct InventoryCountLine: Codable, FetchableRecord, Identifiable, Sendable, Equatable {
    public let id: Int64
    public let vendor: String?
    public let ingredient: String
    public let sku: String
    public let onHandQty: Double?
    public let unit: String?
    public let parQty: Double?
    public let parUnit: String?
    public let note: String?
    public let countedBy: String?
    public let countedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, vendor, ingredient, sku
        case onHandQty = "on_hand_qty"
        case unit
        case parQty = "par_qty"
        case parUnit = "par_unit"
        case note
        case countedBy = "counted_by"
        case countedAt = "counted_at"
    }

    public init(id: Int64, vendor: String?, ingredient: String, sku: String, onHandQty: Double?, unit: String?, parQty: Double?, parUnit: String?, note: String?, countedBy: String?, countedAt: String?) {
        self.id = id; self.vendor = vendor; self.ingredient = ingredient; self.sku = sku
        self.onHandQty = onHandQty; self.unit = unit; self.parQty = parQty; self.parUnit = parUnit
        self.note = note; self.countedBy = countedBy; self.countedAt = countedAt
    }
}

/// A count header + its lines (the detail-view payload).
public struct InventoryCountDetail: Sendable, Equatable {
    public let head: InventoryCountRow
    public let lines: [InventoryCountLine]
    public init(head: InventoryCountRow, lines: [InventoryCountLine]) {
        self.head = head; self.lines = lines
    }
}

/// Open-a-count input — mirrors the `POST /api/inventory/counts` body.
public struct InventoryCountOpenInput: Sendable, Equatable {
    public let label: String?
    public let cookId: String?
    public let countDate: String?
    public init(label: String? = nil, cookId: String? = nil, countDate: String? = nil) {
        self.label = label; self.cookId = cookId; self.countDate = countDate
    }
}

/// Upsert-a-line input — mirrors the `POST .../lines` body. The actor (cook id)
/// comes from the write context, matching how the other native boards tag writes.
public struct InventoryCountLineInput: Sendable, Equatable {
    public let ingredient: String?
    public let sku: String?
    public let vendor: String?
    public let onHandQty: Double?
    public let unit: String?
    public let parQty: Double?
    public let parUnit: String?
    public let note: String?
    public init(ingredient: String?, sku: String? = nil, vendor: String? = nil, onHandQty: Double? = nil, unit: String? = nil, parQty: Double? = nil, parUnit: String? = nil, note: String? = nil) {
        self.ingredient = ingredient; self.sku = sku; self.vendor = vendor
        self.onHandQty = onHandQty; self.unit = unit; self.parQty = parQty
        self.parUnit = parUnit; self.note = note
    }
}

public enum InventoryCountWriteError: Error, LocalizedError, Equatable {
    case badId
    case ingredientRequired
    case countNotFound
    case countClosed
    case notFound
    case persistenceFailed

    public var errorDescription: String? {
        switch self {
        case .badId: return "Invalid count id"
        case .ingredientRequired: return "Ingredient is required"
        case .countNotFound: return "Count not found"
        case .countClosed: return "Count is closed"
        case .notFound: return "Count not found"
        case .persistenceFailed: return "Could not save count"
        }
    }
}
