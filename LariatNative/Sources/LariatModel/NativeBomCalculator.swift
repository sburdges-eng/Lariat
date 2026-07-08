// NativeBomCalculator — in-process RecipeCalculating (Native 0.2 L1 Wave C C1).
// Reproduces the scripts/bom_expand_cli.py contract using RecipeManifestLoader
// + BomExpandCompute, with NO python spawn. Replaces PythonBomCalculator.
//
// Error parity (wire-parity spec): the spawn-only codes `timeout`/`spawn_failed`
// are gone (in-process); expansion failures map to `expand_failed`;
// `bad_guest_count` (BEO guard) is preserved.

import Foundation

public struct NativeBomCalculator: RecipeCalculating {
    let root: String

    public init(root: String) { self.root = root }

    /// Env/cwd parity with the former PythonBomCalculator: `LARIAT_ROOT || cwd`.
    public init(
        env: [String: String] = ProcessInfo.processInfo.environment,
        cwd: String = FileManager.default.currentDirectoryPath
    ) {
        self.root = env["LARIAT_ROOT"] ?? cwd
    }

    public func scaleRecipe(slug: String, multiplier: Double) async throws -> RecipeExpandResult {
        let manifest = try loadManifest()
        return try expand(manifest: manifest, slug: slug, qty: nil, multiplier: multiplier)
    }

    public func expandForBEO(
        recipes: [(slug: String, portionsPerGuest: Double)], guestCount: Double
    ) async throws -> [RecipeExpandResult] {
        guard guestCount.isFinite, guestCount > 0 else {
            throw RecipeCalculatorError("guestCount must be a positive finite number", code: "bad_guest_count")
        }
        let manifest = try loadManifest()
        return try recipes.map { r in
            try expand(manifest: manifest, slug: r.slug, qty: r.portionsPerGuest * guestCount, multiplier: nil)
        }
    }

    // MARK: - Internals

    private func loadManifest() throws -> [String: RecipeManifest] {
        let base = URL(fileURLWithPath: root)
        do {
            return try RecipeManifestLoader.loadManifest(
                recipeIndex: base.appendingPathComponent("recipes/recipe_index.csv"),
                normalizedDir: base.appendingPathComponent("recipes/normalized")
            )
        } catch {
            throw RecipeCalculatorError("failed to build manifest: \(error.localizedDescription)", code: "expand_failed")
        }
    }

    /// Mirrors bom_expand_cli.py: qty_f = qty ?? multiplier*yield_qty, expand at
    /// (qty_f, yield_unit), scale = qty_f/yield_qty, leaf_rows sorted by (name, unit).
    private func expand(
        manifest: [String: RecipeManifest], slug: String, qty: Double?, multiplier: Double?
    ) throws -> RecipeExpandResult {
        guard let recipe = manifest[slug] else {
            throw RecipeCalculatorError("unknown recipe slug: '\(slug)'", code: "expand_failed")
        }
        let targetUnit = recipe.yieldUnit
        let qtyF: Double
        if let qty { qtyF = qty }
        else if let multiplier { qtyF = multiplier * recipe.yieldQty }
        else { throw RecipeCalculatorError("one of qty or multiplier is required", code: "expand_failed") }

        let leaves: [BomKey: Double]
        do {
            leaves = try BomExpandCompute.expandRecipe(manifest, slug: slug, qty: qtyF, unit: targetUnit)
        } catch let e as BomExpandError {
            throw RecipeCalculatorError(Self.mapExpandError(e), code: "expand_failed")
        }

        let scale = recipe.yieldQty != 0 ? qtyF / recipe.yieldQty : 0.0
        let leafRows = leaves
            .sorted { ($0.key.name, $0.key.unit) < ($1.key.name, $1.key.unit) }
            .map { RecipeLeafRow(ingredient: $0.key.name, qty: $0.value, unit: $0.key.unit) }
        return RecipeExpandResult(
            recipeSlug: slug, targetQty: qtyF, targetUnit: targetUnit, scaleFactor: scale, leafRows: leafRows
        )
    }

    /// bom_expand_cli.py error-message wrapping (preserved for the assistant UI).
    private static func mapExpandError(_ e: BomExpandError) -> String {
        switch e {
        case .unknownRecipe(let m): return "unknown sub-recipe: \(m)"
        case .unitMismatch(let m): return "unit mismatch: \(m)"
        case .recipeCycle(let m): return "recipe cycle: \(m)"
        case .invalidYield(let m): return "invalid recipe: \(m)"
        }
    }
}
