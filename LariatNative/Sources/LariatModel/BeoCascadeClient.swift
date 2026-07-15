import Foundation

// BEO cascade wrapper — port of `lib/beoCascade.ts`. Native 0.2 L1 Wave C flips
// the DEFAULT runner to IN-PROCESS: it computes via `BeoCascadeCompute` (the
// Swift port of `build_cascade`) instead of spawning `scripts/beo_cascade_cli.py`.
// The injectable `Runner` seam is retained so tests can supply canned JSON, and
// `parseCascadeResponse` is unchanged (the in-process runner re-emits the CLI's
// JSON shape). This resolves the A6.5 #369 watch note (cascade math is now
// re-implemented + parity-tested in Swift, Waves B+C).

// MARK: - Public types (OrderGuideRow / PrepDemandRow / UnmappedRow / CascadeResult)

public struct CascadeOrderGuideRow: Equatable, Sendable {
    public let ingredient: String
    public let unit: String
    public let totalNeeded: Double
    public let onHand: Double
    public let toOrder: Double

    public init(ingredient: String, unit: String, totalNeeded: Double, onHand: Double, toOrder: Double) {
        self.ingredient = ingredient; self.unit = unit
        self.totalNeeded = totalNeeded; self.onHand = onHand; self.toOrder = toOrder
    }
}

public struct CascadePrepDemandRow: Equatable, Sendable {
    public let recipeSlug: String
    public let displayName: String
    public let qty: Double
    public let unit: String

    public init(recipeSlug: String, displayName: String, qty: Double, unit: String) {
        self.recipeSlug = recipeSlug; self.displayName = displayName
        self.qty = qty; self.unit = unit
    }
}

public struct CascadeUnmappedRow: Equatable, Sendable {
    public let menuItem: String
    public let reason: String

    public init(menuItem: String, reason: String) {
        self.menuItem = menuItem
        self.reason = reason
    }
}

public struct CascadeManifestWarningRow: Equatable, Sendable {
    public let recipe: String
    public let issue: String

    public init(recipe: String, issue: String) {
        self.recipe = recipe
        self.issue = issue
    }
}

public struct CascadeResult: Equatable, Sendable {
    public let orderGuide: [CascadeOrderGuideRow]
    public let prepDemands: [CascadePrepDemandRow]
    public let unmapped: [CascadeUnmappedRow]
    public let manifestWarnings: [CascadeManifestWarningRow]
    /// Graceful-degradation notices (bad unit / unknown sub-recipe / cycle) — a
    /// recipe dropped from the order guide + prep board instead of aborting.
    /// Mirrors the web `CascadeResult.warnings` string[]; dropping it silently
    /// under-orders. May be empty.
    public let warnings: [String]

    public init(
        orderGuide: [CascadeOrderGuideRow],
        prepDemands: [CascadePrepDemandRow],
        unmapped: [CascadeUnmappedRow],
        manifestWarnings: [CascadeManifestWarningRow] = [],
        warnings: [String] = []
    ) {
        self.orderGuide = orderGuide
        self.prepDemands = prepDemands
        self.unmapped = unmapped
        self.manifestWarnings = manifestWarnings
        self.warnings = warnings
    }
}

/// Mirrors the web `CascadeError` (message + machine code). Codes:
/// `timeout`, `spawn_failed`, `bad_json`, `bad_shape`, `cli_error`, `exit_N`.
public struct CascadeError: Error, Equatable, LocalizedError {
    public let message: String
    public let code: String

    public init(message: String, code: String = "cascade_error") {
        self.message = message
        self.code = code
    }

    public var errorDescription: String? { message }
}

public struct CascadeLineItem: Equatable, Sendable {
    public let itemName: String
    public let quantity: Double

    public init(itemName: String, quantity: Double) {
        self.itemName = itemName
        self.quantity = quantity
    }
}

public struct CascadeInventoryRow: Equatable, Sendable {
    public let ingredient: String
    public let unit: String
    public let onHand: Double

    public init(ingredient: String, unit: String, onHand: Double) {
        self.ingredient = ingredient
        self.unit = unit
        self.onHand = onHand
    }
}

