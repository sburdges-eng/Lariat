import SwiftUI

/// A6.3 feature modules: saved specials (manager), allergen lookup (safety),
/// datapack reference search (cook). Tier rationale documented in
/// `docs/superpowers/plans/2026-07-02-lariat-native-a6-3-specials-allergen-datapack.md`.
extension FeatureModule {
    /// `/specials/saved` — PIN-gated saved-specials management (rename/notes,
    /// delete, CSV export, menu promotion). Writes are the point, so the
    /// board degrades to a lock tile without the write database. The
    /// sandbox/LLM side of `/specials` is Phase B (kitchen assistant).
    static let managerSpecials = FeatureModule(id: "manager.specials") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(SpecialsView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Saved specials unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }

    /// `/allergen-lookup` — SAFETY-critical product allergen lookup +
    /// manager-attested house-recipe allergen lists. Reads work without the
    /// write database; attestations need it (the view degrades the form).
    static let safetyAllergenLookup = FeatureModule(id: "safety.allergenLookup") { ctx in
        AnyView(AllergenLookupView(readDB: ctx.database, writeDB: ctx.writeDatabase))
    }

    /// `/datapack-search` — read-only lexical reference search over the data
    /// pack. No DB dependency on lariat.db; the repository resolves the
    /// off-tree pack itself and no-ops gracefully when it isn't mounted.
    static let cookDatapackSearch = FeatureModule(id: "cook.datapackSearch") { _ in
        AnyView(DatapackSearchView())
    }
}
