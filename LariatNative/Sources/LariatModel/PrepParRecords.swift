import Foundation
import GRDB

/// Port of the `prep_par` surface (`app/prep/par` + `app/api/prep-par/route.js`).
///
/// Standing (recurring) prep targets by station — separate from the daily prep
/// task queue. Rows are uniquely keyed on
/// `(location_id, station_id, recipe_slug, ingredient)`; `station_id`,
/// `recipe_slug`, and `ingredient` are stored as `''` (never NULL) so the UNIQUE
/// constraint works cleanly. Every row targets at least one of recipe_slug or
/// ingredient (CHECK in schema; enforced in `PrepParCompute.validateUpsert`).

public enum PrepParWriteError: Error, LocalizedError, Equatable {
    /// Both recipe_slug and ingredient empty — web returns 400.
    case recipeOrIngredientRequired
    /// DELETE id was not a positive integer — web returns 400.
    case badId
    /// Row absent in the requested location — web returns 404.
    case notFound

    public var errorDescription: String? {
        switch self {
        case .recipeOrIngredientRequired: return "recipe_slug or ingredient required"
        case .badId: return "bad id"
        case .notFound: return "not found"
        }
    }
}

/// One `prep_par` row, matching the SELECT column list the web route reads
/// (`id, station_id, recipe_slug, ingredient, target_qty, unit, sort_order, note, updated_at`)
/// plus `location_id` for scoping/parity.
public struct PrepParRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let locationId: String
    public let stationId: String
    public let recipeSlug: String
    public let ingredient: String
    public let targetQty: Double?
    public let unit: String?
    public let sortOrder: Int?
    public let note: String?
    public let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case locationId = "location_id"
        case stationId = "station_id"
        case recipeSlug = "recipe_slug"
        case ingredient
        case targetQty = "target_qty"
        case unit
        case sortOrder = "sort_order"
        case note
        case updatedAt = "updated_at"
    }

    public init(
        id: Int64,
        locationId: String,
        stationId: String,
        recipeSlug: String,
        ingredient: String,
        targetQty: Double?,
        unit: String?,
        sortOrder: Int?,
        note: String?,
        updatedAt: String?
    ) {
        self.id = id
        self.locationId = locationId
        self.stationId = stationId
        self.recipeSlug = recipeSlug
        self.ingredient = ingredient
        self.targetQty = targetQty
        self.unit = unit
        self.sortOrder = sortOrder
        self.note = note
        self.updatedAt = updatedAt
    }

    /// Display label: recipe_slug → ingredient → stringified id (mirrors page.jsx).
    public var label: String {
        if !recipeSlug.isEmpty { return recipeSlug }
        if !ingredient.isEmpty { return ingredient }
        return String(id)
    }
}

/// One station group of prep par rows, sorted for display.
public struct PrepParStationGroup: Sendable, Identifiable {
    /// Raw station key ('' for General). Used as the stable identity.
    public let stationKey: String
    public let rows: [PrepParRow]

    public var id: String { stationKey }

    /// Empty station renders as "General" (mirrors page.jsx).
    public var title: String { stationKey.isEmpty ? "General" : stationKey }

    public init(stationKey: String, rows: [PrepParRow]) {
        self.stationKey = stationKey
        self.rows = rows
    }
}

/// Raw (unclipped) upsert request from the UI. `PrepParCompute.normalize`
/// applies the same clip/num rules as `app/api/prep-par/route.js`.
public struct PrepParUpsertInput: Sendable {
    public let stationId: String?
    public let recipeSlug: String?
    public let ingredient: String?
    public let targetQty: Double?
    public let unit: String?
    public let sortOrder: Double?
    public let note: String?
    public let cookId: String?

    public init(
        stationId: String? = nil,
        recipeSlug: String? = nil,
        ingredient: String? = nil,
        targetQty: Double? = nil,
        unit: String? = nil,
        sortOrder: Double? = nil,
        note: String? = nil,
        cookId: String? = nil
    ) {
        self.stationId = stationId
        self.recipeSlug = recipeSlug
        self.ingredient = ingredient
        self.targetQty = targetQty
        self.unit = unit
        self.sortOrder = sortOrder
        self.note = note
        self.cookId = cookId
    }
}

/// Normalized upsert values — every field is exactly what the web route binds
/// into its INSERT/UPDATE (`''` keys, clipped optionals, `sort_order` default 0).
public struct PrepParNormalized: Sendable, Equatable {
    public let stationId: String
    public let recipeSlug: String
    public let ingredient: String
    public let targetQty: Double?
    public let unit: String?
    public let sortOrder: Int
    public let note: String?

    public init(
        stationId: String,
        recipeSlug: String,
        ingredient: String,
        targetQty: Double?,
        unit: String?,
        sortOrder: Int,
        note: String?
    ) {
        self.stationId = stationId
        self.recipeSlug = recipeSlug
        self.ingredient = ingredient
        self.targetQty = targetQty
        self.unit = unit
        self.sortOrder = sortOrder
        self.note = note
    }
}

/// Result of a POST upsert — parity with the web `{ ok, id, isInsert }` shape.
public struct PrepParUpsertResult: Sendable, Equatable {
    public let id: Int64
    public let isInsert: Bool

    public init(id: Int64, isInsert: Bool) {
        self.id = id
        self.isInsert = isInsert
    }
}

/// Full board snapshot for the native screen: rows scoped to a location,
/// grouped by station for rendering.
public struct PrepParBoardSnapshot: Sendable {
    public let locationId: String
    public let stationFilter: String?
    public let rows: [PrepParRow]
    public let groups: [PrepParStationGroup]

    public init(
        locationId: String,
        stationFilter: String?,
        rows: [PrepParRow],
        groups: [PrepParStationGroup]
    ) {
        self.locationId = locationId
        self.stationFilter = stationFilter
        self.rows = rows
        self.groups = groups
    }
}
