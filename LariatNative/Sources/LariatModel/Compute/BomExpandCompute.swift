// BomExpandCompute — in-process recipe BOM expansion, a byte-for-byte Swift
// port of `scripts/lib/bom_expand.py` (Native 0.2 L1 Wave A).
//
// PARITY RULES (verified against the Python oracle + 16 golden fixtures):
//   * NO rounding anywhere — raw IEEE-754 doubles; parity is asserted at
//     tolerance 1e-6. Do NOT introduce Decimal/ROUND_HALF_EVEN.
//   * `convertQty` converts only WITHIN one dimension (all-volume or
//     all-weight). Cross-dimension (weight <-> volume) returns nil; a
//     chef-declared per-recipe `packConversions` entry resolves pack units.
//   * Unit factor tables are copied verbatim from bom_expand.py lines 77-92
//     (decision D3: do NOT delegate to the costing UnitConvert.swift).
//   * A `warnings` sink of `nil` fails loud (throws); a non-nil sink degrades
//     gracefully (appends a message and skips the offending row).

import Foundation

public enum BomExpandCompute {

    // MARK: - Unit tables (verbatim from bom_expand.py)

    /// Volume units expressed in quarts.
    static let volumeToQt: [String: Double] = [
        "tsp": 1.0 / 192, "teaspoon": 1.0 / 192,
        "tbsp": 1.0 / 64, "tablespoon": 1.0 / 64,
        "floz": 1.0 / 32, "fl oz": 1.0 / 32,
        "cup": 1.0 / 4, "c": 1.0 / 4,
        "pt": 1.0 / 2, "pint": 1.0 / 2,
        "qt": 1.0, "quart": 1.0,
        "gal": 4.0, "gallon": 4.0,
        "ml": 0.00105668821, "l": 1.05668821, "liter": 1.05668821, "litre": 1.05668821,
    ]

    /// Weight units expressed in pounds.
    static let weightToLb: [String: Double] = [
        "oz": 1.0 / 16, "ounce": 1.0 / 16,
        "lb": 1.0, "lbs": 1.0, "pound": 1.0, "#": 1.0,
        "g": 0.00220462262, "gram": 0.00220462262,
        "kg": 2.20462262, "kilogram": 2.20462262,
    ]

    private static let dimensions: [[String: Double]] = [volumeToQt, weightToLb]

    // MARK: - Conversion

    /// Convert `qty` from `fromUnit` to `toUnit` when both share a dimension.
    /// Returns nil when they don't (cross-dimension / pack / count units). A
    /// case-insensitive exact-unit match returns `qty` unchanged.
    public static func convertQty(_ qty: Double, from fromUnit: String, to toUnit: String) -> Double? {
        let f = normalize(fromUnit)
        let t = normalize(toUnit)
        if f == t { return qty }
        for table in dimensions {
            if let ff = table[f], let tt = table[t] {
                return qty * ff / tt
            }
        }
        return nil
    }

