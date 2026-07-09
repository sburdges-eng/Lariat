import Foundation

/// Port of `lib/ollama.ts` — the local Ollama chat client.
///
/// Env contract is identical to the web (same defaults, same clamps):
///   LARIAT_OLLAMA_URL          default http://127.0.0.1:11434
///   LARIAT_OLLAMA_MODEL        default `lari-the-kitchen-assistant`
///                              Since 2026-07 this Ollama name is the KA v2
///                              fine-tune (training/gcp/README.md); rebuilding
///                              the same name is the supported upgrade path —
///                              the GUI app reads this compiled default, not
///                              .env.local. Do not point at unevaluated
///                              variants; gate any flip with
///                              `EVAL_REQUIRE_OLLAMA=1 npm run eval:assistant-prompt`.
///   LARIAT_OLLAMA_TIMEOUT_MS   clamp [5000, 120000], default 45000
///   LARIAT_ASSISTANT_TEMPERATURE / _MAX_TOKENS / _NUM_CTX fallbacks
///
/// Request body parity: `stream:false`, `think:false` (DeepSeek-style thinking
/// channels burn num_predict before visible content — always disabled),
/// `top_p:0.85`. NO streaming — that matches the web route exactly.
///
/// I/O rides behind `OllamaTransport` so tests inject stubs and never touch a
/// live server; the URLSession transport lives in LariatApp.

public protocol OllamaTransport: Sendable {
    /// POST `body` as JSON. Returns raw response data + HTTP status.
    /// Implementations throw `OllamaClientError.timedOut` on timeout.
    func post(url: URL, body: Data, timeoutMs: Int) async throws -> (data: Data, statusCode: Int)
    /// Plain GET (reachability ping).
    func get(url: URL, timeoutMs: Int) async throws -> (data: Data, statusCode: Int)
}

public enum OllamaClientError: Error, Equatable, LocalizedError {
    /// `Ollama HTTP <status>: <first 200 chars of body>`
    case httpError(status: Int, body: String)
    /// `Ollama returned no message content`
    case noContent
    /// Transport-level timeout — the route maps this to
    /// "Inference timed out — try a shorter question or a smaller model."
    case timedOut
    /// Transport-level network failure (connection refused, host down, …) —
    /// surfaced as an actionable "is the server running?" message instead of
    /// the generic catch-all. Associated value keeps the underlying detail.
    case network(String)
    case invalidBaseUrl(String)

    public var errorDescription: String? {
        switch self {
        case .httpError(let status, let body):
            return "Ollama HTTP \(status): \(String(body.prefix(200)))"
        case .noContent:
            return "Ollama returned no message content"
        case .timedOut:
            return "Inference timed out — try a shorter question or a smaller model."
        case .network:
            return "Ollama request failed — is the model server running? (ollama serve)"
        case .invalidBaseUrl(let url):
            return "Invalid Ollama base URL: \(url)"
        }
    }
}

public struct OllamaChatMessage: Sendable, Equatable, Codable {
    public let role: String   // 'system' | 'user' | 'assistant'
    public let content: String

    public init(role: String, content: String) {
        self.role = role
        self.content = content
    }
}

public struct OllamaChatResult: Sendable, Equatable {
    public let content: String
    public let model: String

    public init(content: String, model: String) {
        self.content = content
        self.model = model
    }
}

public struct OllamaConfig: Sendable, Equatable {
    public let baseUrl: String
    public let model: String
    public let timeoutMs: Int

    public init(baseUrl: String, model: String, timeoutMs: Int) {
        self.baseUrl = baseUrl
        self.model = model
        self.timeoutMs = timeoutMs
    }
}

public struct OllamaClient: Sendable {
    public static let defaultBase = "http://127.0.0.1:11434"
    /// The web's default model — unchanged (lari-qwen fails the assistant eval).
    public static let defaultModel = "lari-the-kitchen-assistant"

    let transport: OllamaTransport
    let env: [String: String]

    public init(
        transport: OllamaTransport,
        env: [String: String] = ProcessInfo.processInfo.environment
    ) {
        self.transport = transport
        self.env = env
    }

    /// `getOllamaConfig()` parity (safe for UI, no secrets).
    public func config() -> OllamaConfig {
        OllamaConfig(baseUrl: baseUrl, model: model, timeoutMs: timeoutMs)
    }

    var baseUrl: String {
        nonEmpty(env["LARIAT_OLLAMA_URL"]) ?? Self.defaultBase
    }

    var model: String {
        nonEmpty(env["LARIAT_OLLAMA_MODEL"]) ?? Self.defaultModel
    }

