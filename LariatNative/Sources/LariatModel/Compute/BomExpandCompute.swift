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

    /// Graceful `aggregateDemand`: unresolvable rows append to `warnings` and
    /// are skipped instead of throwing (the BEO cascade degradation path).
    public static func aggregateDemand(
        _ manifest: [String: RecipeManifest], demands: [(String, Double, String)],
        warnings: inout [String]
    ) -> [BomKey: Double] {
        var out: [BomKey: Double] = [:]
        var sink: [String]? = warnings
        for (slug, qty, unit) in demands {
            var leaves: [BomKey: Double] = [:]
            do {
                try expandInto(manifest, slug: slug, qty: qty, unit: unit, out: &leaves, visited: [], warnings: &sink)
            } catch {}
            for (key, val) in leaves {
                out[key, default: 0.0] += val
            }
        }
        warnings = sink ?? []
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

    /// Graceful `expandRecipeDemand`: unresolvable rows append to `warnings`
    /// and are skipped instead of throwing (the BEO cascade degradation path).
    public static func expandRecipeDemand(
        _ manifest: [String: RecipeManifest], demands: [(String, Double, String)],
        warnings: inout [String]
    ) -> [BomKey: Double] {
        var out: [BomKey: Double] = [:]
        var sink: [String]? = warnings
        for (slug, qty, unit) in demands {
            do {
                try accumulateRecipeDemand(manifest, slug: slug, qty: qty, unit: unit, out: &out, visited: [], warnings: &sink)
            } catch {}
        }
        warnings = sink ?? []
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

            let subSlug = rowSubSlug(manifest, parent: m, row: row)

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

    /// The sub-recipe slug a BOM row resolves to, or nil for a leaf row.
    ///
    /// THE single predicate for "is this BOM row a sub-recipe?". Every walker
    /// must ask the same question: the order guide scales a recipe's own leaf
    /// rows while the prep board settles its sub-recipes as separate nodes, so
    /// if the two disagree about which rows are leaves, an ingredient is either
    /// ordered twice or dropped from the guide entirely.
    ///
    /// The returned slug is NOT guaranteed to be in `manifest` — callers keep
    /// their own unknown-slug handling, which differs by walker (fail loud vs
    /// warn). Port of `_row_sub_slug` in bom_expand.py.
    static func rowSubSlug(
        _ manifest: [String: RecipeManifest], parent: RecipeManifest, row: BomRow
    ) -> String? {
        if let pinned = row.subSlug { return pinned }
        guard row.isSubRecipe || couldBeSub(parent, ingredient: row.ingredient, manifest: manifest) else {
            return nil
        }
        return resolveSubSlug(manifest, parent: parent, ingredient: row.ingredient)
    }

    // MARK: - Batch flooring (port of the order walk in bom_expand.py)
    //
    // A BEO orders and preps in batches, because that is what a kitchen can
    // actually make. Three numbers per recipe per event:
    //
    //   consumption  what the event eats     qty / yieldQty, linear, never floored
    //   order        what to buy             whole batches, up, never fewer than one
    //   prep         what to make            half-batch granularity, up
    //
    // Spec: docs/superpowers/specs/2026-07-28-beo-batch-ordering-design.md.
    // This is a port of `_settle_order_batches` and friends; the Python stays
    // the oracle and the fixtures under Tests/Fixtures/BeoCascade pin them
    // together.

    /// Does this recipe get rounded up to whole batches?
    ///
    /// Only when its yield is a real measure — volume or weight. Those are the
    /// things a kitchen mixes in batches and cannot make a third of: brines,
    /// rubs, sauces, flours. Over-making one is cheap, because it gets used in
    /// standard service whether the event needed it all or not.
    ///
    /// A yield in `ea`, `case`, `portion`, `pan` or `hotel pan` is a count, not
    /// a batch. Flooring one orders a 60-piece batch of mac balls to serve 20,
    /// or a full case of churros for four portions — an over-order nothing
    /// absorbs. Those pass through at the honest linear figure.
    static func floorsInBatches(_ m: RecipeManifest) -> Bool {
        let yu = normalize(m.yieldUnit)
        return volumeToQt[yu] != nil || weightToLb[yu] != nil
    }

    /// Round a batch count UP to `granularity`, never below one step — unless
    /// nothing is demanded at all, which stays zero.
    ///
    /// Ordering uses granularity 1.0 (whole batches); prep uses 0.5, because a
    /// half batch is makeable and a quarter is not. Rounding is always up: 0.78
    /// of a batch rounded down to 0.5 would make less than the event eats.
    static func roundUpBatches(_ batches: Double, granularity: Double) -> Double {
        precondition(granularity > 0, "granularity must be positive, got \(granularity)")
        // Nothing demanded is nothing made. The floor below exists to turn a
        // FRACTION of a batch into a whole one; applied to zero it invents food
        // the event never eats. A per_count of 0 means "on the menu, consumes
        // none of this recipe", and that has to stay zero all the way down the
        // sub-recipe walk rather than becoming a full batch — and a full batch
        // of every sub under it.
        //
        // A trace is NOT zero: 0.01 qt still buys the whole batch below.
        if batches <= 0 { return 0.0 }
        // Epsilon so an exact batch count is not pushed to the next step by
        // float error — 12.0/12.0 must stay one batch, not become two.
        let steps = (batches / granularity - 1e-9).rounded(.up)
        return Swift.max(1.0, steps) * granularity
    }

    /// Collect nodes and per-batch sub-recipe coefficients for the order walk.
    private static func discoverOrderGraph(
        _ manifest: [String: RecipeManifest],
        slug: String, qty rawQty: Double, unit rawUnit: String,
        edges: inout [String: [(String, Double)]],
        seeds: inout [String: Double],
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
        if rawUnit != m.yieldUnit {
            guard let converted = convertQty(qty, from: rawUnit, to: m.yieldUnit) else {
                let msg = "recipe '\(slug)' yields in '\(m.yieldUnit)' but demand asked for \(qty) '\(rawUnit)'"
                if warnings == nil { throw BomExpandError.unitMismatch(msg) }
                warnings?.append(msg)
                return
            }
            qty = converted
        }
        if m.yieldQty <= 0 {
            let msg = "recipe '\(slug)' has non-positive yield_qty \(m.yieldQty); cannot scale"
            if warnings == nil { throw BomExpandError.invalidYield(msg) }
            warnings?.append(msg)
            return
        }

        seeds[slug, default: 0.0] += qty
        if edges[slug] != nil { return }  // already mapped; seeds still accumulate
        edges[slug] = []

        for row in m.bom {
            let rowQty = row.qty
            let rowUnit = row.unit

            guard let ss = rowSubSlug(manifest, parent: m, row: row) else { continue }
            guard let subM = manifest[ss] else {
                let msg = "recipe '\(slug)' pins sub-recipe '\(ss)' which is not in the manifest"
                if warnings == nil { throw BomExpandError.unknownRecipe(msg) }
                warnings?.append(msg)
                continue
            }

            // Coefficient is per ONE batch of the parent, so the settle pass
            // can multiply it by whatever the parent rounds to.
            var perBatch = rowQty
            if rowUnit != subM.yieldUnit {
                guard let converted = reconcileSubUnitQty(subM, qty: perBatch, fromUnit: rowUnit) else {
                    let msg = subUnitMismatchMessage(parentSlug: slug, subSlug: ss, subM: subM, rowUnit: rowUnit)
                    if warnings == nil { throw BomExpandError.unitMismatch(msg) }
                    warnings?.append(msg)
                    continue
                }
                perBatch = converted
            }
            edges[slug]?.append((ss, perBatch))
            try discoverOrderGraph(
                manifest, slug: ss, qty: 0.0, unit: subM.yieldUnit,
                edges: &edges, seeds: &seeds, visited: visited + [slug], warnings: &warnings
            )
        }
    }

    /// Settle every reachable recipe node to a whole (or half) batch COUNT.
    ///
    /// This is the one kernel behind both floored channels — `expandRecipeOrders`
    /// (recipe-node quantities, for the prep board) and `aggregateOrderDemand`
    /// (leaf-ingredient quantities, for the order guide). They read the same
    /// primitive rather than one dividing the other's answer back out, so a
    /// BEO's two tabs cannot disagree about how many batches a recipe is.
    ///
    /// Nodes settle in dependency order, parents before children, so a
    /// sub-recipe shared by two parents is summed BEFORE it is rounded.
    /// Rounding each branch separately would order two batches of lariat rub
    /// for a Nashville slider — one for the hot rub, one for the oil — where a
    /// single batch covers both.
    static func settleOrderBatches(
        _ manifest: [String: RecipeManifest],
        demands: [(String, Double, String)],
        granularity: Double,
        warnings: inout [String]?
    ) throws -> [String: Double] {
        // Pass 1 — discover the reachable graph and its edges.
        var edges: [String: [(String, Double)]] = [:]
        var seeds: [String: Double] = [:]
        for (slug, qty, unit) in demands {
            try discoverOrderGraph(
                manifest, slug: slug, qty: qty, unit: unit,
                edges: &edges, seeds: &seeds, visited: [], warnings: &warnings
            )
        }

        // Pass 2 — settle in dependency order (Kahn), rounding each node's TOTAL.
        //
        // `edges` holds only the nodes discovery actually mapped. A sub-recipe
        // that bailed out (cycle, non-positive yield) had its EDGE recorded by
        // the parent before the recursion returned, so it can be an edge target
        // with no edge list of its own. Enqueuing one would divide by its zero
        // yield — taking down an entire event where the linear walk merely
        // warned. `edges[child] == nil` is that node; skip it.
        var indegree: [String: Int] = [:]
        for node in edges.keys { indegree[node] = 0 }
        for (_, children) in edges {
            for (child, _) in children where edges[child] != nil {
                indegree[child, default: 0] += 1
            }
        }
        var pending = seeds
        var ready = edges.keys.filter { (indegree[$0] ?? 0) == 0 }
        var batches: [String: Double] = [:]

        while let node = ready.popLast() {
            guard let m = manifest[node] else { continue }
            let raw = (pending[node] ?? 0.0) / m.yieldQty
            let n = floorsInBatches(m) ? roundUpBatches(raw, granularity: granularity) : raw
            batches[node] = n
            for (child, perBatch) in edges[node] ?? [] {
                pending[child, default: 0.0] += perBatch * n
                guard edges[child] != nil else { continue }
                indegree[child]! -= 1
                if indegree[child]! == 0 { ready.append(child) }
            }
        }

        // A node left with indegree > 0 sits inside a cycle: Kahn never reaches
        // it, so it silently vanishes from the prep board and the order guide.
        // Discovery already warned about the cycle itself, but not that these
        // recipes went missing because of it — and a prep sheet that is quietly
        // short is worse than one that says why.
        for node in Set(edges.keys).subtracting(batches.keys).sorted() {
            let msg = "recipe '\(node)' could not be settled to a batch count (sub-recipe "
                + "cycle); it is omitted from the order guide and the prep board"
            if warnings == nil { throw BomExpandError.recipeCycle(msg) }
            warnings?.append(msg)
        }
        return batches
    }

    /// Recipe-node quantities rounded up to whole batches at every level.
    ///
    /// Same shape as `expandRecipeDemand` — [(slug, yieldUnit): qty] — but every
    /// node is a whole number of batches (or halves at granularity 0.5), and a
    /// sub-recipe's demand derives from its parent's ROUNDED figure.
    public static func expandRecipeOrders(
        _ manifest: [String: RecipeManifest],
        demands: [(String, Double, String)],
        granularity: Double,
        warnings: inout [String]
    ) -> [BomKey: Double] {
        var sink: [String]? = warnings
        let batches = (try? settleOrderBatches(manifest, demands: demands, granularity: granularity, warnings: &sink)) ?? [:]
        warnings = sink ?? []
        var out: [BomKey: Double] = [:]
        for (slug, n) in batches {
            guard let m = manifest[slug] else { continue }
            out[BomKey(slug, m.yieldUnit)] = n * m.yieldQty
        }
        return out
    }

    /// Leaf-ingredient totals for the batches you will actually make.
    ///
    /// Same shape as `aggregateDemand` — [(ingredient, unit): qty] — but each
    /// recipe's BOM is scaled by the batch count the settle lands on, not by the
    /// raw linear fraction.
    ///
    /// Only a recipe's OWN leaf rows are walked. A sub-recipe row is skipped
    /// because the sub is already its own settled node and contributes its own
    /// leaves — counting it here would double-order.
    ///
    /// Leaf units are NOT converted, matching `expandInto` exactly: the row's own
    /// unit is the key. A guide that silently re-expressed cup as qt would no
    /// longer line up with the vendor pack it gets compared against.
    public static func aggregateOrderDemand(
        _ manifest: [String: RecipeManifest],
        demands: [(String, Double, String)],
        granularity: Double,
        warnings: inout [String]
    ) -> [BomKey: Double] {
        var sink: [String]? = warnings
        let batches = (try? settleOrderBatches(manifest, demands: demands, granularity: granularity, warnings: &sink)) ?? [:]
        warnings = sink ?? []
        var out: [BomKey: Double] = [:]
        for (slug, n) in batches {
            guard let m = manifest[slug] else { continue }
            for row in m.bom {
                // The sub is already its own settled node and contributes its
                // own leaves — counting it here would double-order.
                if rowSubSlug(manifest, parent: m, row: row) != nil { continue }
                out[BomKey(row.ingredient, row.unit), default: 0.0] += row.qty * n
            }
        }
        return out
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