    private static func normalize(_ unit: String) -> String {
        unit.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// Convert `qty fromUnit` into `subM.yieldUnit`: same-dimension converts
    /// exactly; otherwise the child's declared `packConversions` resolves a
    /// cross-dimension/pack unit; otherwise nil.
    private static func reconcileSubUnitQty(_ subM: RecipeManifest, qty: Double, fromUnit: String) -> Double? {
        if let direct = convertQty(qty, from: fromUnit, to: subM.yieldUnit) {
            return direct
        }
        if let pc = subM.packConversions[normalize(fromUnit)] {
            let packed = qty * pc.factor
            if normalize(pc.yieldUnit) == normalize(subM.yieldUnit) {
                return packed
            }
            return convertQty(packed, from: pc.yieldUnit, to: subM.yieldUnit)
        }
        return nil
    }

    // Error-message text mirrors the Python f-strings. Python wraps interpolated
    // identifiers with repr (`!r`); we emit bare single quotes. These render
    // identically for ASCII-identifier slugs/units and normal-magnitude
    // quantities — the entire BOM domain — and the error TYPE always matches.
    // They diverge (message text only, no numeric/type impact) solely for tokens
    // containing a quote/backslash or ~1e16-magnitude floats, both out of domain.
    // Accepted divergence (parity audit 2026-07-08).
    private static func subUnitMismatchMessage(
        parentSlug: String, subSlug: String, subM: RecipeManifest, rowUnit: String
    ) -> String {
        "recipe '\(parentSlug)' BOM references sub-recipe '\(subSlug)' with unit "
            + "'\(rowUnit)', but '\(subSlug)' yields in '\(subM.yieldUnit)'; declare a "
            + "pack_size (e.g. '\(normalize(rowUnit)):N:\(normalize(subM.yieldUnit))') on '\(subSlug)' "
            + "in recipe_index.csv"
    }

    // MARK: - Public API

    /// Walk the recipe tree from `slug` and return leaf-ingredient totals for
    /// producing `qty` of `unit`. Fails loud on any unresolvable node.
    public static func expandRecipe(
        _ manifest: [String: RecipeManifest], slug: String, qty: Double, unit: String
    ) throws -> [BomKey: Double] {
        var out: [BomKey: Double] = [:]
        var warnings: [String]? = nil
        try expandInto(manifest, slug: slug, qty: qty, unit: unit, out: &out, visited: [], warnings: &warnings)
        return out
    }

    /// Graceful variant: unresolvable BOM rows are skipped and a message is
    /// appended to `warnings` instead of throwing.
    public static func expandRecipe(
        _ manifest: [String: RecipeManifest], slug: String, qty: Double, unit: String,
        warnings: inout [String]
    ) -> [BomKey: Double] {
        var out: [BomKey: Double] = [:]
        var sink: [String]? = warnings
        // With a non-nil sink, expandInto never throws (every fail-loud branch
        // is gated on `sink == nil`), so this catch is unreachable.
        do {
            try expandInto(manifest, slug: slug, qty: qty, unit: unit, out: &out, visited: [], warnings: &sink)
        } catch {}
        warnings = sink ?? []
        return out
    }

    /// Expand each top-level demand and SUM the leaves. Duplicate slugs compound.
    public static func aggregateDemand(
        _ manifest: [String: RecipeManifest], demands: [(String, Double, String)]
    ) throws -> [BomKey: Double] {
        var out: [BomKey: Double] = [:]
        var warnings: [String]? = nil
        for (slug, qty, unit) in demands {
            var leaves: [BomKey: Double] = [:]
            try expandInto(manifest, slug: slug, qty: qty, unit: unit, out: &leaves, visited: [], warnings: &warnings)
            for (key, val) in leaves {
                out[key, default: 0.0] += val
            }
        }
        return out
    }

    /// Aggregate per-recipe-NODE demand across top-level demands. Returns
    /// {(slug, yieldUnit): totalQty} for every recipe/sub-recipe that must be
    /// produced; leaf ingredients are excluded.
    public static func expandRecipeDemand(
        _ manifest: [String: RecipeManifest], demands: [(String, Double, String)]
    ) throws -> [BomKey: Double] {
        var out: [BomKey: Double] = [:]
        var warnings: [String]? = nil
        for (slug, qty, unit) in demands {
            try accumulateRecipeDemand(manifest, slug: slug, qty: qty, unit: unit, out: &out, visited: [], warnings: &warnings)
        }
        return out
    }

    /// Surface each declared sub-recipe that NO BOM row of the parent references.
    public static func findManifestWarnings(_ manifest: [String: RecipeManifest]) -> [ManifestWarning] {
        var out: [ManifestWarning] = []
        for (slug, m) in manifest {
            var referenced: Set<String> = []
            for row in m.bom {
                if let pin = row.subSlug, !pin.isEmpty {
                    referenced.insert(pin)
                } else if row.isSubRecipe || couldBeSub(m, ingredient: row.ingredient, manifest: manifest) {
                    if let resolved = resolveSubSlug(manifest, parent: m, ingredient: row.ingredient) {
                        referenced.insert(resolved)
                    }
                }
            }
            for declared in m.subRecipeSlugs where !referenced.contains(declared) {
                out.append(ManifestWarning(
                    recipe: slug,
                    subSlug: declared,
                    issue: "declares sub-recipe '\(declared)' but no BOM row references it"
                ))
            }
        }
        // Python emits these in manifest-insertion order, which a Swift
        // [String: RecipeManifest] cannot preserve (dict iteration is
        // per-process-randomized). Canonicalize by (recipe, subSlug) so the
        // output is deterministic and run-stable. The warning SET is identical
        // to Python and no fixture asserts a positional multi-warning order.
        return out.sorted { ($0.recipe, $0.subSlug) < ($1.recipe, $1.subSlug) }
    }

    // MARK: - Recursion

    private static func expandInto(
        _ manifest: [String: RecipeManifest],
        slug: String, qty rawQty: Double, unit rawUnit: String,
        out: inout [BomKey: Double],
        visited: [String],
        warnings: inout [String]?
    ) throws {
        guard let m = manifest[slug] else {
            let msg = "recipe '\(slug)' is not in the manifest"
            if warnings == nil { throw BomExpandError.unknownRecipe(msg) }
            warnings?.append(msg)
            return
        }
        if visited.contains(slug) {
            let idx = visited.firstIndex(of: slug)!
            let path = Array(visited[idx...]) + [slug]
            let msg = "sub-recipe cycle: \(path.joined(separator: " -> "))"
            if warnings == nil { throw BomExpandError.recipeCycle(msg) }
            warnings?.append(msg)
            return
        }
        var qty = rawQty
        var unit = rawUnit
        if unit != m.yieldUnit {
            guard let converted = convertQty(qty, from: unit, to: m.yieldUnit) else {
                let msg = "recipe '\(slug)' yields in '\(m.yieldUnit)' but demand asked for \(qty) '\(unit)'"
                if warnings == nil { throw BomExpandError.unitMismatch(msg) }
                warnings?.append(msg)
                return
            }
            qty = converted
            unit = m.yieldUnit
        }
        if m.yieldQty <= 0 {
            let msg = "recipe '\(slug)' has non-positive yield_qty \(m.yieldQty); cannot scale"
            if warnings == nil { throw BomExpandError.invalidYield(msg) }
            warnings?.append(msg)
            return
        }

        let scale = qty / m.yieldQty

        for row in m.bom {
            let ingredient = row.ingredient
            let rowQty = row.qty
            let rowUnit = row.unit

            var subSlug = row.subSlug
            if subSlug == nil && (row.isSubRecipe || couldBeSub(m, ingredient: ingredient, manifest: manifest)) {
                subSlug = resolveSubSlug(manifest, parent: m, ingredient: ingredient)
            }

            if let ss = subSlug, manifest[ss] == nil {
                let msg = "recipe '\(slug)' pins sub-recipe '\(ss)' which is not in the manifest"
                if warnings == nil { throw BomExpandError.unknownRecipe(msg) }
                warnings?.append(msg)
                continue
            }

            if let ss = subSlug, let subM = manifest[ss] {
                var demandQty = rowQty * scale
                if rowUnit != subM.yieldUnit {
                    guard let converted = reconcileSubUnitQty(subM, qty: demandQty, fromUnit: rowUnit) else {
                        let msg = subUnitMismatchMessage(parentSlug: slug, subSlug: ss, subM: subM, rowUnit: rowUnit)
                        if warnings == nil { throw BomExpandError.unitMismatch(msg) }
                        warnings?.append(msg)
                        continue
                    }
                    demandQty = converted
                }
                try expandInto(
                    manifest, slug: ss, qty: demandQty, unit: subM.yieldUnit,
                    out: &out, visited: visited + [slug], warnings: &warnings
                )
            } else {
                out[BomKey(ingredient, rowUnit), default: 0.0] += rowQty * scale
            }
        }
    }

    private static func accumulateRecipeDemand(
        _ manifest: [String: RecipeManifest],
        slug: String, qty rawQty: Double, unit rawUnit: String,
        out: inout [BomKey: Double],
        visited: [String],
        warnings: inout [String]?
    ) throws {
        guard let m = manifest[slug] else {
            let msg = "recipe '\(slug)' is not in the manifest"
            if warnings == nil { throw BomExpandError.unknownRecipe(msg) }
            warnings?.append(msg)
            return
        }
        if visited.contains(slug) {
            let idx = visited.firstIndex(of: slug)!
            let path = Array(visited[idx...]) + [slug]
            let msg = "sub-recipe cycle: \(path.joined(separator: " -> "))"
            if warnings == nil { throw BomExpandError.recipeCycle(msg) }
            warnings?.append(msg)
            return
        }
        var qty = rawQty
        var unit = rawUnit
        if unit != m.yieldUnit {
            guard let converted = convertQty(qty, from: unit, to: m.yieldUnit) else {
                let msg = "recipe '\(slug)' yields in '\(m.yieldUnit)' but demand asked for \(qty) '\(unit)'"
                if warnings == nil { throw BomExpandError.unitMismatch(msg) }
                warnings?.append(msg)
                return
            }
            qty = converted
            unit = m.yieldUnit
        }
        if m.yieldQty <= 0 {
            let msg = "recipe '\(slug)' has non-positive yield_qty \(m.yieldQty); cannot scale"
            if warnings == nil { throw BomExpandError.invalidYield(msg) }
            warnings?.append(msg)
            return
        }

        out[BomKey(slug, unit), default: 0.0] += qty

        let scale = qty / m.yieldQty

        for row in m.bom {
            let ingredient = row.ingredient
            let rowQty = row.qty
            let rowUnit = row.unit

            var subSlug = row.subSlug
            if subSlug == nil && (row.isSubRecipe || couldBeSub(m, ingredient: ingredient, manifest: manifest)) {
                subSlug = resolveSubSlug(manifest, parent: m, ingredient: ingredient)
            }

            if let ss = subSlug, manifest[ss] == nil {
                let msg = "recipe '\(slug)' pins sub-recipe '\(ss)' which is not in the manifest"
                if warnings == nil { throw BomExpandError.unknownRecipe(msg) }
                warnings?.append(msg)
                continue
            }

            guard let ss = subSlug, let subM = manifest[ss] else {
                continue  // leaf rows are not recipe nodes
            }

            var demandQty = rowQty * scale
            if rowUnit != subM.yieldUnit {
                guard let converted = reconcileSubUnitQty(subM, qty: demandQty, fromUnit: rowUnit) else {
                    let msg = subUnitMismatchMessage(parentSlug: slug, subSlug: ss, subM: subM, rowUnit: rowUnit)
                    if warnings == nil { throw BomExpandError.unitMismatch(msg) }
                    warnings?.append(msg)
                    continue
                }
                demandQty = converted
            }
            try accumulateRecipeDemand(
                manifest, slug: ss, qty: demandQty, unit: subM.yieldUnit,
                out: &out, visited: visited + [slug], warnings: &warnings
            )
        }
    }

    // MARK: - Sub-recipe name resolution

    private static func tokens(_ s: String) -> Set<String> {
        Set(
            s.lowercased()
                .replacingOccurrences(of: "_", with: " ")
                .split(whereSeparator: { $0.isWhitespace })
                .map(String.init)
        )
    }

    private static func couldBeSub(
        _ parent: RecipeManifest, ingredient: String, manifest: [String: RecipeManifest]
    ) -> Bool {
        let toks = tokens(ingredient)
        if toks.isEmpty { return false }
        for slug in parent.subRecipeSlugs {
            var cands = [tokens(slug)]
            if let sub = manifest[slug] { cands.append(tokens(sub.displayName)) }
            for c in cands where toks == c || toks.isSubset(of: c) {
                return true
            }
        }
        return false
    }

    private static func resolveSubSlug(
        _ manifest: [String: RecipeManifest], parent: RecipeManifest, ingredient: String
    ) -> String? {
        if parent.subRecipeSlugs.isEmpty { return nil }
        let ingToks = tokens(ingredient)
        if ingToks.isEmpty { return nil }
        let ingSlugForm = ingredient
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: " ", with: "_")

        // Pass 1: exact slug.
        if parent.subRecipeSlugs.contains(ingSlugForm) { return ingSlugForm }

        var best: String? = nil
        var bestOverlap = -1
        for slug in parent.subRecipeSlugs {
            let displayToks = manifest[slug].map { tokens($0.displayName) } ?? []
            let slugToks = tokens(slug)
            // Pass 2: equality.
            if ingToks == slugToks || ingToks == displayToks { return slug }
            // Pass 3: subset, keeping the tightest (max-overlap) match.
            for cand in [slugToks, displayToks] where ingToks.isSubset(of: cand) {
                let overlap = ingToks.intersection(cand).count
                if overlap > bestOverlap {
                    best = slug
                    bestOverlap = overlap
                }
            }
        }
        return best
    }
}
