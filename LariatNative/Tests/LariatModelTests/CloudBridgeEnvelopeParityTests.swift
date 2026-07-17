import XCTest
@testable import LariatModel

/// Cross-stack byte-parity for the cloud-bridge /v2 envelope (C.3 step 5 of the
/// 2026-07-16 parity-harness spec). Loads the SAME shared golden fixtures the web
/// freeze test pins — tests/fixtures/cloud-bridge/golden-envelope.<table>.json —
/// rebuilds the envelope from each fixture's `input`, and asserts the canonical
/// body string AND the HMAC are byte-identical to the frozen `expected`. Pointing
/// at the shared repo fixture (not a LariatNative-local copy) is what makes this a
/// real cross-stack gate.
final class CloudBridgeEnvelopeParityTests: XCTestCase {

    struct Golden: Decodable {
        let table: String
        let testSecret: String
        let input: Input
        let expected: Expected
        enum CodingKeys: String, CodingKey {
            case table, input, expected
            case testSecret = "test_secret"
        }
        struct Input: Decodable {
            let batchId: Int64
            let locationId: String
            let rows: [JSONValue]
            enum CodingKeys: String, CodingKey {
                case rows
                case batchId = "batch_id"
                case locationId = "location_id"
            }
        }
        struct Expected: Decodable {
            let body: String
            let headers: [String: String]
        }
    }

    /// Shared repo fixture dir: <repo>/tests/fixtures/cloud-bridge, reached by
    /// walking up from this test file (LariatNative/Tests/LariatModelTests/…).
    static var fixtureDir: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()   // Tests/LariatModelTests
            .deletingLastPathComponent()   // Tests
            .deletingLastPathComponent()   // LariatNative
            .deletingLastPathComponent()   // repo root
            .appendingPathComponent("tests")
            .appendingPathComponent("fixtures")
            .appendingPathComponent("cloud-bridge")
    }

    func testEnvelopeParityAcrossAllGoldenFixtures() throws {
        let files = try FileManager.default
            .contentsOfDirectory(at: Self.fixtureDir, includingPropertiesForKeys: nil)
            .filter { $0.lastPathComponent.hasPrefix("golden-envelope.") && $0.pathExtension == "json" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        XCTAssertGreaterThanOrEqual(files.count, 1, "no golden fixtures at \(Self.fixtureDir.path)")

        for url in files {
            let fx = try JSONDecoder().decode(Golden.self, from: Data(contentsOf: url))
            // The per-table wire version is read from the frozen body (the oracle).
            let bodyObj = try JSONSerialization.jsonObject(with: Data(fx.expected.body.utf8)) as? [String: Any]
            let schemaVersion = bodyObj?["schema_version"] as? Int ?? -1

            let body = try CloudBridgeEnvelope.canonicalBody(
                schemaVersion: schemaVersion,
                table: fx.table,
                locationId: fx.input.locationId,
                batchId: fx.input.batchId,
                rows: fx.input.rows)
            XCTAssertEqual(body, fx.expected.body, "\(fx.table): canonical body must match the frozen envelope")

            let sig = CloudBridgeEnvelope.sign(
                secret: fx.testSecret, body: body, idempotencyKey: String(fx.input.batchId))
            XCTAssertEqual(sig, fx.expected.headers["x-lariat-signature"], "\(fx.table): HMAC must match")
        }
    }
}
