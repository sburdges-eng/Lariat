import Foundation

/// Pure half of `lib/allergenAttestations.ts` — fingerprinting, allergen
/// normalization, and status computation. SAFETY-CRITICAL: the fingerprint
/// MUST match the web byte-for-byte, because attestations recorded on either
/// client are checked by the other. The hash input is the exact
/// `JSON.stringify` of the canonical composition array (key order
/// slug/ingredients/sub_recipes/allergens, no whitespace, JS string escaping,
/// UTF-16 code-unit sort) — pinned against node-generated oracle hashes in
/// `AllergenAttestationComputeTests`. The trailing `allergens` key is each
/// node's DERIVED allergen output (normalized), added by web PR #539
/// (Critical #2) so a heuristic/data-version change that alters the answer
/// stales the attestation even when ingredient names are unchanged.
public enum AllergenAttestationCompute {
    // ── Fingerprint ─────────────────────────────────────────────────────

    /// Normalized ingredient item names on one recipe: trim → lowercase →
    /// drop empties → sort (JS default sort = UTF-16 code units).
    static func normalizedItems(_ recipe: AllergenRecipe) -> [String] {
        JsValueFormat.jsSorted(
            recipe.ingredients
                .compactMap { $0.item?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
                .filter { !$0.isEmpty }
        )
    }

    /// Fingerprint a recipe's allergen-relevant composition over its whole
    /// reachable sub-recipe tree (cycle-safe). Returns nil when the slug is
    /// not in the recipe cache — you can't attest a recipe the heuristic
    /// can't see. Dangling sub-recipe links contribute their slug with empty
    /// ingredients/sub_recipes (web parity).
    public static func computeRecipeFingerprint(
        slug: String, recipes: [AllergenRecipe]
    ) -> String? {
        // JS `new Map(recipes.map(...))` keeps the LAST duplicate; mirror that.
        var bySlug: [String: AllergenRecipe] = [:]
        for recipe in recipes { bySlug[recipe.slug] = recipe }
        guard bySlug[slug] != nil else { return nil }

        var seen = Set<String>()
        var stack = [slug]
        while let current = stack.popLast() {
            if seen.contains(current) { continue }
            seen.insert(current)
            guard let node = bySlug[current] else { continue }
            stack.append(contentsOf: node.subRecipes)
        }

        var json = "["
        var first = true
        for s in JsValueFormat.jsSorted(Array(seen)) {
            if !first { json += "," }
            first = false
            let node = bySlug[s]
            let items = node.map(normalizedItems) ?? []
            let subs = node.map { JsValueFormat.jsSorted($0.subRecipes) } ?? []
            // Derived allergen output, normalized — mirrors the web's
            // `normalizeAllergens(node.allergens ?? [])`; [] for dangling
            // nodes. Keep this key LAST (web object-literal key order).
            let allergens = node.map { normalizeAllergens($0.allergens) } ?? []
            json += "{\"slug\":\(JsValueFormat.jsonString(s)),"
                + "\"ingredients\":\(JsValueFormat.jsonStringArray(items)),"
                + "\"sub_recipes\":\(JsValueFormat.jsonStringArray(subs)),"
                + "\"allergens\":\(JsValueFormat.jsonStringArray(allergens))}"
        }
        json += "]"

        return PinHash.sha256Hex(json)
    }

    // ── Allergen list normalization ─────────────────────────────────────

    /// `normalizeAllergens`: trim → lowercase → clip to 64 UTF-16 units →
    /// drop empties → dedupe → sort.
    public static func normalizeAllergens(_ list: [String]) -> [String] {
        var out = Set<String>()
        for raw in list {
            let t = SpecialsValidators.sliceUTF16(
                raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), max: 64)
            if !t.isEmpty { out.insert(t) }
        }
        return JsValueFormat.jsSorted(Array(out))
    }

    /// `parseAllergensJson` — [] for malformed / non-array / non-string members.
    public static func parseAllergensJson(_ raw: String) -> [String] {
        guard let data = raw.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data),
              let array = parsed as? [Any]
        else { return [] }
        return array.compactMap { $0 as? String }
    }

    // ── Status ──────────────────────────────────────────────────────────

    /// Latest-row-wins status: no row → unattested; row whose fingerprint
    /// matches the CURRENT composition → attested; anything else (recipe
    /// edited, sub-recipe changed, recipe gone from the cache) → stale.
    public static func status(
        latest: AllergenAttestationRecord?, currentFingerprint: String?
    ) -> AttestationStatus {
        guard let latest else { return .unattested }
        if let currentFingerprint, currentFingerprint == latest.recipeFingerprint {
            return .attested
        }
        return .stale
    }
}
