import Foundation
import LariatModel
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Live URLSession transport for the Ollama client (tests use stubs — this
/// type is UI-layer wiring only).
struct URLSessionOllamaTransport: OllamaTransport {
    func post(url: URL, body: Data, timeoutMs: Int) async throws -> (data: Data, statusCode: Int) {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = body
        request.timeoutInterval = TimeInterval(timeoutMs) / 1000
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            return (data, status)
        } catch let e as URLError where e.code == .timedOut {
            throw OllamaClientError.timedOut
        }
    }

    func get(url: URL, timeoutMs: Int) async throws -> (data: Data, statusCode: Int) {
        var request = URLRequest(url: url)
        request.timeoutInterval = TimeInterval(timeoutMs) / 1000
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            return (data, status)
        } catch let e as URLError where e.code == .timedOut {
            throw OllamaClientError.timedOut
        }
    }
}

#if os(macOS)
/// Live `RecipeCalculating` — shells to the SAME `scripts/bom_expand_cli.py`
/// the web's `lib/recipeCalculator.ts` spawns, so the Python BOM walker stays
/// the single source of truth for the math. Env contract parity:
/// `LARIAT_PYTHON` (default python3), `LARIAT_ROOT` (default cwd), 5s timeout,
/// error codes ('timeout', 'spawn_failed', 'cli_error', 'bad_json', …).
struct PythonBomCalculator: RecipeCalculating {
    let env: [String: String]
    let cwd: String

    init(
        env: [String: String] = ProcessInfo.processInfo.environment,
        cwd: String = FileManager.default.currentDirectoryPath
    ) {
        self.env = env
        self.cwd = cwd
    }

    private var projectRoot: String { env["LARIAT_ROOT"] ?? cwd }
    private var pythonBin: String { env["LARIAT_PYTHON"] ?? "python3" }

    func scaleRecipe(slug: String, multiplier: Double) async throws -> RecipeExpandResult {
        try await expand(payload: [
            "recipe_slug": slug,
            "root": projectRoot,
            "multiplier": multiplier,
        ], slug: slug)
    }

    func expandForBEO(
        recipes: [(slug: String, portionsPerGuest: Double)], guestCount: Double
    ) async throws -> [RecipeExpandResult] {
        guard guestCount.isFinite, guestCount > 0 else {
            throw RecipeCalculatorError("guestCount must be a positive finite number", code: "bad_guest_count")
        }
        var out: [RecipeExpandResult] = []
        for r in recipes {
            out.append(try await expand(payload: [
                "recipe_slug": r.slug,
                "root": projectRoot,
                "qty": r.portionsPerGuest * guestCount,
            ], slug: r.slug))
        }
        return out
    }

    private func expand(payload: [String: Any], slug: String) async throws -> RecipeExpandResult {
        let raw = try runCli(payload: payload)
        return try Self.parseCliResponse(raw, slug: slug)
    }

    private func runCli(payload: [String: Any], timeoutSeconds: Double = 5) throws -> String {
        let cliPath = (projectRoot as NSString)
            .appendingPathComponent("scripts/bom_expand_cli.py")
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = [pythonBin, cliPath]
        let stdin = Pipe()
        let stdout = Pipe()
        let stderr = Pipe()
        process.standardInput = stdin
        process.standardOutput = stdout
        process.standardError = stderr

        do {
            try process.run()
        } catch {
            throw RecipeCalculatorError("failed to spawn python: \(error.localizedDescription)", code: "spawn_failed")
        }
        let input = try JSONSerialization.data(withJSONObject: payload)
        stdin.fileHandleForWriting.write(input)
        stdin.fileHandleForWriting.closeFile()

        let deadline = Date().addingTimeInterval(timeoutSeconds)
        while process.isRunning && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.05)
        }
        if process.isRunning {
            process.terminate()
            throw RecipeCalculatorError("calculator timed out after \(Int(timeoutSeconds * 1000))ms", code: "timeout")
        }

        let outData = stdout.fileHandleForReading.readDataToEndOfFile()
        let errData = stderr.fileHandleForReading.readDataToEndOfFile()
        let outText = String(data: outData, encoding: .utf8) ?? ""
        if process.terminationStatus == 0 { return outText }
        // CLI writes JSON {"error": "..."} to stdout on failure.
        var message = String(data: errData, encoding: .utf8) ?? ""
        if message.isEmpty { message = outText }
        if message.isEmpty { message = "exit \(process.terminationStatus)" }
        if let parsed = try? JSONSerialization.jsonObject(with: outData) as? [String: Any],
           let err = parsed["error"] as? String {
            message = err
        }
        throw RecipeCalculatorError(message, code: "exit_\(process.terminationStatus)")
    }

    static func parseCliResponse(_ raw: String, slug: String) throws -> RecipeExpandResult {
        guard let data = raw.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data)
        else {
            throw RecipeCalculatorError("calculator returned invalid JSON for \(slug)", code: "bad_json")
        }
        guard let obj = parsed as? [String: Any] else {
            throw RecipeCalculatorError("calculator returned non-object for \(slug)", code: "bad_shape")
        }
        if let err = obj["error"] as? String {
            throw RecipeCalculatorError(err, code: "cli_error")
        }
        let leaves = (obj["leaf_rows"] as? [[String: Any]] ?? []).map { row in
            RecipeLeafRow(
                ingredient: (row["ingredient"] as? String) ?? "",
                qty: (row["qty"] as? NSNumber)?.doubleValue ?? 0,
                unit: (row["unit"] as? String) ?? ""
            )
        }
        return RecipeExpandResult(
            recipeSlug: (obj["recipe_slug"] as? String) ?? slug,
            targetQty: (obj["target_qty"] as? NSNumber)?.doubleValue ?? 0,
            targetUnit: (obj["target_unit"] as? String) ?? "",
            scaleFactor: (obj["scale_factor"] as? NSNumber)?.doubleValue ?? 0,
            leafRows: leaves
        )
    }
}
#endif
