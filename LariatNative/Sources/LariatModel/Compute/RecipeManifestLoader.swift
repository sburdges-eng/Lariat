// RecipeManifestLoader — CSV → manifest / beo-map loaders, Swift ports of
// `build_manifest_from_normalized` + `_load_recipe_index` (bom_expand.py) and
// `load_beo_recipe_map` (beo_pull.py). Native 0.2 L1 Wave C (deferred from
// Wave A A3). Pure parsing; the D1-B path resolver + mtime cache layer on top.
//
// No silent coercion — same fail-loud / warnings semantics as the Python.

import Foundation

public enum RecipeManifestLoader {

    /// True when `root` actually holds a recipe index (D1-B first-run check).
    /// The app can surface a first-run message / repo picker when this is false;
    /// shipping a bundled seed snapshot or a wizard is deferred H8 polish.
    public static func isSeeded(root: String) -> Bool {
        FileManager.default.fileExists(
            atPath: (root as NSString).appendingPathComponent("recipes/recipe_index.csv")
        )
    }

    // MARK: - Manifest

    /// Build the slug→Manifest map from `recipes/recipe_index.csv` plus the
    /// per-slug `recipes/normalized/{slug}.csv` files. A missing per-slug file
    /// yields an empty BOM (not an error).
    public static func loadManifest(recipeIndex: URL, normalizedDir: URL) throws -> [String: RecipeManifest] {
        let indexText = try String(contentsOf: recipeIndex, encoding: .utf8)
        var manifest: [String: RecipeManifest] = [:]
        for (slug, entry) in parseRecipeIndex(indexText) {
            var bom: [BomRow] = []
            let slugCSV = normalizedDir.appendingPathComponent("\(slug).csv")
            if let text = try? String(contentsOf: slugCSV, encoding: .utf8) {
                bom = parseNormalizedBom(text)
            }
            manifest[slug] = RecipeManifest(
                slug: slug,
                displayName: entry.displayName,
                yieldQty: entry.yieldQty,
                yieldUnit: entry.yieldUnit,
                subRecipeSlugs: entry.subs,
                bom: bom,
                allergens: [],
                packConversions: entry.packConversions
            )
        }
        return manifest
    }

    private struct IndexEntry {
        let displayName: String
        let yieldQty: Double
        let yieldUnit: String
        let subs: [String]
        let packConversions: [String: PackConversion]
    }

