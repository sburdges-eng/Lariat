import Foundation

/// Byte-exact port of `lib/depletionExceptions.ts`'s `REASON_LABELS` (168-176)
/// plus `app/costing/depletion-exceptions/page.jsx`'s `reasonTone` (49-57).
/// UI-free so it's testable in LariatModel without pulling in SwiftUI.
public enum DepletionReasonTone: String, Sendable { case red, blue, yellow }

public enum DepletionReasonLabels {
    public static func label(_ r: DepletionReason) -> String {
        switch r {
        case .noDishComponents: return "No dish_components mapping — add ingredients for this dish"
        case .recipeMissingYield: return "Sub-recipe missing yield — set yield_qty / yield_unit on the recipe"
        case .crossDimUnitMismatch: return "Volume↔weight conversion needs a density — fill in ingredient_densities"
        case .unknownUnit: return "Unknown unit — fix the unit on dish_components or bom_lines"
        case .invalidQty: return "Invalid quantity — qty_per_serving must be > 0"
        }
    }

    /// Tone matches the operator's likely effort to fix:
    ///   red = blocking the dish entirely (no_dish_components, invalid_qty)
    ///   yellow = recipe-side data gap (recipe_missing_yield, unknown_unit)
    ///   blue = needs a density to convert volume↔weight
    public static func tone(_ r: DepletionReason) -> DepletionReasonTone {
        switch r {
        case .noDishComponents, .invalidQty: return .red
        case .crossDimUnitMismatch: return .blue
        case .recipeMissingYield, .unknownUnit: return .yellow
        }
    }
}
