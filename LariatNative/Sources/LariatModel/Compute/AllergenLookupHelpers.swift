import Foundation

/// Pure helpers for the allergen-lookup board — parity with
/// `app/allergen-lookup/allergenLookupHelpers.js`. The web module also builds
/// `/api/datapack/search` URL strings (`buildLookupUrl` / `offProductUrl`);
/// native calls `DatapackRepository` directly, so the transport-URL forms are
/// not reproduced — the routing DECISION (barcode → direct product lookup vs
/// FTS search over the OFF source) is ported as `route(for:)` with every
/// oracle case pinned.
public enum AllergenLookupHelpers {
    // ── GTIN detection ──────────────────────────────────────────────────

    /// Strip whitespace + hyphens from a query (scanners insert both).
    public static func stripGtinNoise(_ raw: String?) -> String {
        guard let raw else { return "" }
        return raw.replacingOccurrences(of: "[\\s-]", with: "", options: .regularExpression)
    }

    /// True iff the query looks like a barcode: all ASCII digits, 8–14 long
    /// after stripping whitespace and hyphens (EAN-8 … ITF-14).
    public static func isGtinQuery(_ raw: String?) -> Bool {
        let stripped = stripGtinNoise(raw)
        let count = stripped.utf16.count
        guard count >= 8 && count <= 14 else { return false }
        return stripped.unicodeScalars.allSatisfy { $0 >= "0" && $0 <= "9" }
    }

    // ── Tag parsing + cleaning ──────────────────────────────────────────

    /// Parse a raw `allergens_tags_json` / `traces_tags_json` column — []
    /// on nil / malformed / non-array; empty and non-string entries dropped.
    public static func parseAllergenTags(_ raw: String?) -> [String] {
        guard let raw, !raw.isEmpty,
              let data = raw.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data),
              let array = parsed as? [Any]
        else { return [] }
        return array.compactMap { $0 as? String }.filter { !$0.isEmpty }
    }

    /// Clean one OFF tag for chip display:
    ///   "en:peanuts" → "peanuts"; "en:milk_and_dairy" → "milk and dairy".
    /// A 1–3 letter (letters-only) prefix before the first colon is a
    /// language code and is stripped; underscores become spaces; lowercased.
    public static func cleanAllergenTag(_ tag: String?) -> String {
        guard let tag else { return "" }
        var t = tag.trimmingCharacters(in: .whitespacesAndNewlines)
        if let colonIndex = t.firstIndex(of: ":") {
            let prefix = t[t.startIndex..<colonIndex]
            let offset = prefix.utf16.count
            if offset > 0, offset <= 3,
               prefix.unicodeScalars.allSatisfy({
                   ($0 >= "a" && $0 <= "z") || ($0 >= "A" && $0 <= "Z")
               }) {
                t = String(t[t.index(after: colonIndex)...])
            }
        }
        return t.replacingOccurrences(of: "_", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
    }

    // ── Lookup routing (buildLookupUrl's decision, sans URL transport) ──

    public enum LookupRoute: Equatable, Sendable {
        /// Blank query after trimming — no lookup.
        case blank
        /// Barcode-shaped query → direct OFF product lookup by GTIN.
        case offProduct(code: String)
        /// Everything else → FTS search over the OFF source.
        case search(query: String, limit: Int)
    }

    public static func route(for query: String?, limit: Int = 20) -> LookupRoute {
        guard let query else { return .blank }
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return .blank }
        if isGtinQuery(trimmed) {
            return .offProduct(code: stripGtinNoise(trimmed))
        }
        return .search(query: trimmed, limit: limit)
    }
}