    /// Ordered so callers could preserve recipe_index order if they ever move
    /// off a plain Dictionary (they don't yet).
    private static func parseRecipeIndex(_ text: String) -> [(slug: String, entry: IndexEntry)] {
        var out: [(String, IndexEntry)] = []
        for row in dictRows(text) {
            let slug = (row["recipe_id"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if slug.isEmpty { continue }
            let subs = (row["sub_recipes"] ?? "")
                .split(separator: ";", omittingEmptySubsequences: false)
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            var packConversions: [String: PackConversion] = [:]
            for spec in (row["pack_size"] ?? "").split(separator: ";", omittingEmptySubsequences: false) {
                let parts = spec.split(separator: ":", omittingEmptySubsequences: false)
                    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                if parts.count == 3, parts.allSatisfy({ !$0.isEmpty }), let factor = Double(parts[1]) {
                    packConversions[parts[0].lowercased()] = PackConversion(factor: factor, yieldUnit: parts[2].lowercased())
                }
            }
            let displayName = (row["recipe_name"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            out.append((slug, IndexEntry(
                displayName: displayName.isEmpty ? slug : displayName,
                yieldQty: parseFloat(row["yield"]),
                yieldUnit: (row["yield_unit"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
                subs: subs,
                packConversions: packConversions
            )))
        }
        return out
    }

    private static func parseNormalizedBom(_ text: String) -> [BomRow] {
        var bom: [BomRow] = []
        for row in dictRows(text) {
            let notes = (row["notes"] ?? "").lowercased()
            let pin = extractPin(notes)
            bom.append(BomRow(
                ingredient: (row["ingredient"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
                qty: parseFloat(row["qty"]),
                unit: (row["unit"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
                isSubRecipe: notes.contains("(sub-recipe)") || pin != nil,
                subSlug: pin
            ))
        }
        return bom
    }

    // MARK: - BEO recipe map

    /// Load `menus/beo_recipe_map.csv`, resolving each row's display name to a
    /// slug via `manifest[slug].displayName`. Returns the lookup, unresolved
    /// rows, and per-mapping `per_count` scales.
    public static func loadBeoRecipeMap(
        csv: URL, manifest: [String: RecipeManifest]
    ) -> (lookup: [String: [String]], unresolved: [CascadeUnmappedRow], scales: [BeoScaleKey: Double]) {
        guard let text = try? String(contentsOf: csv, encoding: .utf8) else {
            return ([:], [CascadeUnmappedRow(menuItem: "(whole map file)", reason: "not found: \(csv.path)")], [:])
        }

        // display-name (and slug-with-spaces) → slug. Iterate sorted keys for
        // determinism; Python uses manifest insertion order, so on the
        // (data-quality) edge of two recipes sharing a normalized display name
        // the winning slug may differ — accepted, same class as directResolve.
        var displayToSlug: [String: String] = [:]
        for slug in manifest.keys.sorted() {
            guard let m = manifest[slug] else { continue }
            let key = BeoPullCompute.normalizeClient(m.displayName)
            if !key.isEmpty, displayToSlug[key] == nil { displayToSlug[key] = slug }
            let slugKey = BeoPullCompute.normalizeClient(slug.replacingOccurrences(of: "_", with: " "))
            if displayToSlug[slugKey] == nil { displayToSlug[slugKey] = slug }
        }

        var lookup: [String: [String]] = [:]
        var unresolved: [CascadeUnmappedRow] = []
        var scales: [BeoScaleKey: Double] = [:]
        for row in dictRows(text) {
            let menuItem = (row["beo_item"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let recipeKey = (row["recipe_id"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if menuItem.isEmpty || recipeKey.isEmpty { continue }
            guard let slug = displayToSlug[BeoPullCompute.normalizeClient(recipeKey)] else {
                unresolved.append(CascadeUnmappedRow(
                    menuItem: menuItem, reason: "map references '\(recipeKey)', no such recipe"
                ))
                continue
            }
            let nameKey = BeoPullCompute.normalizeClient(menuItem)
            lookup[nameKey, default: []].append(slug)
            let rawPc = (row["per_count"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !rawPc.isEmpty, let pc = Double(rawPc) {
                scales[BeoScaleKey(nameKey: nameKey, slug: slug)] = pc
            }
        }
        return (lookup, unresolved, scales)
    }

    // MARK: - CSV + numeric helpers

    private static func parseFloat(_ raw: String?) -> Double {
        let s = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return 0.0 }
        return Double(s) ?? 0.0
    }

    private static let pinRegex = try! NSRegularExpression(pattern: "\\(sub-recipe=([a-z0-9_]+)\\)")

    private static func extractPin(_ notesLower: String) -> String? {
        let range = NSRange(notesLower.startIndex..., in: notesLower)
        guard let match = pinRegex.firstMatch(in: notesLower, range: range),
              match.numberOfRanges > 1,
              let r = Range(match.range(at: 1), in: notesLower) else { return nil }
        return String(notesLower[r])
    }

    /// Header-mapped rows (Python `csv.DictReader`). Missing trailing cells map
    /// to "" and extra cells are ignored.
    private static func dictRows(_ text: String) -> [[String: String]] {
        let rows = parseCSVRows(text)
        guard let header = rows.first else { return [] }
        return rows.dropFirst().map { r in
            var d: [String: String] = [:]
            for (i, key) in header.enumerated() { d[key] = i < r.count ? r[i] : "" }
            return d
        }
    }

    /// Minimal CSV reader matching Python's default dialect: comma delimiter,
    /// double-quote quoting recognized ONLY at field start, `""` → literal `"`.
    /// Blank lines are skipped (no trailing empty record). Assumes no embedded
    /// newlines inside quoted fields (true for the recipe CSVs).
    private static func parseCSVRows(_ text: String) -> [[String]] {
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        var out: [[String]] = []
        for line in normalized.split(separator: "\n", omittingEmptySubsequences: false) where !line.isEmpty {
            out.append(splitCSVLine(String(line)))
        }
        return out
    }

    private static func splitCSVLine(_ line: String) -> [String] {
        var fields: [String] = []
        var field = ""
        var inQuotes = false
        var fieldStart = true
        let chars = Array(line)
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if inQuotes {
                if c == "\"" {
                    if i + 1 < chars.count, chars[i + 1] == "\"" { field.append("\""); i += 2; continue }
                    inQuotes = false; i += 1; continue
                }
                field.append(c); i += 1; continue
            }
            if fieldStart, c == "\"" { inQuotes = true; fieldStart = false; i += 1; continue }
            fieldStart = false
            if c == "," { fields.append(field); field = ""; fieldStart = true; i += 1; continue }
            field.append(c); i += 1
        }
        fields.append(field)
        return fields
    }
}
