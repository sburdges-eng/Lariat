import XCTest
@testable import LariatModel

/// Contract-parity tests for the `lib/ollama.ts` port. Transport is stubbed —
/// never a live server. Oracles: lib/ollama.ts source + the fetch-stub shape
/// used by tests/js/test-kitchen-assistant-*.mjs.
final class OllamaClientTests: XCTestCase {

    final class StubTransport: OllamaTransport, @unchecked Sendable {
        var lastURL: URL?
        var lastBody: Data?
        var lastTimeoutMs: Int?
        var response: (Data, Int) = (Data(), 200)
        var error: Error?
        var getResponse: (Data, Int) = (Data(), 200)
        var getError: Error?
        private(set) var postCount = 0

        func post(url: URL, body: Data, timeoutMs: Int) async throws -> (data: Data, statusCode: Int) {
            postCount += 1
            lastURL = url
            lastBody = body
            lastTimeoutMs = timeoutMs
            if let error { throw error }
            return response
        }

        func get(url: URL, timeoutMs: Int) async throws -> (data: Data, statusCode: Int) {
            lastURL = url
            lastTimeoutMs = timeoutMs
            if let getError { throw getError }
            return getResponse
        }
    }

    private func chatResponse(_ content: String) -> Data {
        try! JSONSerialization.data(withJSONObject: ["message": ["content": content]])
    }

    // ── env / config parity ─────────────────────────────────────────

    func testConfigDefaults() {
        let client = OllamaClient(transport: StubTransport(), env: [:])
        let cfg = client.config()
        XCTAssertEqual(cfg.baseUrl, "http://127.0.0.1:11434")
        XCTAssertEqual(cfg.model, "lari-the-kitchen-assistant",
                       "default model must stay lari-the-kitchen-assistant — qwen fails the assistant eval")
        XCTAssertEqual(cfg.timeoutMs, 45000)
    }

    func testConfigEnvOverridesAndTimeoutClamp() {
        var client = OllamaClient(transport: StubTransport(), env: [
            "LARIAT_OLLAMA_URL": "http://mac-mini:11434",
            "LARIAT_OLLAMA_MODEL": "custom-model",
            "LARIAT_OLLAMA_TIMEOUT_MS": "90000",
        ])
        XCTAssertEqual(client.config(), OllamaConfig(baseUrl: "http://mac-mini:11434", model: "custom-model", timeoutMs: 90000))

        // clamp: min 5000, max 120000; NaN → 45000 (parseInt || 45000)
        client = OllamaClient(transport: StubTransport(), env: ["LARIAT_OLLAMA_TIMEOUT_MS": "1"])
        XCTAssertEqual(client.config().timeoutMs, 5000)
        client = OllamaClient(transport: StubTransport(), env: ["LARIAT_OLLAMA_TIMEOUT_MS": "999999"])
        XCTAssertEqual(client.config().timeoutMs, 120_000)
        client = OllamaClient(transport: StubTransport(), env: ["LARIAT_OLLAMA_TIMEOUT_MS": "abc"])
        XCTAssertEqual(client.config().timeoutMs, 45000)
    }

    // ── request body parity ─────────────────────────────────────────

    func testChatRequestBodyParity() async throws {
        let stub = StubTransport()
        stub.response = (chatResponse("  hi there  "), 200)
        let client = OllamaClient(transport: stub, env: [:])

        let result = try await client.chat(messages: [
            OllamaChatMessage(role: "system", content: "sys"),
            OllamaChatMessage(role: "user", content: "usr"),
        ])

        XCTAssertEqual(stub.lastURL?.absoluteString, "http://127.0.0.1:11434/api/chat")
        let body = try JSONSerialization.jsonObject(with: stub.lastBody!) as! [String: Any]
        XCTAssertEqual(body["model"] as? String, "lari-the-kitchen-assistant")
        XCTAssertEqual(body["stream"] as? Bool, false)
        XCTAssertEqual(body["think"] as? Bool, false, "thinking channel is always disabled (DeepSeek num_predict burn)")
        let opts = body["options"] as! [String: Any]
        XCTAssertEqual(opts["temperature"] as? Double, 0.2)
        XCTAssertEqual(opts["top_p"] as? Double, 0.85)
        XCTAssertEqual(opts["num_predict"] as? Int, 512)
        XCTAssertEqual(opts["num_ctx"] as? Int, 4096)
        let messages = body["messages"] as! [[String: Any]]
        XCTAssertEqual(messages.map { $0["role"] as? String }, ["system", "user"])

        XCTAssertEqual(result.content, "hi there", "content is trimmed")
        XCTAssertEqual(result.model, "lari-the-kitchen-assistant")
    }

