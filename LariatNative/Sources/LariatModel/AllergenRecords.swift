import Foundation
import GRDB

// Record types for the allergen-lookup board (`allergen_attestations` —
// schema owned by the web app in `lib/db.ts`) and the recipe cache the
// attestation fingerprint reads.

/// The allergen-relevant slice of a `data/cache/recipes.json` recipe doc
/// (`lib/data.ts Recipe`). Tolerant decode — missing fields default.
public struct AllergenRecipe: Sendable, Equatable {
    public struct Ingredient: Codable, Sendable, Equatable {
        public let item: String?
        public init(item: String?) { self.item = item }
    }

    public let slug: String
    public let name: String
    public let ingredients: [Ingredient]
    /// Full allergen set: direct inference + sub-recipe rollup (heuristic).
    public let allergens: [String]
    public let subRecipes: [String]

    public init(slug: String, name: String, ingredients: [Ingredient] = [],
                allergens: [String] = [], subRecipes: [String] = []) {
        self.slug = slug
        self.name = name
        self.ingredients = ingredients
        self.allergens = allergens
        self.subRecipes = subRecipes
    }
}

extension AllergenRecipe: Codable {
    enum CodingKeys: String, CodingKey {
        case slug, name, ingredients, allergens
        case subRecipes = "sub_recipes"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        slug = try container.decode(String.self, forKey: .slug)
        name = (try? container.decode(String.self, forKey: .name)) ?? slug
        ingredients = (try? container.decode([Ingredient].self, forKey: .ingredients)) ?? []
        allergens = (try? container.decode([String].self, forKey: .allergens)) ?? []
        subRecipes = (try? container.decode([String].self, forKey: .subRecipes)) ?? []
    }
}

/// One append-only `allergen_attestations` row
/// (`lib/allergenAttestations.ts AllergenAttestationRow`).
public struct AllergenAttestationRecord: Codable, FetchableRecord, Sendable, Equatable {
    public let id: Int64
    public let recipeSlug: String
    public let locationId: String
    public let allergensJson: String
    public let recipeFingerprint: String
    public let attestedBy: String
    public let note: String?
    public let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case recipeSlug = "recipe_slug"
        case locationId = "location_id"
        case allergensJson = "allergens_json"
        case recipeFingerprint = "recipe_fingerprint"
        case attestedBy = "attested_by"
        case note
        case createdAt = "created_at"
    }

    public init(id: Int64, recipeSlug: String, locationId: String, allergensJson: String,
                recipeFingerprint: String, attestedBy: String, note: String?, createdAt: String) {
        self.id = id
        self.recipeSlug = recipeSlug
        self.locationId = locationId
        self.allergensJson = allergensJson
        self.recipeFingerprint = recipeFingerprint
        self.attestedBy = attestedBy
        self.note = note
        self.createdAt = createdAt
    }

    /// The attested allergen list, parsed (`parseAllergensJson` — [] on junk).
    public var allergens: [String] {
        AllergenAttestationCompute.parseAllergensJson(allergensJson)
    }
}

/// `'unattested' | 'attested' | 'stale'` — latest row wins.
public enum AttestationStatus: String, Sendable, Equatable {
    case unattested
    case attested
    case stale
}

/// One recipe's attestation status line (`RecipeAttestationStatus`).
public struct RecipeAttestationStatus: Sendable, Equatable, Identifiable {
    public let recipeSlug: String
    /// Display name from the recipe doc (slug when the recipe is gone).
    public let name: String
    /// Current heuristic allergen set (direct + sub-recipe rollup).
    public let heuristicAllergens: [String]
    public let status: AttestationStatus
    public let latest: AllergenAttestationRecord?

    public var id: String { recipeSlug }

    public init(recipeSlug: String, name: String, heuristicAllergens: [String],
                status: AttestationStatus, latest: AllergenAttestationRecord?) {
        self.recipeSlug = recipeSlug
        self.name = name
        self.heuristicAllergens = heuristicAllergens
        self.status = status
        self.latest = latest
    }
}

/// Loads the allergen-relevant recipe docs from `data/cache/recipes.json` —
/// same source and failure posture as `lib/data.ts getRecipes()` (missing or
/// malformed cache → `[]`, never a throw).
public enum AllergenRecipeLoader {
    public static func load(
        env: [String: String] = ProcessInfo.processInfo.environment,
        cwd: String = FileManager.default.currentDirectoryPath
    ) -> [AllergenRecipe] {
        let cacheDir = resolveCacheDirectory(env: env, cwd: cwd)
        let path = (cacheDir as NSString).appendingPathComponent("recipes.json")
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
              let recipes = try? JSONDecoder().decode([AllergenRecipe].self, from: data)
        else { return [] }
        return recipes
    }
}
