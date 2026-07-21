// BeoAllergenSummaryCompute — per-BEO-event allergen summary.
//
// Parity CONCEPT with the offline `Lariat_BEO_Studio_5.html` prototype's
// `computeMatrix` (docs/Lariat_BEO_Studio_5.html:331-336): join each event's
// line items against an allergen table and flag anything unmatched instead
// of silently dropping it. Studio 5's own table (`DATA.matrix`) is a
// hardcoded, self-flagged-incomplete 74-item list — explicitly NOT ported.
// The join here is against the real, DB-backed, ingredient-composition-
// derived `allergen_attestations` system instead
// (`AllergenAttestationCompute` / `AllergenAttestationRepository`, already
// surfaced standalone via `AllergenLookupView`).
//
// Matching reuses `BeoPullCompute`'s normalization (trim + casefold) and its
// `directResolve` strategy (match a line item's name against a recipe's
// display name, or its slug with underscores turned back into spaces) — the
// same scheme `BeoCascadeCompute`/`BeoPullCompute` already use to resolve a
// menu-item string to a recipe. No third matching scheme is invented here.

import Foundation

/// One line item's allergen picture on a BEO event.
///
/// `status == nil` means the item's name did not resolve to any recipe in
/// the allergen-relevant cache — this is the "NEED — no recipe on file"
/// case Studio 5 flagged, and it MUST be surfaced, never dropped, so a
/// kitchen staffer reviewing the event doesn't mistake silence for safety.
public struct BeoAllergenSummaryRow: Identifiable, Equatable, Sendable {
    /// The BEO line item's name, as typed on the sheet.
    public let itemName: String
    /// The matched recipe's slug, when one was found.
    public let recipeSlug: String?
    /// Display name: the matched recipe's name, or the raw item name when
    /// unmatched.
    public let displayName: String
    /// Current best-known allergen list for the matched recipe (the same
    /// "heuristic" list `AllergenLookupView`/`RecipeAttestationStatus`
    /// already renders). Empty for an unmatched item — NOT "no allergens".
    public let allergens: [String]
    /// nil only when the item didn't match any recipe on file.
    public let status: AttestationStatus?

    /// False only for the "no recipe on file" case.
    public var matched: Bool { status != nil }

    public var id: String { itemName }

    public init(
        itemName: String, recipeSlug: String?, displayName: String,
        allergens: [String], status: AttestationStatus?
    ) {
        self.itemName = itemName
        self.recipeSlug = recipeSlug
        self.displayName = displayName
        self.allergens = allergens
        self.status = status
    }
}

public enum BeoAllergenSummaryCompute {

    /// Build one summary row per DISTINCT (normalized) line-item name — the
    /// same menu item ordered on two lines only needs one allergen row.
    /// Blank names are skipped (nothing to match or flag). Row order follows
    /// first-seen order of `lineItemNames`.
    ///
    /// `statuses` is the already-fetched `AllergenAttestationRepository`
    /// result (no new repository call here — pure join). If a matched
    /// recipe has no entry in `statuses` (a caller passing a filtered
    /// subset), the row falls back to an unattested status built from the
    /// recipe's own heuristic allergen list rather than being reported as
    /// unmatched — "unmatched" is reserved for "no recipe on file at all".
    public static func summarize(
        lineItemNames: [String],
        recipes: [AllergenRecipe],
        statuses: [RecipeAttestationStatus]
    ) -> [BeoAllergenSummaryRow] {
        var statusBySlug: [String: RecipeAttestationStatus] = [:]
        for s in statuses { statusBySlug[s.recipeSlug] = s }

        var recipeBySlug: [String: AllergenRecipe] = [:]
        for r in recipes { recipeBySlug[r.slug] = r }

        var seen = Set<String>()
        var rows: [BeoAllergenSummaryRow] = []
        for raw in lineItemNames {
            let key = BeoPullCompute.normalizeClient(raw)
            if key.isEmpty { continue }
            guard seen.insert(key).inserted else { continue }

            guard let slug = resolve(key, recipes) else {
                rows.append(BeoAllergenSummaryRow(
                    itemName: raw, recipeSlug: nil, displayName: raw,
                    allergens: [], status: nil))
                continue
            }

            if let status = statusBySlug[slug] {
                rows.append(BeoAllergenSummaryRow(
                    itemName: raw, recipeSlug: slug, displayName: status.name,
                    allergens: status.heuristicAllergens, status: status.status))
            } else {
                let recipe = recipeBySlug[slug]
                rows.append(BeoAllergenSummaryRow(
                    itemName: raw, recipeSlug: slug,
                    displayName: recipe?.name ?? slug,
                    allergens: recipe?.allergens ?? [],
                    status: .unattested))
            }
        }
        return rows
    }

    /// Same approach as `BeoPullCompute.directResolve`: normalize + compare
    /// against a recipe's display name or its slug-with-spaces. Iterates in
    /// sorted-slug order for determinism (dictionaries/arrays here have no
    /// guaranteed order).
    private static func resolve(_ nameKey: String, _ recipes: [AllergenRecipe]) -> String? {
        for recipe in recipes.sorted(by: { $0.slug < $1.slug }) {
            if BeoPullCompute.normalizeClient(recipe.name) == nameKey { return recipe.slug }
            if BeoPullCompute.normalizeClient(recipe.slug.replacingOccurrences(of: "_", with: " ")) == nameKey {
                return recipe.slug
            }
        }
        return nil
    }
}
