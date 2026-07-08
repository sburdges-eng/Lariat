import Foundation
import LariatModel
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Live URLSession transport for the Ollama client (tests use stubs — this
/// type is UI-layer wiring only). Every URLError maps to an
/// `OllamaClientError` so the engine's 502 branch surfaces an actionable
/// message (a refused connection must not fall through to the generic
/// "Something went wrong…" catch-all).
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
        } catch let e as URLError {
            throw Self.map(e)
        }
    }

    func get(url: URL, timeoutMs: Int) async throws -> (data: Data, statusCode: Int) {
        var request = URLRequest(url: url)
        request.timeoutInterval = TimeInterval(timeoutMs) / 1000
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            return (data, status)
        } catch let e as URLError {
            throw Self.map(e)
        }
    }

    private static func map(_ error: URLError) -> OllamaClientError {
        error.code == .timedOut
            ? .timedOut
            : .network(error.localizedDescription)
    }
}

// PythonBomCalculator — the native python3 spawn over scripts/bom_expand_cli.py
// — was REMOVED in Native 0.2 L1 Wave C. The kitchen assistant now uses the
// in-process `NativeBomCalculator` (LariatModel) via the same `RecipeCalculating`
// protocol, so no python interpreter is spawned. Its `timeout`/`spawn_failed`
// error codes are gone; expansion failures surface as `expand_failed`. The web
// edge path (`lib/recipeCalculator.ts`) still spawns python and is out of L1
// scope (decision D2 — web spawn removal is Milestone D).
