import Foundation

/// Faithful port of `lib/salesDepletion.ts` (`resolveDepletionsForSale`'s
/// unresolved-reason ladder + `computeRecipeRatio`). Pure over caller-supplied
/// value types — `DepletionExceptionsRepository` performs the SELECTs
/// (`dish_components`/`entities_recipes`/`bom_lines`) and passes rows in.
///
/// Only the FIRST unresolved reason is surfaced (mirrors
/// `listDepletionExceptions`'s `result.unresolved[0]` read — the exceptions
/// board never needs the full unresolved list, only "is this dish clean or
/// not, and why").
public enum DepletionReason: String, Sendable, Equatable {
    case noDishComponents = "no_dish_components"
    case recipeMissingYield = "recipe_missing_yield"
    case crossDimUnitMismatch = "cross_dim_unit_mismatch"
    case unknownUnit = "unknown_unit"
    case invalidQty = "invalid_qty"
}

public struct DishComponentRow: Sendable {
    public let componentType: String   // "recipe"|"vendor_item"
    public let recipeSlug: String?
    public let vendorIngredient: String?
    public let qtyPerServing: Double
    public let unit: String
    public init(componentType: String, recipeSlug: String?, vendorIngredient: String?, qtyPerServing: Double, unit: String) {
        self.componentType = componentType
        self.recipeSlug = recipeSlug
        self.vendorIngredient = vendorIngredient
        self.qtyPerServing = qtyPerServing
        self.unit = unit
    }
}

public struct RecipeYield: Sendable {
    public let yieldQty: Double?
    public let yieldUnit: String?
    public init(yieldQty: Double?, yieldUnit: String?) {
        self.yieldQty = yieldQty
        self.yieldUnit = yieldUnit
    }
}

public struct BomLineRow: Sendable {
    public let ingredient: String?
    public let qty: Double?
    public let unit: String?
    public let lossFactor: Double?
    public init(ingredient: String?, qty: Double?, unit: String?, lossFactor: Double?) {
        self.ingredient = ingredient
        self.qty = qty
        self.unit = unit
        self.lossFactor = lossFactor
    }
}

public struct DepletionUnresolved: Sendable, Equatable {
    public let reason: DepletionReason
    public let detail: String?
    public init(reason: DepletionReason, detail: String?) {
        self.reason = reason
        self.detail = detail
    }
}

public enum DepletionExceptionResolver {
    /// Compute the dimensionless ratio "how much of a recipe's yield is one
    /// serving of this dish." `nil` when the conversion isn't well-defined
    /// (cross-dimension without a density, or non-positive inputs).
    /// Mirrors salesDepletion.ts:298-320.
    public static func computeRecipeRatio(portionQty: Double, portionUnit: String?, yieldQty: Double, yieldUnit: String) -> Double? {
        guard portionQty.isFinite, portionQty > 0 else { return nil }
        guard yieldQty.isFinite, yieldQty > 0 else { return nil }
        let pn = UnitConvert.normalizeUnit(portionUnit ?? "")
        let yn = UnitConvert.normalizeUnit(yieldUnit)
        if pn == yn { return portionQty / yieldQty }
        guard let pd = UnitConvert.unitDimension(pn), let yd = UnitConvert.unitDimension(yn), pd == yd else { return nil }
        guard let portionInYield = UnitConvert.convertQty(portionQty, from: pn, to: yn, gPerMl: nil) else { return nil }
        return portionInYield / yieldQty
    }

    /// `yieldFor`/`bomFor` are lazy fetch closures the repository backs with
    /// SQL; the classifier stops at the first unresolved reason so it needn't
    /// fetch more than necessary. Mirrors salesDepletion.ts:170-285's emission
    /// order and its `continue` semantics: a `recipe` component that fully
    /// resolves does NOT short-circuit — later components keep scanning.
    public static func firstUnresolved(
        quantitySold: Double,
        components: [DishComponentRow],
        yieldFor: (_ slug: String) -> RecipeYield?,
        bomFor: (_ slug: String) -> [BomLineRow]
    ) -> DepletionUnresolved? {
        guard quantitySold.isFinite, quantitySold > 0 else {
            return DepletionUnresolved(reason: .invalidQty, detail: "quantity_sold=\(jsNum(quantitySold))")
        }
        if components.isEmpty {
            return DepletionUnresolved(reason: .noDishComponents, detail: nil)
        }
        for c in components {
            if c.componentType == "vendor_item" { continue }     // always resolves (vendor path)
            guard let slug = c.recipeSlug else { continue }
            let y = yieldFor(slug)
            if y == nil || y?.yieldQty == nil || y?.yieldUnit == nil || (y?.yieldQty ?? 0) <= 0 {
                return DepletionUnresolved(reason: .recipeMissingYield, detail: slug)
            }
            let yq = y!.yieldQty!, yu = y!.yieldUnit!
            let ratio = computeRecipeRatio(portionQty: c.qtyPerServing, portionUnit: c.unit, yieldQty: yq, yieldUnit: yu)
            if ratio == nil {
                return DepletionUnresolved(reason: .crossDimUnitMismatch,
                    detail: "\(jsNum(c.qtyPerServing))\(c.unit) → \(yu) for \(slug)")
            }
            let bom = bomFor(slug)
            if bom.isEmpty {
                return DepletionUnresolved(reason: .noDishComponents, detail: "recipe=\(slug) has zero bom_lines")
            }
            // Recipe fully resolves — mirror JS `continue`; keep scanning later components.
        }
        return nil
    }

    /// JS Number→string: integer-valued renders without ".0". Mirrors the detail
    /// strings the web builds via template literals (e.g. "1oz", "quantity_sold=0").
    private static func jsNum(_ d: Double) -> String {
        if d.isFinite, d == d.rounded(.towardZero), abs(d) < 9.007e15 { return String(Int64(d)) }
        return "\(d)"
    }
}
