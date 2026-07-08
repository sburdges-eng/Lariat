// BeoPullCompute — in-process BEO order pull, a Swift port of
// `scripts/lib/beo_pull.py` (Native 0.2 L1 Wave B).
//
// `load_beo_recipe_map` (CSV parsing) is intentionally deferred to Wave C
// alongside RecipeManifestLoader; the compute here takes an already-resolved
// `beoMap` + `scales` (fixtures supply them inline). Parity rules match
// BomExpandCompute: no rounding, raw IEEE-754, tolerance 1e-6.

import Foundation

public enum BeoPullCompute {

    /// Case-fold + strip so `"Navratil  "` and `"navratil"` compare equal.
    /// Ports Python `str(s).strip().casefold()` exactly via full Unicode case
    /// folding (`ß→ss`, Greek final sigma, ligatures) — `.lowercased()` alone
    /// diverges on non-ASCII menu/recipe names.
    public static func normalizeClient(_ s: String?) -> String {
        normName(s)
    }

    private static func normName(_ s: String?) -> String {
        guard let s else { return "" }
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
            .folding(options: .caseInsensitive, locale: nil)
    }

    /// Convert invoice rows to demand triples `(slug, qty, unit)`.
    ///
    /// Scaling precedence per (menu_item, recipe) mapping:
    ///   1. `scales[(nameKey, slug)]` present  → qty * per_count in yield units.
    ///   2. `qtyInYieldUnits == true`          → qty as-is in yield units.
    ///   3. default                            → qty * yield_qty (batch counts).
    /// Unmapped menu items are reported (never raised).
    public static func buildDemand(
        _ invoiceRows: [InvoiceRow],
        manifest: [String: RecipeManifest],
        beoMap: [String: [String]],
        qtyInYieldUnits: Bool = false,
        scales: [BeoScaleKey: Double]? = nil
    ) -> (demand: [(String, Double, String)], unmapped: [CascadeUnmappedRow]) {
        var demand: [(String, Double, String)] = []
        var unmapped: [CascadeUnmappedRow] = []

        for row in invoiceRows {
            let nameKey = normName(row.menuItem)
            if nameKey.isEmpty { continue }

            var slugs = beoMap[nameKey] ?? []
            if slugs.isEmpty {
                if let direct = directResolve(nameKey, manifest) {
                    slugs = [direct]
                } else {
                    unmapped.append(CascadeUnmappedRow(
                        menuItem: row.menuItem,
                        reason: "not in beo_recipe_map and no direct recipe match"
                    ))
                    continue
                }
            }

            for slug in slugs {
                guard let m = manifest[slug] else {
                    // Python formats the slug with {slug!r}; bare single quotes
                    // match for the [a-z0-9_] slug domain (accepted out-of-domain
                    // divergence for quote/backslash slugs — see the Wave A note).
                    unmapped.append(CascadeUnmappedRow(
                        menuItem: row.menuItem,
                        reason: "map points to unknown slug '\(slug)'"
                    ))
                    continue
                }
                if let perCount = scales?[BeoScaleKey(nameKey: nameKey, slug: slug)] {
                    demand.append((slug, row.qty * perCount, m.yieldUnit))
                } else if qtyInYieldUnits {
                    let trimmed = row.unit.trimmingCharacters(in: .whitespacesAndNewlines)
                    demand.append((slug, row.qty, trimmed.isEmpty ? m.yieldUnit : trimmed))
                } else {
                    demand.append((slug, row.qty * m.yieldQty, m.yieldUnit))
                }
            }
        }
        return (demand, unmapped)
    }

    /// Last-resort resolution when the map file is stale: match the menu item
    /// against a recipe's display name or its slug-with-spaces. Iterates in a
    /// deterministic sorted-slug order. Python iterates manifest INSERTION order
    /// and returns the first match; a Swift Dictionary can't recover that order,
    /// so on the data-quality edge where two recipes normalize to the same menu
    /// key the resolved slug may differ. ACCEPTED divergence — no fixture hits
    /// it; Wave C's RecipeManifestLoader could thread an ordered slug list.
    private static func directResolve(_ nameKey: String, _ manifest: [String: RecipeManifest]) -> String? {
        for slug in manifest.keys.sorted() {
            guard let m = manifest[slug] else { continue }
            if normName(m.displayName) == nameKey { return slug }
            if normName(slug.replacingOccurrences(of: "_", with: " ")) == nameKey { return slug }
        }
        return nil
    }

    /// Aggregate demand across recipes (with sub-recipe cascade), subtract
    /// on-hand inventory, and return one order line per leaf ingredient + unit,
    /// sorted by (ingredient, unit) for stable diffs. A bad recipe degrades to
    /// a `warnings` entry rather than aborting the whole pull.
    public static func pullOrders(
        _ manifest: [String: RecipeManifest],
        demand: [(String, Double, String)],
        inventory: [BomKey: Double]? = nil,
        warnings: inout [String]
    ) -> [CascadeOrderGuideRow] {
        let totals = BomExpandCompute.aggregateDemand(manifest, demands: demand, warnings: &warnings)
        var out: [CascadeOrderGuideRow] = []
        for (key, qty) in totals {
            let onHand = lookupInventory(inventory, ingredient: key.name, unit: key.unit)
            out.append(CascadeOrderGuideRow(
                ingredient: key.name,
                unit: key.unit,
                totalNeeded: qty,
                onHand: onHand,
                toOrder: max(0.0, qty - onHand)
            ))
        }
        // Python sorts by (ingredient.lower, unit.lower) with a stable sort over
        // an insertion-ordered list. Swift totals are dict-sourced (unordered)
        // and Array.sort isn't stable, so a case-sensitive (ingredient, unit)
        // tiebreak keeps case-variant duplicate leaves (a data anomaly) in a
        // deterministic, run-stable order.
        out.sort {
            ($0.ingredient.lowercased(), $0.unit.lowercased(), $0.ingredient, $0.unit)
                < ($1.ingredient.lowercased(), $1.unit.lowercased(), $1.ingredient, $1.unit)
        }
        return out
    }

    private static func lookupInventory(
        _ inventory: [BomKey: Double]?, ingredient: String, unit: String
    ) -> Double {
        guard let inventory else { return 0.0 }
        let ing = ingredient.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if let v = inventory[BomKey(ing, unit.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())] {
            return v
        }
        // Unit-agnostic fallback: same ingredient regardless of unit.
        if let v = inventory[BomKey(ing, "")] { return v }
        return 0.0
    }
}