    func testChatExplicitOptsOverrideEnv() async throws {
        let stub = StubTransport()
        stub.response = (chatResponse("x"), 200)
        let client = OllamaClient(transport: stub, env: [
            "LARIAT_ASSISTANT_TEMPERATURE": "0.7",
            "LARIAT_ASSISTANT_MAX_TOKENS": "256",
        ])
        _ = try await client.chat(messages: [], temperature: 0, numPredict: 120, numCtx: 2048)
        let body = try JSONSerialization.jsonObject(with: stub.lastBody!) as! [String: Any]
        let opts = body["options"] as! [String: Any]
        // Explicit 0 wins over env (typeof check on web, not ||).
        XCTAssertEqual(opts["temperature"] as? Double, 0)
        XCTAssertEqual(opts["num_predict"] as? Int, 120)
        XCTAssertEqual(opts["num_ctx"] as? Int, 2048)
    }

    func testTrailingSlashOnBaseUrlIsStripped() async throws {
        let stub = StubTransport()
        stub.response = (chatResponse("x"), 200)
        let client = OllamaClient(transport: stub, env: ["LARIAT_OLLAMA_URL": "http://127.0.0.1:11434/"])
        _ = try await client.chat(messages: [])
        XCTAssertEqual(stub.lastURL?.absoluteString, "http://127.0.0.1:11434/api/chat")
    }

    // ── error mapping parity ────────────────────────────────────────

    func testHttpErrorMapping() async {
        let stub = StubTransport()
        stub.response = (Data(String(repeating: "e", count: 500).utf8), 500)
        let client = OllamaClient(transport: stub, env: [:])
        do {
            _ = try await client.chat(messages: [])
            XCTFail("expected httpError")
        } catch let e as OllamaClientError {
            guard case .httpError(let status, let body) = e else { return XCTFail("wrong error \(e)") }
            XCTAssertEqual(status, 500)
            XCTAssertEqual(body.count, 200, "body clipped to 200 chars — route parity")
        } catch {
            XCTFail("wrong error type \(error)")
        }
    }

    func testMissingContentThrowsNoContent() async {
        let stub = StubTransport()
        stub.response = (try! JSONSerialization.data(withJSONObject: ["message": [String: String]()]), 200)
        let client = OllamaClient(transport: stub, env: [:])
        do {
            _ = try await client.chat(messages: [])
            XCTFail("expected noContent")
        } catch let e as OllamaClientError {
            XCTAssertEqual(e, .noContent)
        } catch {
            XCTFail("wrong error type \(error)")
        }
    }

    func testTimeoutSurfacesFriendlyMessage() {
        XCTAssertEqual(
            OllamaClientError.timedOut.errorDescription,
            "Inference timed out — try a shorter question or a smaller model."
        )
    }

    // ── ping parity ─────────────────────────────────────────────────

    func testPingReachable() async {
        let stub = StubTransport()
        stub.getResponse = (Data("{}".utf8), 200)
        let client = OllamaClient(transport: stub, env: [:])
        let ok = await client.ping()
        XCTAssertTrue(ok)
        XCTAssertEqual(stub.lastURL?.absoluteString, "http://127.0.0.1:11434/api/tags")
        XCTAssertEqual(stub.lastTimeoutMs, 3000, "3s abort — GET ?ping=1 parity")
    }

    func testPingUnreachableIsFalseNotThrow() async {
        let stub = StubTransport()
        stub.getError = URLError(.cannotConnectToHost)
        let client = OllamaClient(transport: stub, env: [:])
        let ok = await client.ping()
        XCTAssertFalse(ok)
    }
}
