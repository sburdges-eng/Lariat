// BomExpandTypes — data model for the in-process BOM expansion engine.
//
// This is the Swift port of the data model in `scripts/lib/bom_expand.py`
// (Native 0.2 L1 Wave A). It is DELIBERATELY separate from the costing
// converter `UnitConvert.swift`: BomExpand works in a quart/pound base with
// NO density bridge, whereas UnitConvert is a gram/ml + density costing
// converter. See docs/superpowers/plans/2026-07-07-lariat-native-phase-iii-wave-a.md
// (decision D3: copy the Python unit tables verbatim; do not delegate to
// UnitConvert yet).
//
// Parity contract (verified against scripts/lib/bom_expand.py):
//   * No rounding anywhere — raw IEEE-754 doubles, compared at tolerance 1e-6.
//   * Cross-dimension conversion (weight <-> volume) is unsupported and yields
//     nil; a chef-declared per-recipe `packConversions` entry resolves pack
//     units (e.g. "bag") instead.

import Foundation

/// A chef-declared pack→yield conversion, e.g. `bag:3:qt` meaning 1 bag = 3 qt
/// of this recipe. Serialized in fixtures as a 2-element JSON array
/// `[factor, yield_unit]`.
public struct PackConversion: Equatable, Codable {
    public let factor: Double
    public let yieldUnit: String

    public init(factor: Double, yieldUnit: String) {
        self.factor = factor
        self.yieldUnit = yieldUnit
    }

    public init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        self.factor = try container.decode(Double.self)
        self.yieldUnit = try container.decode(String.self)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.unkeyedContainer()
        try container.encode(factor)
        try container.encode(yieldUnit)
    }
}

/// One row of a recipe's bill of materials.
public struct BomRow: Equatable, Codable {
    public let ingredient: String
    public let qty: Double
    public let unit: String
    public let isSubRecipe: Bool
    /// Explicit `(sub-recipe=slug)` pin binding this row to a child slug even
    /// when the ingredient name doesn't token-match. `nil` when unpinned.
    public let subSlug: String?

    public init(ingredient: String, qty: Double, unit: String, isSubRecipe: Bool, subSlug: String?) {
        self.ingredient = ingredient
        self.qty = qty
        self.unit = unit
        self.isSubRecipe = isSubRecipe
        self.subSlug = subSlug
    }

    enum CodingKeys: String, CodingKey {
        case ingredient, qty, unit
        case isSubRecipe = "is_sub_recipe"
        case subSlug = "sub_slug"
    }
}

/// A single recipe node: its yield, BOM, and declared sub-recipes.
public struct RecipeManifest: Equatable, Codable {
    public let slug: String
    public let displayName: String
    public let yieldQty: Double
    public let yieldUnit: String
    public let subRecipeSlugs: [String]
    public let bom: [BomRow]
    public let allergens: [String]
    public let packConversions: [String: PackConversion]

    public init(
        slug: String,
        displayName: String,
        yieldQty: Double,
        yieldUnit: String,
        subRecipeSlugs: [String] = [],
        bom: [BomRow] = [],
        allergens: [String] = [],
        packConversions: [String: PackConversion] = [:]
    ) {
        self.slug = slug
        self.displayName = displayName
        self.yieldQty = yieldQty
        self.yieldUnit = yieldUnit
        self.subRecipeSlugs = subRecipeSlugs
        self.bom = bom
        self.allergens = allergens
        self.packConversions = packConversions
    }

    enum CodingKeys: String, CodingKey {
        case slug
        case displayName = "display_name"
        case yieldQty = "yield_qty"
        case yieldUnit = "yield_unit"
        case subRecipeSlugs = "sub_recipe_slugs"
        case bom
        case allergens
        case packConversions = "pack_conversions"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        slug = try c.decode(String.self, forKey: .slug)
        displayName = try c.decode(String.self, forKey: .displayName)
        yieldQty = try c.decode(Double.self, forKey: .yieldQty)
        yieldUnit = try c.decode(String.self, forKey: .yieldUnit)
        subRecipeSlugs = try c.decodeIfPresent([String].self, forKey: .subRecipeSlugs) ?? []
        bom = try c.decodeIfPresent([BomRow].self, forKey: .bom) ?? []
        allergens = try c.decodeIfPresent([String].self, forKey: .allergens) ?? []
        packConversions = try c.decodeIfPresent([String: PackConversion].self, forKey: .packConversions) ?? [:]
    }
}

/// Key for a leaf-ingredient total or a recipe-node total: (name, unit).
public struct BomKey: Hashable {
    public let name: String
    public let unit: String

    public init(_ name: String, _ unit: String) {
        self.name = name
        self.unit = unit
    }
}

/// A manifest-integrity warning: a declared sub-recipe that no BOM row of the
/// parent references.
public struct ManifestWarning: Equatable {
    public let recipe: String
    public let subSlug: String
    public let issue: String

    public init(recipe: String, subSlug: String, issue: String) {
        self.recipe = recipe
        self.subSlug = subSlug
        self.issue = issue
    }
}

/// Errors raised during expansion. `errorName` mirrors the Python exception
/// class names so fixture `expect.error` strings compare directly.
public enum BomExpandError: Error, Equatable {
    case unknownRecipe(String)
    case unitMismatch(String)
    case recipeCycle(String)
    /// Python raises a bare `ValueError` for a non-positive yield_qty.
    case invalidYield(String)

    public var errorName: String {
        switch self {
        case .unknownRecipe: return "UnknownRecipeError"
        case .unitMismatch: return "UnitMismatchError"
        case .recipeCycle: return "RecipeCycleError"
        case .invalidYield: return "ValueError"
        }
    }

    public var message: String {
        switch self {
        case .unknownRecipe(let m), .unitMismatch(let m), .recipeCycle(let m), .invalidYield(let m):
            return m
        }
    }
}
