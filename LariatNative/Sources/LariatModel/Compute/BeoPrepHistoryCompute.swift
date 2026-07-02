import Foundation

/// Pure helpers from `lib/beoPrepHistory.ts` — the SQL-adjacent logic ported
/// GRDB-free so the repository stays a thin query layer. No I/O.
public enum BeoPrepHistoryCompute {
    public static let defaultLimit = 5
    public static let maxLimit = 25
    public static let minRecipeNameLen = 3

    /// Web `clampLimit`: nil/non-positive → default 5; overshoot → 25.
    public static func clampLimit(_ n: Int?) -> Int {
        guard let n else { return defaultLimit }
        if n <= 0 { return defaultLimit }
        if n > maxLimit { return maxLimit }
        return n
    }

    /// Parse `amount_qty` (TEXT in the DB — operators type "as needed",
    /// "30 ea", "1,000", or just "30") into a positive finite number.
    /// Strips a single trailing unit token; accepts thousands-separator
    /// commas. Returns nil when the value can't be coerced or is
    /// non-positive. Regex is the web module's, verbatim.
    public static func parseAmountQty(_ raw: String?) -> Double? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        guard let match = amountRegex.firstMatch(
            in: trimmed,
            range: NSRange(trimmed.startIndex..., in: trimmed)
        ), match.numberOfRanges > 1,
              let captureRange = Range(match.range(at: 1), in: trimmed)
        else { return nil }
        let captured = String(trimmed[captureRange]).replacingOccurrences(of: ",", with: "")
        guard let n = Double(captured), n.isFinite, n > 0 else { return nil }
        return n
    }

    /// `/^(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)/` from the web module.
    private static let amountRegex = try! NSRegularExpression(
        pattern: #"^(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)"#
    )

    /// Median of a pre-sorted array (trust-the-caller, web parity). Empty → 0.
    public static func median(sorted: [Double]) -> Double {
        let n = sorted.count
        if n == 0 { return 0 }
        let mid = n / 2
        if n % 2 == 1 { return sorted[mid] }
        return (sorted[mid - 1] + sorted[mid]) / 2
    }

    /// Bidirectional substring match from `getRecipePrepHistory`:
    ///   A) the BEO item contains the recipe name, OR
    ///   B) the recipe name contains the BEO item — but only when the item
    ///      is at least `minRecipeNameLen` chars (shorter items would match
    ///      nearly every recipe and produce noise).
    /// Both inputs must already be lowercased (web lowercases before comparing).
    public static func recipeItemMatches(recipeNameLower: String, itemLower: String) -> Bool {
        if itemLower.contains(recipeNameLower) { return true }
        return itemLower.count >= minRecipeNameLen && recipeNameLower.contains(itemLower)
    }

    /// `getItemPrepHistory` cleaning pass: trim, drop empties, dedupe EXACT
    /// (case-sensitive Set semantics) preserving first-seen order.
    public static func cleanedItems(_ items: [String]) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        for raw in items {
            let item = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if item.isEmpty || seen.contains(item) { continue }
            seen.insert(item)
            out.append(item)
        }
        return out
    }

    /// `getPrepMedianForItems` cleaning pass: trim, drop empties, dedupe by
    /// LOWERCASED key preserving the exact-cased first occurrence.
    public static func keyedItems(_ items: [String]) -> [(key: String, item: String)] {
        var seenKeys = Set<String>()
        var out: [(key: String, item: String)] = []
        for raw in items {
            let item = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if item.isEmpty { continue }
            let key = item.lowercased()
            if seenKeys.contains(key) { continue }
            seenKeys.insert(key)
            out.append((key: key, item: item))
        }
        return out
    }
}