// MARK: - Client

public struct BeoCascadeClient {
    /// Runs the CLI: stdin payload in, stdout string back. Throws
    /// `CascadeError` on spawn/exit/timeout failures.
    public typealias Runner = (_ payload: Data, _ timeout: TimeInterval) async throws -> String

    /// Web `DEFAULT_TIMEOUT_MS = 15000` — generous headroom for a cold
    /// Python interpreter walking a large recipes/ directory.
    public static let defaultTimeout: TimeInterval = 15

    private let runner: Runner

    public init(runner: @escaping Runner = BeoCascadeClient.inProcessRunner) {
        self.runner = runner
    }

    /// Port of `cascadeFromLineItems`. Empty `lineItems` short-circuits to
    /// all-empty arrays without spawning (cheaper; the CLI would return
    /// empty arrays anyway).
    public func cascadeFromLineItems(
        _ lineItems: [CascadeLineItem],
        qtyInYieldUnits: Bool = false,
        inventory: [CascadeInventoryRow]? = nil,
        root: String? = nil,
        timeout: TimeInterval = BeoCascadeClient.defaultTimeout
    ) async throws -> CascadeResult {
        if lineItems.isEmpty {
            return CascadeResult(orderGuide: [], prepDemands: [], unmapped: [])
        }
        let payload = try Self.buildPayload(
            lineItems: lineItems,
            root: root ?? Self.resolveProjectRoot(),
            qtyInYieldUnits: qtyInYieldUnits,
            inventory: inventory
        )
        let raw = try await runner(payload, timeout)
        return try Self.parseCascadeResponse(raw)
    }

    // MARK: Pure pieces (unit-tested without spawning)

    /// Resolve the root that owns `recipes/` (D1-B). Order: explicit
    /// `LARIAT_ROOT`; then a dev cwd-walk for the `scripts/beo_cascade_cli.py`
    /// marker; then the parent of `LARIAT_DATA_DIR`; then — for a packaged
    /// `.app` with no dev `scripts/` — `~/Library/Application Support/Lariat`
    /// when it actually holds recipes; else `cwd`.
    public static func resolveProjectRoot(
        env: [String: String] = ProcessInfo.processInfo.environment,
        cwd: String = FileManager.default.currentDirectoryPath,
        fileExists: (String) -> Bool = { FileManager.default.fileExists(atPath: $0) }
    ) -> String {
        if let root = env["LARIAT_ROOT"], !root.isEmpty { return root }
        let marker = "scripts/beo_cascade_cli.py"
        var dir = cwd
        for _ in 0..<8 {
            if fileExists((dir as NSString).appendingPathComponent(marker)) { return dir }
            let parent = (dir as NSString).deletingLastPathComponent
            if parent == dir || parent.isEmpty { break }
            dir = parent
        }
        if let data = env["LARIAT_DATA_DIR"], !data.isEmpty {
            let parent = (data as NSString).deletingLastPathComponent
            if fileExists((parent as NSString).appendingPathComponent(marker)) { return parent }
        }
        // D1-B packaged default: no dev `scripts/` marker in a `.app`, so fall
        // back to the Application Support recipe root when it holds recipes.
        if let appSupport = applicationSupportRoot(env: env),
           fileExists((appSupport as NSString).appendingPathComponent("recipes/recipe_index.csv")) {
            return appSupport
        }
        return cwd
    }

    /// `~/Library/Application Support/Lariat` — the D1-B packaged `LARIAT_ROOT`.
    static func applicationSupportRoot(env: [String: String]) -> String? {
        guard let home = env["HOME"], !home.isEmpty else { return nil }
        return (home as NSString).appendingPathComponent("Library/Application Support/Lariat")
    }

