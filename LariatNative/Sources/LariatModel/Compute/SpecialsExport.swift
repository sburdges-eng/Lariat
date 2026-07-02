import Foundation

/// Pure CSV builder for the specials export pipeline — parity with
/// `lib/specialsExport.ts`. No I/O, no DB.
public enum SpecialsExport {
    public static let unmatchedNote = "unmatched — pick a vendor item before paste"

    static let recipeHeader = "slug,display_name,yield_qty,yield_unit,category,procedure"
    static let ingredientHeader = "ingredient,qty,unit,vendor_match,note"

    public struct IngredientRow: Sendable, Equatable {
        public let ingredient: String
        /// Pre-stringified (JS `String(number)` semantics) — "" when absent.
        public let qty: String
        public let unit: String
        public let vendorMatch: String
        public let note: String

        public init(ingredient: String, qty: String, unit: String, vendorMatch: String, note: String) {
            self.ingredient = ingredient
            self.qty = qty
            self.unit = unit
            self.vendorMatch = vendorMatch
            self.note = note
        }
    }

    public struct RecipeRow: Sendable, Equatable {
        public let slug: String
        public let displayName: String
        public let yieldQty: Double
        public let yieldUnit: String
        public let category: String
        public let procedure: String

        public init(slug: String, displayName: String, yieldQty: Double,
                    yieldUnit: String, category: String, procedure: String) {
            self.slug = slug
            self.displayName = displayName
            self.yieldQty = yieldQty
            self.yieldUnit = yieldUnit
            self.category = category
            self.procedure = procedure
        }
    }

    // MARK: escapeCsvField

    /// RFC-4180: quote when the field contains `"`, `,`, `\n`, or `\r`;
    /// double embedded quotes.
    public static func escapeCsvField(_ value: String?) -> String {
        guard let s = value else { return "" }
        if s.contains("\"") || s.contains(",") || s.contains("\n") || s.contains("\r") {
            return "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\""
        }
        return s
    }

    static func joinRow(_ fields: [String?]) -> String {
        fields.map(escapeCsvField).joined(separator: ",")
    }

    // MARK: mapCostBreakdownToIngredientRows

    /// A line is "matched" iff `match` is a non-empty string AND `cost` is
    /// non-null (web truthiness check).
    public static func mapCostBreakdownToIngredientRows(_ breakdown: [CostBreakdownLine]) -> [IngredientRow] {
        breakdown.map { line in
            let matched = (line.match?.isEmpty == false) && line.cost != nil
            return IngredientRow(
                ingredient: line.item ?? "",
                qty: line.reqQtyString ?? "",
                unit: line.reqUnit ?? "",
                vendorMatch: matched ? (line.match ?? "") : "",
                note: matched ? "" : unmatchedNote
            )
        }
    }

    public static func selectSkippedRows(_ rows: [IngredientRow]) -> [IngredientRow] {
        rows.filter { $0.note == unmatchedNote }
    }

    // MARK: stripCostMarkdown

    /// Strip a trailing GitHub-style `> [!NOTE]` / `> [!WARNING]` blockquote
    /// emitted by the cost action handler; keep everything before it,
    /// trailing-whitespace-trimmed.
    public static func stripCostMarkdown(_ answer: String) -> String {
        guard let range = answer.range(
            of: "\\n\\n> \\[!(NOTE|WARNING)\\]",
            options: .regularExpression
        ) else { return answer }
        var head = String(answer[..<range.lowerBound])
        while let last = head.unicodeScalars.last,
              CharacterSet.whitespacesAndNewlines.contains(last) {
            head.unicodeScalars.removeLast()
        }
        return head
    }

    // MARK: buildExportCsv

    public static func buildExportCsv(recipeRow r: RecipeRow, ingredientRows: [IngredientRow]) -> String {
        let recipeBody = joinRow([
            r.slug, r.displayName, JsValueFormat.numberString(r.yieldQty),
            r.yieldUnit, r.category, r.procedure,
        ])
        let ingredientBody = ingredientRows
            .map { joinRow([$0.ingredient, $0.qty, $0.unit, $0.vendorMatch, $0.note]) }
            .joined(separator: "\n")
        let tail = ingredientBody.isEmpty ? "" : "\(ingredientBody)\n"
        return "# RECIPE\n\(recipeHeader)\n\(recipeBody)\n\n# INGREDIENTS\n\(ingredientHeader)\n\(tail)"
    }
}
