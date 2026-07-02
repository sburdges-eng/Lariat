import XCTest
@testable import LariatModel

/// Byte-exact parity for `IngredientKey.normalize` against the shared web/Python
/// oracle fixture (`tests/fixtures/ingredient_key_parity.json`). The fixture is
/// loaded verbatim (never transcribed into a Swift literal) so precomposed-vs-
/// decomposed Unicode encodings reach the normalizer with their exact code units.
final class IngredientKeyComputeTests: XCTestCase {

    private struct Case: Decodable { let input: String?; let expected: String }

    private func loadFixture() throws -> [Case] {
        // <root>/LariatNative/Tests/LariatModelTests/<thisfile> → up 4 → <root>
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { url.deleteLastPathComponent() }
        url.appendPathComponent("tests/fixtures/ingredient_key_parity.json")
        let data = try Data(contentsOf: url)
        return try JSONDecoder().decode([Case].self, from: data)
    }

    func testMatchesSharedParityFixture() throws {
        let cases = try loadFixture()
        XCTAssertGreaterThanOrEqual(cases.count, 30, "fixture should carry the full parity set")
        for c in cases {
            XCTAssertEqual(
                IngredientKey.normalize(c.input), c.expected,
                "normalize(\(String(reflecting: c.input))) should equal \(String(reflecting: c.expected))"
            )
        }
    }

    // Explicit pins so a regression stays legible even if the fixture file moves.
    func testNilAndEmpty() {
        XCTAssertEqual(IngredientKey.normalize(nil), "")
        XCTAssertEqual(IngredientKey.normalize(""), "")
        XCTAssertEqual(IngredientKey.normalize("   "), "")
    }

    func testCanonicalizesCapitalizationAndPunctuation() {
        XCTAssertEqual(IngredientKey.normalize("Chicken Stock"), "chicken stock")
        XCTAssertEqual(IngredientKey.normalize("TOMATO, ROMA"), "tomato roma")
        XCTAssertEqual(IngredientKey.normalize("[REPLACED] Ribeye, 10lb case"), "ribeye 10lb case")
    }

    /// The two encodings of "ñ" MUST diverge — this is exactly why NFC/NFD
    /// normalization is forbidden. Precomposed U+00F1 collapses to a separator;
    /// decomposed n + U+0303 keeps the n; İ (U+0130) lower-cases to "i" + U+0307.
    func testPrecomposedVsDecomposedDoNotNormalize() {
        XCTAssertEqual(IngredientKey.normalize("Jalape\u{00F1}o"), "jalape o")     // precomposed ñ
        XCTAssertEqual(IngredientKey.normalize("Jalapen\u{0303}o"), "jalapen o")   // decomposed n + combining tilde
        XCTAssertEqual(IngredientKey.normalize("\u{0130}stanbul"), "i stanbul")    // İ → "i" + combining dot above
    }
}