    /// CLI stdin contract: `{line_items, root, qty_in_yield_units[, inventory]}`.
    /// `inventory` is only attached when provided (web: `!== undefined`).
    public static func buildPayload(
        lineItems: [CascadeLineItem],
        root: String,
        qtyInYieldUnits: Bool,
        inventory: [CascadeInventoryRow]?
    ) throws -> Data {
        var payload: [String: Any] = [
            "line_items": lineItems.map { ["item_name": $0.itemName, "quantity": $0.quantity] },
            "root": root,
            "qty_in_yield_units": qtyInYieldUnits,
        ]
        if let inventory {
            payload["inventory"] = inventory.map {
                ["ingredient": $0.ingredient, "unit": $0.unit, "on_hand": $0.onHand]
            }
        }
        return try JSONSerialization.data(withJSONObject: payload)
    }

    /// Port of `parseCascadeResponse` — same coercions (`String(x ?? '')`,
    /// `Number(x ?? 0)`) and error codes.
    public static func parseCascadeResponse(_ raw: String) throws -> CascadeResult {
        let parsed: Any
        do {
            parsed = try JSONSerialization.jsonObject(
                with: Data(raw.utf8),
                options: [.fragmentsAllowed]
            )
        } catch {
            throw CascadeError(
                message: "cascade returned invalid JSON: \(error.localizedDescription)",
                code: "bad_json"
            )
        }
        guard let obj = parsed as? [String: Any] else {
            throw CascadeError(message: "cascade returned non-object", code: "bad_shape")
        }
        if let errorMessage = obj["error"] as? String {
            throw CascadeError(message: errorMessage, code: "cli_error")
        }
        guard let orderGuide = obj["order_guide"] as? [Any],
              let prepDemands = obj["prep_demands"] as? [Any],
              let unmapped = obj["unmapped"] as? [Any]
        else {
            throw CascadeError(message: "cascade response missing expected arrays", code: "bad_shape")
        }

        return CascadeResult(
            orderGuide: orderGuide.map { row in
                let r = row as? [String: Any] ?? [:]
                return CascadeOrderGuideRow(
                    ingredient: str(r["ingredient"]),
                    unit: str(r["unit"]),
                    totalNeeded: num(r["total_needed"]),
                    onHand: num(r["on_hand"]),
                    toOrder: num(r["to_order"])
                )
            },
            prepDemands: prepDemands.map { row in
                let r = row as? [String: Any] ?? [:]
                return CascadePrepDemandRow(
                    recipeSlug: str(r["recipe_slug"]),
                    displayName: str(r["display_name"]),
                    qty: num(r["qty"]),
                    unit: str(r["unit"])
                )
            },
            unmapped: unmapped.map { row in
                let r = row as? [String: Any] ?? [:]
                return CascadeUnmappedRow(menuItem: str(r["menu_item"]), reason: str(r["reason"]))
            },
            // Additive + optional: older CLIs omit manifest_warnings → [].
            manifestWarnings: (obj["manifest_warnings"] as? [Any] ?? []).map { row in
                let r = row as? [String: Any] ?? [:]
                return CascadeManifestWarningRow(recipe: str(r["recipe"]), issue: str(r["issue"]))
            },
            // Additive + optional: older CLIs omit warnings → []. Coerce each to
            // a string (the engine emits plain messages), mirroring web `.map(String)`.
            warnings: (obj["warnings"] as? [Any] ?? []).map { str($0) }
        )
    }

    private static func str(_ v: Any?) -> String {
        if let s = v as? String { return s }
        if let n = v as? NSNumber { return n.stringValue }
        return ""
    }

    private static func num(_ v: Any?) -> Double {
        if let n = v as? NSNumber { return n.doubleValue }
        if let s = v as? String, let d = Double(s) { return d }
        return 0
    }

    // MARK: Default runner (in-process — Native 0.2 L1 Wave C; no python spawn)

