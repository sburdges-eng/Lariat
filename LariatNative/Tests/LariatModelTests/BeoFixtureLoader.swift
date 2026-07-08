// BeoFixtureLoader — decodes the golden BeoCascade parity fixtures under
// Tests/Fixtures/BeoCascade/*.json (the Python->Swift oracle for beo_pull +
// beo_cascade). Located via #filePath, like BomExpandFixtureLoader.

import Foundation
import XCTest
@testable import LariatModel

// MARK: - Heterogeneous JSON-array rows

/// `[slug, qty, unit]`
struct BeoDemandTriple: Decodable {
    let slug: String
    let qty: Double
    let unit: String
    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        slug = try c.decode(String.self)
        qty = try c.decode(Double.self)
        unit = try c.decode(String.self)
    }
}

/// `[menu_item, qty]`
struct BeoInvoiceEntry: Decodable {
    let menuItem: String
    let qty: Double
    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        menuItem = try c.decode(String.self)
        qty = try c.decode(Double.self)
    }
}

/// `{item_name, quantity}`
struct BeoLineItem: Decodable {
    let itemName: String
    let quantity: Double
    enum CodingKeys: String, CodingKey {
        case itemName = "item_name"
        case quantity
    }
}

/// `[ingredient, unit, on_hand]`
struct BeoInventoryEntry: Decodable {
    let ingredient: String
    let unit: String
    let onHand: Double
    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        ingredient = try c.decode(String.self)
        unit = try c.decode(String.self)
        onHand = try c.decode(Double.self)
    }
}

/// `[name_key, slug, factor]`
struct BeoScaleEntry: Decodable {
    let nameKey: String
    let slug: String
    let factor: Double
    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        nameKey = try c.decode(String.self)
        slug = try c.decode(String.self)
        factor = try c.decode(Double.self)
    }
}

/// `[menu_item, reason]`
struct BeoUnmappedPair: Decodable {
    let menuItem: String
    let reason: String
    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        menuItem = try c.decode(String.self)
        reason = try c.decode(String.self)
    }
}

/// `{ingredient, unit, total_needed, on_hand, to_order}`
struct BeoOrderGuideRow: Decodable {
    let ingredient: String
    let unit: String
    let totalNeeded: Double
    let onHand: Double
    let toOrder: Double
    enum CodingKeys: String, CodingKey {
        case ingredient, unit
        case totalNeeded = "total_needed"
        case onHand = "on_hand"
        case toOrder = "to_order"
    }
}

/// `{recipe_slug, display_name, qty, unit}`
struct BeoPrepRow: Decodable {
    let recipeSlug: String
    let displayName: String
    let qty: Double
    let unit: String
    enum CodingKeys: String, CodingKey {
        case recipeSlug = "recipe_slug"
        case displayName = "display_name"
        case qty, unit
    }
}

// MARK: - Fixture structure

struct BeoInput: Decodable {
    let mode: String
    let invoice: [BeoInvoiceEntry]?
    let lineItems: [BeoLineItem]?
    let inventory: [BeoInventoryEntry]?
    let qtyInYieldUnits: Bool?
    let samples: [String?]?
    enum CodingKeys: String, CodingKey {
        case mode, invoice, inventory, samples
        case lineItems = "line_items"
        case qtyInYieldUnits = "qty_in_yield_units"
    }
}

struct BeoExpect: Decodable {
    let demand: [BeoDemandTriple]?
    let unmapped: [BeoUnmappedPair]?
    let demandBySlug: [String: Double]?
    let demandSlugs: [String]?
    let unmappedCount: Int?
    let normalized: [String]?
    let orderGuide: [BeoOrderGuideRow]?
    let orderGuideByIngredient: [String: BeoOrderGuideRow]?
    let romaTomatoesTotal: Double?
    let whiteCheeseTotal: Double?
    let prepDemands: [BeoPrepRow]?
    let slugs: [String]?
    let unmappedMenuItems: [String]?
    let warnings: [String]?
    let warningsContain: String?
    let romaRow: BeoOrderGuideRow?
    let tolerancePlaces: Int?
    enum CodingKeys: String, CodingKey {
        case demand, unmapped, normalized, slugs, warnings
        case demandBySlug = "demand_by_slug"
        case demandSlugs = "demand_slugs"
        case unmappedCount = "unmapped_count"
        case orderGuide = "order_guide"
        case orderGuideByIngredient = "order_guide_by_ingredient"
        case romaTomatoesTotal = "roma_tomatoes_total"
        case whiteCheeseTotal = "white_cheese_total"
        case prepDemands = "prep_demands"
        case unmappedMenuItems = "unmapped_menu_items"
        case warningsContain = "warnings_contain"
        case romaRow = "roma_row"
        case tolerancePlaces = "tolerance_places"
    }
}

struct BeoFixture: Decodable {
    let schemaVersion: Int
    let id: String
    let module: String
    let manifest: [String: RecipeManifest]?
    let beoMap: [String: [String]]?
    let scales: [BeoScaleEntry]?
    let input: BeoInput
    let expect: BeoExpect
    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case id, module, manifest, input, expect, scales
        case beoMap = "beo_map"
    }
}

// MARK: - Loader + input adapters

enum BeoFixtures {
    static var directory: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()   // Tests/LariatModelTests
            .deletingLastPathComponent()   // Tests
            .appendingPathComponent("Fixtures")
            .appendingPathComponent("BeoCascade")
    }

    static func load(_ id: String) throws -> BeoFixture {
        let url = directory.appendingPathComponent("\(id).json")
        return try JSONDecoder().decode(BeoFixture.self, from: Data(contentsOf: url))
    }

    static func manifest(_ f: BeoFixture) -> [String: RecipeManifest] { f.manifest ?? [:] }
    static func beoMap(_ f: BeoFixture) -> [String: [String]] { f.beoMap ?? [:] }

    static func invoiceRows(_ f: BeoFixture) -> [InvoiceRow] {
        (f.input.invoice ?? []).map { InvoiceRow(menuItem: $0.menuItem, qty: $0.qty) }
    }

    static func lineItems(_ f: BeoFixture) -> [(String, Double)] {
        (f.input.lineItems ?? []).map { ($0.itemName, $0.quantity) }
    }

    static func scalesDict(_ f: BeoFixture) -> [BeoScaleKey: Double]? {
        guard let scales = f.scales else { return nil }
        var out: [BeoScaleKey: Double] = [:]
        for e in scales { out[BeoScaleKey(nameKey: e.nameKey, slug: e.slug)] = e.factor }
        return out
    }

    static func inventoryDict(_ f: BeoFixture) -> [BomKey: Double]? {
        guard let entries = f.input.inventory else { return nil }
        var out: [BomKey: Double] = [:]
        for e in entries {
            let ing = e.ingredient.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let unit = e.unit.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            out[BomKey(ing, unit)] = e.onHand
        }
        return out
    }
}
