import XCTest
@testable import LariatModel

/// Cross-language parity for the DETERMINISTIC portion of UUIDv7 (RFC 9562 §5.7):
/// the 48-bit big-endian ms timestamp + version + variant. `lib/uuid.ts::uuidv7`
/// and `UuidV7.generate` both embed `ms` identically; this pins the native
/// generator to the shared oracle `tests/fixtures/uuidv7_timestamp.json` (the
/// web side is pinned by `tests/js/test-uuidv7-parity.mjs`) so the shared-DB PK /
/// sync_feed `op_id` format can't drift between stacks. Native had NO test
/// before this — it is also this generator's first coverage.
///
/// The random tail is intentionally not pinned — see the SecRandom follow-up:
/// native currently fills it with `UInt8.random`, a non-crypto RNG.
final class UuidV7Tests: XCTestCase {

    private struct Case: Decodable {
        let ms: UInt64
        let tsHex: String
        enum CodingKeys: String, CodingKey {
            case ms
            case tsHex = "ts_hex"
        }
    }
    private struct Fixture: Decodable { let cases: [Case] }

    private func loadCases() throws -> [Case] {
        // <root>/LariatNative/Tests/LariatModelTests/<thisfile> → up 4 → <root>
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { url.deleteLastPathComponent() }
        url.appendPathComponent("tests/fixtures/uuidv7_timestamp.json")
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url)).cases
    }

    func testDeterministicPortionMatchesSharedFixture() throws {
        let cases = try loadCases()
        XCTAssertGreaterThanOrEqual(cases.count, 5, "fixture should carry the parity cases")
        // Enforces version==7 (group 3 leads with 7) and variant in {8,9,a,b}
        // (group 4 leads with [89ab]) — the same canonical v7 shape as isUuidV7.
        let shape = try NSRegularExpression(
            pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
        for c in cases {
            let u = UuidV7.generate(nowMs: c.ms)
            let full = NSRange(u.startIndex..., in: u)
            XCTAssertNotNil(shape.firstMatch(in: u, range: full), "not a canonical v7: \(u)")
            let hex = u.replacingOccurrences(of: "-", with: "")
            XCTAssertEqual(
                String(hex.prefix(12)), c.tsHex,
                "ms prefix mismatch for ms=\(c.ms): \(u)")
        }
    }
}