    /// Default runner: computes the cascade IN-PROCESS via `BeoCascadeCompute`
    /// (loading `recipes/` + `menus/beo_recipe_map.csv` from the payload's
    /// `root`) and returns the same JSON shape the python CLI emitted, so
    /// `parseCascadeResponse` and every injected-runner test are unchanged. A
    /// missing/invalid data dir yields `{"error": ...}` → `CascadeError`
    /// `cli_error`, mirroring the CLI's failure stdout. The injectable `Runner`
    /// seam is retained for tests. Replaces the former python3 process spawn.
    public static let inProcessRunner: Runner = { payload, _ in
        do {
            return try computeCascadeJSON(payload: payload)
        } catch {
            let obj: [String: Any] = ["error": (error as? CascadeError)?.message ?? error.localizedDescription]
            let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data(#"{"error":"cascade failed"}"#.utf8)
            return String(data: data, encoding: .utf8) ?? #"{"error":"cascade failed"}"#
        }
    }

    /// Decode the CLI payload, load the manifest + BEO map, run
    /// `BeoCascadeCompute.buildCascade`, and re-emit the CLI JSON shape.
    static func computeCascadeJSON(payload: Data) throws -> String {
        let obj = (try? JSONSerialization.jsonObject(with: payload)) as? [String: Any] ?? [:]
        let root = (obj["root"] as? String) ?? resolveProjectRoot()
        let qtyInYieldUnits = (obj["qty_in_yield_units"] as? Bool) ?? false
        let lineItems: [(String, Double)] = (obj["line_items"] as? [[String: Any]] ?? []).map {
            (str($0["item_name"]), num($0["quantity"]))
        }
        var inventory: [BomKey: Double]?
        if let rawInv = obj["inventory"] as? [[String: Any]], !rawInv.isEmpty {
            var inv: [BomKey: Double] = [:]
            for e in rawInv {
                let ing = str(e["ingredient"]).trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                let unit = str(e["unit"]).trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                if !ing.isEmpty { inv[BomKey(ing, unit)] = num(e["on_hand"]) }
            }
            inventory = inv
        }

        let base = URL(fileURLWithPath: root)
        let recipeIndex = base.appendingPathComponent("recipes/recipe_index.csv")
        let normalizedDir = base.appendingPathComponent("recipes/normalized")
        let beoMapCSV = base.appendingPathComponent("menus/beo_recipe_map.csv")

        // Same fail-fast file checks as beo_cascade_cli.py main().
        let fm = FileManager.default
        var isDir: ObjCBool = false
        if !fm.fileExists(atPath: recipeIndex.path) {
            throw CascadeError(message: "missing recipe_index.csv at \(recipeIndex.path)", code: "cli_error")
        }
        if !(fm.fileExists(atPath: normalizedDir.path, isDirectory: &isDir) && isDir.boolValue) {
            throw CascadeError(message: "missing normalized dir at \(normalizedDir.path)", code: "cli_error")
        }
        if !fm.fileExists(atPath: beoMapCSV.path) {
            throw CascadeError(message: "missing beo_recipe_map.csv at \(beoMapCSV.path)", code: "cli_error")
        }

        let manifest = try RecipeManifestCache.shared.manifest(recipeIndex: recipeIndex, normalizedDir: normalizedDir)
        let (beoMap, mapUnresolved, scales) = RecipeManifestLoader.loadBeoRecipeMap(csv: beoMapCSV, manifest: manifest)
        let result = BeoCascadeCompute.buildCascade(
            manifest: manifest, beoMap: beoMap, lineItems: lineItems,
            qtyInYieldUnits: qtyInYieldUnits, inventory: inventory,
            mapWarnings: mapUnresolved, scales: scales
        )

        let out: [String: Any] = [
            "order_guide": result.orderGuide.map {
                ["ingredient": $0.ingredient, "unit": $0.unit, "total_needed": $0.totalNeeded,
                 "on_hand": $0.onHand, "to_order": $0.toOrder] as [String: Any]
            },
            "prep_demands": result.prepDemands.map {
                ["recipe_slug": $0.recipeSlug, "display_name": $0.displayName, "qty": $0.qty, "unit": $0.unit] as [String: Any]
            },
            "unmapped": result.unmapped.map {
                ["menu_item": $0.menuItem, "reason": $0.reason] as [String: Any]
            },
            "warnings": result.warnings,
            "manifest_warnings": result.manifestWarnings.map {
                ["recipe": $0.recipe, "issue": $0.issue] as [String: Any]
            },
        ]
        let data = try JSONSerialization.data(withJSONObject: out)
        return String(data: data, encoding: .utf8) ?? "{}"
    }
}
