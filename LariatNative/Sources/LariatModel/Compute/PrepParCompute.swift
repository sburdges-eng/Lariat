import Foundation

/// Pure port of the validation + normalization rules in
/// `app/api/prep-par/route.js` and the station-grouping in `app/prep/par/page.jsx`.
/// No I/O — the repository layer applies these before touching the database.
public enum PrepParCompute {
    /// `clip(s, max)` from the web route: trims a string, returns nil if empty,
    /// otherwise the first `max` characters. Non-string input yields nil.
    public static func clip(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }

    /// `num(v)` from the web route: finite numbers pass through, everything else
    /// (nil / non-finite) becomes nil.
    public static func num(_ value: Double?) -> Double? {
        guard let value, value.isFinite else { return nil }
        return value
    }

    /// Field width limits, matching the `clip(..., N)` calls in the web POST handler.
    public static let stationMax = 64
    public static let recipeMax = 200
    public static let ingredientMax = 200
    public static let unitMax = 32
    public static let noteMax = 500

    /// Normalize a raw upsert into the exact values the web route binds.
    /// Returns `.failure(.recipeOrIngredientRequired)` (the 400 case) when both
    /// recipe_slug and ingredient clip to empty.
    ///
    /// Web parity:
    ///   station_id  = clip(body.station_id, 64)  ?? ''
    ///   recipe_slug = clip(body.recipe_slug,200) ?? ''
    ///   ingredient  = clip(body.ingredient, 200) ?? ''
    ///   → 400 if recipe_slug === '' && ingredient === ''
    ///   target_qty  = num(body.target_qty)
    ///   unit        = clip(body.unit, 32)
    ///   sort_order  = num(body.sort_order) ?? 0   (stored as INTEGER)
    ///   note        = clip(body.note, 500)
    public static func normalize(_ input: PrepParUpsertInput) -> Result<PrepParNormalized, PrepParWriteError> {
        let stationId = clip(input.stationId, max: stationMax) ?? ""
        let recipeSlug = clip(input.recipeSlug, max: recipeMax) ?? ""
        let ingredient = clip(input.ingredient, max: ingredientMax) ?? ""
        if recipeSlug.isEmpty && ingredient.isEmpty {
            return .failure(.recipeOrIngredientRequired)
        }
        let targetQty = num(input.targetQty)
        let unit = clip(input.unit, max: unitMax)
        // `num(...) ?? 0`, then truncated to INTEGER as the schema column is INTEGER.
        let sortOrder = Int((num(input.sortOrder) ?? 0).rounded(.towardZero))
        let note = clip(input.note, max: noteMax)
        return .success(
            PrepParNormalized(
                stationId: stationId,
                recipeSlug: recipeSlug,
                ingredient: ingredient,
                targetQty: targetQty,
                unit: unit,
                sortOrder: sortOrder,
                note: note
            )
        )
    }

    /// Validate a DELETE id — web returns 400 unless it is a positive integer.
    public static func validateDeleteId(_ id: Int64) -> Result<Void, PrepParWriteError> {
        id > 0 ? .success(()) : .failure(.badId)
    }

    /// Group already-ordered rows by `station_id` (empty → General group with key ''),
    /// then sort the groups by station key using ordinal (localeCompare-equivalent)
    /// comparison, mirroring `page.jsx`'s `entries().sort((a,b) => a[0].localeCompare(b[0]))`.
    /// Row order within a group is preserved (rows already arrive in the
    /// `station_id, sort_order, recipe_slug, ingredient` order from the query).
    public static func group(_ rows: [PrepParRow]) -> [PrepParStationGroup] {
        var order: [String] = []
        var buckets: [String: [PrepParRow]] = [:]
        for row in rows {
            let key = row.stationId
            if buckets[key] == nil {
                buckets[key] = []
                order.append(key)
            }
            buckets[key]?.append(row)
        }
        return order
            .sorted { localeCompare($0, $1) < 0 }
            .map { PrepParStationGroup(stationKey: $0, rows: buckets[$0] ?? []) }
    }

    /// String comparison matching JS `String.localeCompare` ordering for the ASCII
    /// station keys used here: case-insensitive-then-case, locale-aware. The web
    /// query already orders `station_id` ascending (binary), and page.jsx re-sorts
    /// group keys with localeCompare; for the plain station tokens in use these
    /// agree, so we use a locale-aware compare to stay faithful to page.jsx.
    private static func localeCompare(_ a: String, _ b: String) -> Int {
        switch a.compare(b, options: [], range: nil, locale: Locale(identifier: "en_US")) {
        case .orderedAscending: return -1
        case .orderedSame: return 0
        case .orderedDescending: return 1
        }
    }
}
