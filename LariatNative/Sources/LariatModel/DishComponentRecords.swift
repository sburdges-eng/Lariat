import GRDB
import Foundation

// Records + write types for the dish-components editor
// (`app/menu-engineering/components/*` + `app/api/dish-components/route.ts`).

/// One `dish_components` row (SELECT * projection). Named "Editor" because
/// `DishComponentRow` is already taken by the depletion-exception resolver's
/// slimmer projection.
public struct DishComponentEditorRow: FetchableRecord, Decodable, Identifiable, Sendable, Equatable {
    public let id: Int64
    public let locationId: String
    public let dishName: String
    public let componentType: String        // "recipe" | "vendor_item"
    public let recipeSlug: String?
    public let vendorIngredient: String?
    public let qtyPerServing: Double
    public let unit: String
    public let notes: String?
    public let createdAt: String?
    public let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case locationId = "location_id"
        case dishName = "dish_name"
        case componentType = "component_type"
        case recipeSlug = "recipe_slug"
        case vendorIngredient = "vendor_ingredient"
        case qtyPerServing = "qty_per_serving"
        case unit, notes
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

/// Raw editor input — mirrors the POST body shape before validation.
/// `componentType` nil defaults to "recipe" (web `?? 'recipe'`).
public struct DishComponentDraft: Sendable {
    public var dishName: String
    public var componentType: String?
    public var recipeSlug: String?
    public var vendorIngredient: String?
    public var qtyPerServing: Double
    public var unit: String
    public var notes: String?
    public var locationId: String

    public init(dishName: String, componentType: String?, recipeSlug: String?,
                vendorIngredient: String?, qtyPerServing: Double, unit: String,
                notes: String?, locationId: String = "default") {
        self.dishName = dishName; self.componentType = componentType
        self.recipeSlug = recipeSlug; self.vendorIngredient = vendorIngredient
        self.qtyPerServing = qtyPerServing; self.unit = unit
        self.notes = notes; self.locationId = locationId
    }
}

/// A validated + normalized + clipped row, ready to write — the output of
/// `DishComponentValidation.prepare` (route.ts L57-74 field prep).
public struct DishComponentWriteRow: Sendable, Equatable {
    public let locationId: String
    public let dishName: String             // CANONICAL (normalizeDishName)
    public let componentType: String
    public let recipeSlug: String?
    public let vendorIngredient: String?
    public let qtyPerServing: Double
    public let unit: String
    public let notes: String?
}

/// Typed rule failures — thrown BEFORE any write. Mirror the web route's
/// 400 responses; there is no 422/PIN path on this surface.
public enum DishComponentWriteError: Error, Equatable, LocalizedError {
    /// `validateDishComponent` failure — reason string is web-verbatim.
    case validation(reason: String)
    /// `dish_name normalized to empty` (route.ts L64-66).
    case normalizedEmpty
    /// DELETE `id is required` (route.ts L106-108).
    case invalidId
    /// Native-only: the surface was built without a write handle.
    case missingWriteDatabase

    public var errorDescription: String? {
        switch self {
        case .validation(let reason): return reason
        case .normalizedEmpty: return "dish_name normalized to empty"
        case .invalidId: return "id is required"
        case .missingWriteDatabase: return "Editing requires a writable database"
        }
    }
}

/// Upsert outcome — mirrors `UpsertResult.outcome` in lib/dishComponentsRepo.ts.
public enum DishComponentUpsertOutcome: String, Sendable, Equatable {
    case inserted, updated, skipped
}
