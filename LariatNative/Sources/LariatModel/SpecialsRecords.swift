import Foundation
import GRDB

// Record types for the saved-specials board (`specials`,
// `specials_promotions` — schema owned by the web app in `lib/db.ts`).

/// Full `specials` row (`SELECT *` shape of the detail route).
public struct SpecialRecord: Codable, FetchableRecord, Sendable, Equatable {
    public let id: String
    public let locationId: String
    public let name: String
    public let pantryText: String
    public let promptText: String
    public let aiAnswer: String
    public let aiModel: String
    public let costBreakdown: String?
    public let costTotal: Double?
    public let scratchNotes: String
    public let sources: String?
    public let lastExportedAt: Int64?
    public let createdAt: Int64
    public let updatedAt: Int64
    public let archivedAt: Int64?

    enum CodingKeys: String, CodingKey {
        case id
        case locationId = "location_id"
        case name
        case pantryText = "pantry_text"
        case promptText = "prompt_text"
        case aiAnswer = "ai_answer"
        case aiModel = "ai_model"
        case costBreakdown = "cost_breakdown"
        case costTotal = "cost_total"
        case scratchNotes = "scratch_notes"
        case sources
        case lastExportedAt = "last_exported_at"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case archivedAt = "archived_at"
    }
}

/// One list row — the saved-specials index page shape (`/specials/saved`
/// server query: active rows newest-first LEFT JOINed to promotions).
public struct SpecialListItem: Codable, FetchableRecord, Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let costTotal: Double?
    public let lastExportedAt: Int64?
    public let createdAt: Int64
    /// Raw `ai_answer` from SQL; expose `snippet` for display parity.
    public let aiAnswer: String
    public let promotedMenuItem: String?
    public let promotedAt: Int64?

    enum CodingKeys: String, CodingKey {
        case id, name
        case costTotal = "cost_total"
        case lastExportedAt = "last_exported_at"
        case createdAt = "created_at"
        case aiAnswer = "ai_answer"
        case promotedMenuItem = "promoted_menu_item"
        case promotedAt = "promoted_at"
    }

    /// 120-char whitespace-collapsed preview (route `snippet()` parity).
    public var snippet: String { SpecialsValidators.snippet(aiAnswer) }
}

/// One `specials_promotions` row (`lib/specialsPromotion.ts PromotionRecord`).
public struct SpecialsPromotionRecord: Codable, FetchableRecord, Sendable, Equatable {
    public let id: Int64
    public let specialId: String
    public let locationId: String
    public let menuItemName: String
    public let servings: Double
    public let componentsJson: String
    public let promotedAt: Int64
    public let updatedAt: Int64

    enum CodingKeys: String, CodingKey {
        case id
        case specialId = "special_id"
        case locationId = "location_id"
        case menuItemName = "menu_item_name"
        case servings
        case componentsJson = "components_json"
        case promotedAt = "promoted_at"
        case updatedAt = "updated_at"
    }

    public init(
        id: Int64, specialId: String, locationId: String, menuItemName: String,
        servings: Double, componentsJson: String, promotedAt: Int64, updatedAt: Int64
    ) {
        self.id = id
        self.specialId = specialId
        self.locationId = locationId
        self.menuItemName = menuItemName
        self.servings = servings
        self.componentsJson = componentsJson
        self.promotedAt = promotedAt
        self.updatedAt = updatedAt
    }
}

/// One `cost_breakdown` line as produced by the web sandbox costing.
/// Tolerant shape — every field optional, mirroring the web's defensive reads.
public struct CostBreakdownLine: Sendable, Equatable {
    public let item: String?
    public let reqQty: Double?
    /// JS-stringified raw qty for CSV parity (`String(2)` → "2", absent → nil).
    public let reqQtyString: String?
    public let reqUnit: String?
    public let match: String?
    public let cost: Double?
    /// Web `cost !== null && cost !== undefined` — the export "matched" check
    /// counts a cost of ANY JSON type (including a string like "1.23").
    public let costPresent: Bool
    public let note: String?

    public init(
        item: String? = nil, reqQty: Double? = nil, reqQtyString: String? = nil,
        reqUnit: String? = nil, match: String? = nil, cost: Double? = nil,
        costPresent: Bool? = nil, note: String? = nil
    ) {
        self.item = item
        self.reqQty = reqQty
        self.reqQtyString = reqQtyString ?? reqQty.map(JsValueFormat.numberString)
        self.reqUnit = reqUnit
        self.match = match
        self.cost = cost
        self.costPresent = costPresent ?? (cost != nil)
        self.note = note
    }

