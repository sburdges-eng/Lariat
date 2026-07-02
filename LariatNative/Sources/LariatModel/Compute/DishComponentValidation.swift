import Foundation

/// Pure port of the validation the web POST route applies to dish components:
///   - `validateDishComponent` (lib/dishComponents.ts L12-49) — field rules.
///     The route path deliberately does NOT gate on KNOWN_UNITS / unit
///     dimension; that stricter check belongs to the CLI importer's
///     `validateDishComponentRow` and is not part of this surface.
///   - route-level field prep (app/api/dish-components/route.ts L57-74):
///     canonical dish name via `normalizeDishName`, over-length values
///     CLIPPED (recipe_slug 80 / vendor_ingredient 200 / unit 24 / notes
///     500) — never rejected — and cross-type fields nulled.
///
/// Rule failures throw typed `DishComponentWriteError`s BEFORE any write
/// (audited-write ordering contract, even though this surface posts no
/// audit_events — parity with the web route, which doesn't either).
public enum DishComponentValidation {

    /// `validateDishComponent` — returns the web-verbatim reason string, or
    /// nil when the draft is valid. JS truthiness is mirrored: empty strings
    /// are "absent" for the cross-type exclusivity checks.
    public static func validate(_ input: DishComponentDraft) -> String? {
        if input.dishName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "dish_name is required"
        }
        let type = input.componentType ?? "recipe"
        if type != "recipe" && type != "vendor_item" {
            return "component_type must be \"recipe\" or \"vendor_item\""
        }
        if type == "recipe" {
            if (input.recipeSlug ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return "recipe_slug is required for recipe components"
            }
            if let vendor = input.vendorIngredient, !vendor.isEmpty {
                return "vendor_ingredient must be empty for recipe components"
            }
        } else {
            if (input.vendorIngredient ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return "vendor_ingredient is required for vendor_item components"
            }
            if let slug = input.recipeSlug, !slug.isEmpty {
                return "recipe_slug must be empty for vendor_item components"
            }
        }
        if !input.qtyPerServing.isFinite || input.qtyPerServing <= 0 {
            return "qty_per_serving must be a positive number"
        }
        if input.unit.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "unit is required"
        }
        return nil
    }

    /// route.ts `clip` (L10-14): trim, empty → nil, else prefix(max).
    static func clip(_ s: String?, max: Int) -> String? {
        guard let s else { return nil }
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : String(t.prefix(max))
    }

    /// Validate + normalize + clip → a write-ready row. Mirrors the POST
    /// handler's prep order: validate (400) → normalize dish name (400 when
    /// it collapses to nothing) → per-type clipping.
    public static func prepare(_ draft: DishComponentDraft) throws -> DishComponentWriteRow {
        if let reason = validate(draft) {
            throw DishComponentWriteError.validation(reason: reason)
        }
        let dishName = DishCostBridge.normalizeDishName(draft.dishName)
        if dishName.isEmpty {
            throw DishComponentWriteError.normalizedEmpty
        }
        let componentType = draft.componentType ?? "recipe"
        return DishComponentWriteRow(
            locationId: draft.locationId,
            dishName: dishName,
            componentType: componentType,
            recipeSlug: componentType == "recipe" ? clip(draft.recipeSlug, max: 80) : nil,
            vendorIngredient: componentType == "vendor_item" ? clip(draft.vendorIngredient, max: 200) : nil,
            qtyPerServing: draft.qtyPerServing,
            // Validation guarantees a non-empty unit, so clip can't nil out.
            unit: clip(draft.unit, max: 24) ?? "",
            notes: clip(draft.notes, max: 500))
    }
}
