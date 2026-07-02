import Foundation

// BEO cascade wrapper — port of `lib/beoCascade.ts`, the authoritative path
// for converting BEO line items into an order guide + prep demands. Like the
// web wrapper, this shells out to `scripts/beo_cascade_cli.py`; the Python
// engine (`scripts/lib/bom_expand.py` + `beo_pull.py`) stays the single
// source of truth for cascade numbers — deliberately NOT re-implemented in
// Swift. See the A6.5 plan doc's #369 watch note.
//
// NOT in `Compute/` because the default runner performs process I/O
// (DishBridgeRecipeLoader precedent). The runner is injectable so parity
// tests never spawn Python.

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

public struct CascadeResult: Equatable, Sendable {
    public let orderGuide: [CascadeOrderGuideRow]
    public let prepDemands: [CascadePrepDemandRow]
    public let unmapped: [CascadeUnmappedRow]

    public init(orderGuide: [CascadeOrderGuideRow], prepDemands: [CascadePrepDemandRow], unmapped: [CascadeUnmappedRow]) {
        self.orderGuide = orderGuide
        self.prepDemands = prepDemands
        self.unmapped = unmapped
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

    public init(runner: @escaping Runner = BeoCascadeClient.processRunner) {
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

    /// Resolve at call time, not init. Web parity is `LARIAT_ROOT || cwd`, but
    /// the web server's cwd IS the repo root — a native app launched from
    /// LariatNative/ (or an .app bundle) is not, so fall back to walking up
    /// from cwd until `scripts/beo_cascade_cli.py` appears, then to the parent
    /// of LARIAT_DATA_DIR (which points at `<root>/data`).
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
        return cwd
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
            }
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

    // MARK: Default runner (process I/O — web `runCli` parity)

    /// Spawns `$LARIAT_PYTHON || python3` on `<root>/scripts/beo_cascade_cli.py`,
    /// writes the payload to stdin, and returns stdout. Timeout kills the
    /// child (SIGKILL parity) and throws `CascadeError(timeout)`; a failed
    /// launch throws `spawn_failed`; a non-zero exit prefers the CLI's
    /// `{"error": ...}` stdout message with code `exit_N`.
    public static let processRunner: Runner = { payload, timeout in
        try await withCheckedThrowingContinuation { continuation in
            let root = resolveProjectRoot()
            let pythonBin = ProcessInfo.processInfo.environment["LARIAT_PYTHON"] ?? "python3"
            let cliPath = (root as NSString).appendingPathComponent("scripts/beo_cascade_cli.py")

            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = [pythonBin, cliPath]

            let stdinPipe = Pipe(), stdoutPipe = Pipe(), stderrPipe = Pipe()
            process.standardInput = stdinPipe
            process.standardOutput = stdoutPipe
            process.standardError = stderrPipe

            let state = TimeoutState()

            let timer = DispatchWorkItem {
                if state.markTimedOutIfRunning() { process.terminate() }
            }
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: timer)

            process.terminationHandler = { proc in
                let wasTimeout = state.finish()
                timer.cancel()

                if wasTimeout {
                    continuation.resume(throwing: CascadeError(
                        message: "cascade timed out after \(Int(timeout * 1000))ms",
                        code: "timeout"
                    ))
                    return
                }

                let stdout = String(
                    data: stdoutPipe.fileHandleForReading.readDataToEndOfFile(),
                    encoding: .utf8
                ) ?? ""
                let stderr = String(
                    data: stderrPipe.fileHandleForReading.readDataToEndOfFile(),
                    encoding: .utf8
                ) ?? ""

                if proc.terminationStatus == 0 {
                    continuation.resume(returning: stdout)
                } else {
                    // CLI writes {"error": "..."} to stdout on failure.
                    var message = stderr.isEmpty ? (stdout.isEmpty ? "exit \(proc.terminationStatus)" : stdout) : stderr
                    if let parsed = try? JSONSerialization.jsonObject(with: Data(stdout.utf8)) as? [String: Any],
                       let errorMessage = parsed["error"] as? String {
                        message = errorMessage
                    }
                    continuation.resume(throwing: CascadeError(
                        message: message,
                        code: "exit_\(proc.terminationStatus)"
                    ))
                }
            }

            do {
                try process.run()
            } catch {
                timer.cancel()
                continuation.resume(throwing: CascadeError(
                    message: "failed to spawn python: \(error.localizedDescription)",
                    code: "spawn_failed"
                ))
                return
            }

            stdinPipe.fileHandleForWriting.write(payload)
            stdinPipe.fileHandleForWriting.closeFile()
        }
    }
}

/// Lock-protected finished/timed-out pair for the process runner (the web
/// wrapper's `clearTimeout` bookkeeping, made Sendable-safe).
private final class TimeoutState: @unchecked Sendable {
    private let lock = NSLock()
    private var finished = false
    private var timedOut = false

    /// Timer fired: mark timed-out unless the process already finished.
    /// Returns true when the child should be killed.
    func markTimedOutIfRunning() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if finished { return false }
        timedOut = true
        return true
    }

    /// Termination handler: mark finished; returns whether this was a timeout.
    func finish() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        finished = true
        return timedOut
    }
}