    /// `DEFAULT_TIMEOUT_MS = min(120000, max(5000, parseInt(env)||45000))`
    var timeoutMs: Int {
        let parsed = jsParseInt(env["LARIAT_OLLAMA_TIMEOUT_MS"])
        let base = (parsed == nil || parsed == 0) ? 45000 : parsed!
        return min(120_000, max(5000, base))
    }

    /// `ollamaChat(opts)` parity.
    public func chat(
        messages: [OllamaChatMessage],
        temperature: Double? = nil,
        numPredict: Int? = nil,
        numCtx: Int? = nil
    ) async throws -> OllamaChatResult {
        let base = baseUrl.hasSuffix("/") ? String(baseUrl.dropLast()) : baseUrl
        guard let url = URL(string: "\(base)/api/chat") else {
            throw OllamaClientError.invalidBaseUrl(baseUrl)
        }
        // `parseFloat(env)||0.2` — 0 and NaN both fall through to the default
        // (faithful ||-semantics port).
        let temp = temperature ?? orDefault(jsParseFloat(env["LARIAT_ASSISTANT_TEMPERATURE"]), 0.2)
        let predict = numPredict ?? Int(orDefault(jsParseInt(env["LARIAT_ASSISTANT_MAX_TOKENS"]).map(Double.init), 512))
        let ctx = numCtx ?? Int(orDefault(jsParseInt(env["LARIAT_ASSISTANT_NUM_CTX"]).map(Double.init), 4096))

        let body: [String: Any] = [
            "model": model,
            "stream": false,
            "think": false,
            "messages": messages.map { ["role": $0.role, "content": $0.content] },
            "options": [
                "temperature": temp,
                "top_p": 0.85,
                "num_predict": predict,
                "num_ctx": ctx,
            ] as [String: Any],
        ]
        let data = try JSONSerialization.data(withJSONObject: body)
        let (respData, status) = try await transport.post(url: url, body: data, timeoutMs: timeoutMs)

        guard (200...299).contains(status) else {
            let errText = String(data: respData, encoding: .utf8) ?? ""
            throw OllamaClientError.httpError(status: status, body: String(errText.prefix(200)))
        }
        guard let parsed = try? JSONSerialization.jsonObject(with: respData) as? [String: Any],
              let message = parsed["message"] as? [String: Any],
              let content = message["content"] as? String
        else {
            throw OllamaClientError.noContent
        }
        return OllamaChatResult(
            content: content.trimmingCharacters(in: .whitespacesAndNewlines),
            model: model
        )
    }

    /// GET ?ping=1 parity — `{base}/api/tags` with a 3s abort; false on any error.
    public func ping() async -> Bool {
        let base = baseUrl.hasSuffix("/") ? String(baseUrl.dropLast()) : baseUrl
        guard let url = URL(string: "\(base)/api/tags") else { return false }
        do {
            let (_, status) = try await transport.get(url: url, timeoutMs: 3000)
            return (200...299).contains(status)
        } catch {
            return false
        }
    }

    // ── env parsing (JS semantics) ─────────────────────────────────────

    private func nonEmpty(_ s: String?) -> String? {
        guard let s, !s.isEmpty else { return nil }
        return s
    }

    /// `parseInt(s, 10)` — leading integer digits; nil where JS yields NaN.
    func jsParseInt(_ s: String?) -> Int? {
        guard let s else { return nil }
        let t = s.trimmingCharacters(in: .whitespaces)
        var digits = ""
        var idx = t.startIndex
        if idx < t.endIndex, t[idx] == "-" || t[idx] == "+" {
            digits.append(t[idx])
            idx = t.index(after: idx)
        }
        while idx < t.endIndex, t[idx].isNumber {
            digits.append(t[idx])
            idx = t.index(after: idx)
        }
        return Int(digits)
    }

    /// `parseFloat(s)` — leading float; nil where JS yields NaN.
    func jsParseFloat(_ s: String?) -> Double? {
        guard let s else { return nil }
        let t = s.trimmingCharacters(in: .whitespaces)
        var out = ""
        var idx = t.startIndex
        var seenDot = false
        if idx < t.endIndex, t[idx] == "-" || t[idx] == "+" {
            out.append(t[idx])
            idx = t.index(after: idx)
        }
        while idx < t.endIndex {
            let c = t[idx]
            if c.isNumber { out.append(c) }
            else if c == ".", !seenDot { out.append(c); seenDot = true }
            else { break }
            idx = t.index(after: idx)
        }
        return Double(out)
    }

    /// `x || default` for numbers: 0/NaN/nil fall through.
    private func orDefault(_ value: Double?, _ fallback: Double) -> Double {
        guard let value, value != 0, !value.isNaN else { return fallback }
        return value
    }
}
