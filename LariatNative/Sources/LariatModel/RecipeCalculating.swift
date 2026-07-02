import Foundation

/// Port of the `lib/recipeCalculator.ts` CONTRACT. The Python BOM walker
/// (`scripts/bom_expand_cli.py` → `scripts/lib/bom_expand.py`) stays the single
/// source of truth for the math; native implementations call the same CLI.
/// Tests inject stubs — the web suites never spawn python either.

public struct RecipeLeafRow: Sendable, Equatable {
    public let ingredient: String
    public let qty: Double
    public let unit: String

    public init(ingredient: String, qty: Double, unit: String) {
        self.ingredient = ingredient
        self.qty = qty
        self.unit = unit
    }
}

public struct RecipeExpandResult: Sendable, Equatable {
    public let recipeSlug: String
    public let targetQty: Double
    public let targetUnit: String
    public let scaleFactor: Double
    public let leafRows: [RecipeLeafRow]

    public init(recipeSlug: String, targetQty: Double, targetUnit: String, scaleFactor: Double, leafRows: [RecipeLeafRow]) {
        self.recipeSlug = recipeSlug
        self.targetQty = targetQty
        self.targetUnit = targetUnit
        self.scaleFactor = scaleFactor
        self.leafRows = leafRows
    }
}

/// `CalculatorError` parity — `code` mirrors the web literals
/// ('bad_multiplier', 'bad_guest_count', 'timeout', 'spawn_failed', 'cli_error', …).
public struct RecipeCalculatorError: Error, Sendable, Equatable, LocalizedError {
    public let message: String
    public let code: String

    public init(_ message: String, code: String = "calculator_error") {
        self.message = message
        self.code = code
    }

    public var errorDescription: String? { message }
}

public protocol RecipeCalculating: Sendable {
    /// `scaleRecipe(slug, multiplier)` — implementations do NOT re-validate the
    /// multiplier; the action handler gates it first (route parity).
    func scaleRecipe(slug: String, multiplier: Double) async throws -> RecipeExpandResult
    /// `expandForBEO(recipes, guestCount)` — each recipe expanded independently
    /// at `portionsPerGuest * guestCount` of its yield unit.
    func expandForBEO(recipes: [(slug: String, portionsPerGuest: Double)], guestCount: Double) async throws -> [RecipeExpandResult]
}

public enum RecipeCalculatorFormat {
    /// `formatLeafRowsAsTasks(rows)` — `${formatQty(qty)} ${unit} ${ingredient}`.trim()
    public static func formatLeafRowsAsTasks(_ rows: [RecipeLeafRow]) -> [String] {
        rows.map {
            "\(formatQty($0.qty)) \($0.unit) \($0.ingredient)"
                .trimmingCharacters(in: .whitespaces)
        }
    }

    /// `formatQty(q)` — round to 2 dp; integral → no decimal; else trim zeros.
    public static func formatQty(_ q: Double) -> String {
        guard q.isFinite else { return JsValueFormat.numberString(q) }
        let rounded = (q * 100).rounded() / 100
        if rounded == rounded.rounded() {
            return JsValueFormat.numberString(rounded)
        }
        var s = String(format: "%.2f", rounded)
        while s.hasSuffix("0") { s.removeLast() }
        if s.hasSuffix(".") { s.removeLast() }
        return s
    }
}
