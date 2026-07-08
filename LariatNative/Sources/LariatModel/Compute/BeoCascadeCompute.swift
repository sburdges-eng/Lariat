// BeoCascadeCompute — in-process BEO cascade, a Swift port of `build_cascade`
// in `scripts/beo_cascade_cli.py` (Native 0.2 L1 Wave B). Turns BEO line items
// into an order guide + prep-demand board + unmapped/warnings, degrading a
// single bad recipe to a warning instead of aborting the event.

import Foundation

/// Full in-process cascade result. Reuses the existing public Cascade* row
/// types and additionally carries `warnings` (the graceful-degradation
/// messages), which the spawn-based `CascadeResult` drops.
public struct BeoCascadeResult: Equatable, Sendable {
    public let orderGuide: [CascadeOrderGuideRow]
    public let prepDemands: [CascadePrepDemandRow]
    public let unmapped: [CascadeUnmappedRow]
    public let warnings: [String]
    public let manifestWarnings: [CascadeManifestWarningRow]

    public init(
        orderGuide: [CascadeOrderGuideRow],
        prepDemands: [CascadePrepDemandRow],
        unmapped: [CascadeUnmappedRow],
        warnings: [String],
        manifestWarnings: [CascadeManifestWarningRow]
    ) {
        self.orderGuide = orderGuide
        self.prepDemands = prepDemands
        self.unmapped = unmapped
        self.warnings = warnings
        self.manifestWarnings = manifestWarnings
    }
}

public enum BeoCascadeCompute {

    public static func buildCascade(
        manifest: [String: RecipeManifest],
        beoMap: [String: [String]],
        lineItems: [(String, Double)],
        qtyInYieldUnits: Bool = false,
        inventory: [BomKey: Double]? = nil,
        mapWarnings: [CascadeUnmappedRow] = [],
        scales: [BeoScaleKey: Double]? = nil
    ) -> BeoCascadeResult {
        // line_items → InvoiceRow; aggregate demand + per-row unmapped.
        let rows = lineItems.map { InvoiceRow(menuItem: $0.0, qty: $0.1, unit: "") }
        let (demand, rowUnmapped) = BeoPullCompute.buildDemand(
            rows, manifest: manifest, beoMap: beoMap,
            qtyInYieldUnits: qtyInYieldUnits, scales: scales
        )

        // Shared degradation sink for both traversals.
        var cascadeWarnings: [String] = []

        // Order guide (leaf ingredients).
        let orderGuide = BeoPullCompute.pullOrders(
            manifest, demand: demand, inventory: inventory, warnings: &cascadeWarnings
        )

        // Prep board (recipe nodes — parents AND sub-recipes), sorted by
        // (display_name.lower, unit). Python's sort is stable over DFS-insertion
        // order; Swift nodes are dict-sourced, so recipeSlug breaks ties
        // deterministically. ACCEPTED divergence from Python's insertion order
        // only when two DISTINCT recipes share a display name + unit (a
        // data-quality edge, not exercised by fixtures).
        let nodes = BomExpandCompute.expandRecipeDemand(manifest, demands: demand, warnings: &cascadeWarnings)
        var prepDemands = nodes.map { key, qty in
            CascadePrepDemandRow(
                recipeSlug: key.name,
                displayName: manifest[key.name]?.displayName ?? key.name,
                qty: qty,
                unit: key.unit
            )
        }
        prepDemands.sort {
            ($0.displayName.lowercased(), $0.unit, $0.recipeSlug)
                < ($1.displayName.lowercased(), $1.unit, $1.recipeSlug)
        }

        // All unmapped: map-level warnings FIRST, then per-row unmapped.
        let unmapped = mapWarnings + rowUnmapped

        // De-dupe cascade warnings, preserving first-seen order.
        var seen: Set<String> = []
        let warnings = cascadeWarnings.filter { seen.insert($0).inserted }

        // Manifest integrity, scoped to recipes THIS event actually reaches.
        let reachable = reachableSlugs(manifest, demand: demand)
        let manifestWarnings = BomExpandCompute.findManifestWarnings(manifest)
            .filter { reachable.contains($0.recipe) }
            .map { CascadeManifestWarningRow(recipe: $0.recipe, issue: $0.issue) }

        return BeoCascadeResult(
            orderGuide: orderGuide,
            prepDemands: prepDemands,
            unmapped: unmapped,
            warnings: warnings,
            manifestWarnings: manifestWarnings
        )
    }

    /// Every recipe slug reachable from this event's demand: the top-level
    /// demand slugs plus their transitive declared sub-recipes.
    static func reachableSlugs(
        _ manifest: [String: RecipeManifest], demand: [(String, Double, String)]
    ) -> Set<String> {
        var seen: Set<String> = []
        var stack = demand.map(\.0)
        while let slug = stack.popLast() {
            if seen.contains(slug) || manifest[slug] == nil { continue }
            seen.insert(slug)
            stack.append(contentsOf: manifest[slug]!.subRecipeSlugs)
        }
        return seen
    }
}