    /// `parseBreakdown` — `[]` for nil / malformed / non-array JSON.
    /// cost_breakdown is client-supplied JSON validated only for parseability,
    /// so field TYPES are untrusted: the web coerces (`Number(line?.req_qty)`
    /// promotes "2"; export emits `String(req_qty ?? '')`). Mirror exactly.
    public static func parse(_ raw: String?) -> [CostBreakdownLine] {
        guard let raw, let data = raw.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data),
              let array = parsed as? [Any]
        else { return [] }
        return array.map { element in
            let dict = element as? [String: Any] ?? [:]
            let costRaw = dict["cost"]
            return CostBreakdownLine(
                item: dict["item"] as? String,
                reqQty: jsNumber(dict["req_qty"]),
                reqQtyString: jsDisplayString(dict["req_qty"]),
                reqUnit: dict["req_unit"] as? String,
                match: dict["match"] as? String,
                cost: (costRaw as? NSNumber).flatMap {
                    CFGetTypeID($0) == CFBooleanGetTypeID() ? nil : $0.doubleValue
                },
                costPresent: costRaw != nil && !(costRaw is NSNull),
                note: dict["note"] as? String
            )
        }
    }

    /// JS `Number(value)` for the shapes JSONSerialization produces.
    /// nil result stands in for NaN (`reqQty ?? .nan` at the consumer).
    private static func jsNumber(_ value: Any?) -> Double? {
        switch value {
        case nil: return nil                       // Number(undefined) → NaN
        case is NSNull: return 0                   // Number(null) → 0
        case let n as NSNumber:
            if CFGetTypeID(n) == CFBooleanGetTypeID() { return n.boolValue ? 1 : 0 }
            return n.doubleValue
        case let s as String:
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            if t.isEmpty { return 0 }              // Number("") → 0
            return Double(t)                       // unparseable → nil (NaN)
        default: return nil                        // arrays/objects → NaN
        }
    }

    /// JS `String(value ?? '')` — the export CSV qty column.
    private static func jsDisplayString(_ value: Any?) -> String? {
        switch value {
        case nil, is NSNull: return nil            // `?? ''` at the consumer
        case let s as String: return s
        case let n as NSNumber:
            if CFGetTypeID(n) == CFBooleanGetTypeID() { return n.boolValue ? "true" : "false" }
            return JsValueFormat.numberString(n.doubleValue)
        default: return nil
        }
    }
}

/// One promoted per-serving vendor component (`PromotedComponent`).
public struct PromotedComponent: Sendable, Equatable {
    public var vendorIngredient: String
    public var qtyPerServing: Double
    public var unit: String

    public init(vendorIngredient: String, qtyPerServing: Double, unit: String) {
        self.vendorIngredient = vendorIngredient
        self.qtyPerServing = qtyPerServing
        self.unit = unit
    }

    /// `JSON.stringify(components)` parity for the `components_json` column —
    /// key order and JS number formatting match the web writer.
    public static func componentsJson(_ components: [PromotedComponent]) -> String {
        let body = components.map { c in
            "{\"vendor_ingredient\":\(JsValueFormat.jsonString(c.vendorIngredient)),"
                + "\"qty_per_serving\":\(JsValueFormat.numberString(c.qtyPerServing)),"
                + "\"unit\":\(JsValueFormat.jsonString(c.unit))}"
        }.joined(separator: ",")
        return "[\(body)]"
    }

    /// Parse a stored `components_json` (prior promotion) — `[]` on failure.
    public static func parseComponentsJson(_ raw: String) -> [PromotedComponent] {
        guard let data = raw.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data),
              let array = parsed as? [[String: Any]]
        else { return [] }
        return array.compactMap { dict in
            guard let ingredient = dict["vendor_ingredient"] as? String else { return nil }
            return PromotedComponent(
                vendorIngredient: ingredient,
                qtyPerServing: (dict["qty_per_serving"] as? NSNumber)?.doubleValue ?? 0,
                unit: dict["unit"] as? String ?? ""
            )
        }
    }
}

/// A skipped cost-breakdown line (`SkippedComponent`).
public struct SkippedComponent: Sendable, Equatable {
    public enum Reason: String, Sendable {
        case unmatched
        case invalidQty = "invalid_qty"
        case unitConflict = "unit_conflict"
    }

    public let item: String
    public let reason: Reason

    public init(item: String, reason: Reason) {
        self.item = item
        self.reason = reason
    }
}

/// Create-input for `POST /api/specials/saved` (validated by the repository).
public struct SpecialDraft: Sendable {
    public var name: String
    public var pantryText: String
    public var promptText: String
    public var aiAnswer: String
    public var aiModel: String
    public var costBreakdownJson: String?
    public var costTotal: Double?
    public var scratchNotes: String
    public var sourcesJson: String?

    public init(
        name: String, pantryText: String = "", promptText: String = "",
        aiAnswer: String = "", aiModel: String = "", costBreakdownJson: String? = nil,
        costTotal: Double? = nil, scratchNotes: String = "", sourcesJson: String? = nil
    ) {
        self.name = name
        self.pantryText = pantryText
        self.promptText = promptText
        self.aiAnswer = aiAnswer
        self.aiModel = aiModel
        self.costBreakdownJson = costBreakdownJson
        self.costTotal = costTotal
        self.scratchNotes = scratchNotes
        self.sourcesJson = sourcesJson
    }
}
