import XCTest
@testable import LariatModel

/// Value-parity with `tests/js/test-allergen-lookup-helpers.mjs`
/// (`app/allergen-lookup/allergenLookupHelpers.js`). URL-string builders are
/// web transport — the routing decision is pinned via `route(for:)`.
final class AllergenLookupHelpersTests: XCTestCase {
    // ── isGtinQuery — positives ─────────────────────────────────────────

    func testGtinPositives() {
        XCTAssertTrue(AllergenLookupHelpers.isGtinQuery("3017620422003"))    // EAN-13
        XCTAssertTrue(AllergenLookupHelpers.isGtinQuery("012345678905"))     // UPC-A
        XCTAssertTrue(AllergenLookupHelpers.isGtinQuery("12345678"))         // EAN-8 lower bound
        XCTAssertTrue(AllergenLookupHelpers.isGtinQuery("12345678901234"))   // ITF-14 upper bound
        XCTAssertTrue(AllergenLookupHelpers.isGtinQuery("3017 6204 22003"))  // embedded whitespace
        XCTAssertTrue(AllergenLookupHelpers.isGtinQuery("3017-6204-22003"))  // hyphens
        XCTAssertTrue(AllergenLookupHelpers.isGtinQuery("  3017620422003  "))
    }

    // ── isGtinQuery — negatives ─────────────────────────────────────────

    func testGtinNegatives() {
        XCTAssertFalse(AllergenLookupHelpers.isGtinQuery("1234567"))          // 7 digits
        XCTAssertFalse(AllergenLookupHelpers.isGtinQuery("123456789012345")) // 15 digits
        XCTAssertFalse(AllergenLookupHelpers.isGtinQuery(""))
        XCTAssertFalse(AllergenLookupHelpers.isGtinQuery("     "))
        XCTAssertFalse(AllergenLookupHelpers.isGtinQuery("30176204X2003"))
        XCTAssertFalse(AllergenLookupHelpers.isGtinQuery("nutella"))
        XCTAssertFalse(AllergenLookupHelpers.isGtinQuery("kraft mac and cheese"))
        XCTAssertFalse(AllergenLookupHelpers.isGtinQuery(nil))
    }

    func testGtinRejectsNonAsciiDigits() {
        // JS /^\d+$/ is ASCII-only; Arabic-Indic digits must not pass.
        XCTAssertFalse(AllergenLookupHelpers.isGtinQuery("١٢٣٤٥٦٧٨"))
    }

    // ── stripGtinNoise ──────────────────────────────────────────────────

    func testStripGtinNoise() {
        XCTAssertEqual(AllergenLookupHelpers.stripGtinNoise(" 12-34 5678 "), "12345678")
        XCTAssertEqual(AllergenLookupHelpers.stripGtinNoise(nil), "")
    }

    // ── cleanAllergenTag ────────────────────────────────────────────────

    func testCleanAllergenTag() {
        XCTAssertEqual(AllergenLookupHelpers.cleanAllergenTag("en:peanuts"), "peanuts")
        XCTAssertEqual(AllergenLookupHelpers.cleanAllergenTag("fr:gluten"), "gluten")
        XCTAssertEqual(AllergenLookupHelpers.cleanAllergenTag("eng:milk"), "milk")
        XCTAssertEqual(AllergenLookupHelpers.cleanAllergenTag("en:milk_and_dairy"), "milk and dairy")
        XCTAssertEqual(AllergenLookupHelpers.cleanAllergenTag("EN:Peanuts"), "peanuts")
        XCTAssertEqual(AllergenLookupHelpers.cleanAllergenTag("  en:eggs  "), "eggs")
        XCTAssertEqual(AllergenLookupHelpers.cleanAllergenTag("peanuts"), "peanuts")
        // 9 letters before the colon is not a language code.
        XCTAssertEqual(AllergenLookupHelpers.cleanAllergenTag("something:weird"), "something:weird")
        // Digits in the prefix disqualify it.
        XCTAssertEqual(AllergenLookupHelpers.cleanAllergenTag("e1:peanuts"), "e1:peanuts")
        XCTAssertEqual(AllergenLookupHelpers.cleanAllergenTag(""), "")
        XCTAssertEqual(AllergenLookupHelpers.cleanAllergenTag(nil), "")
    }

    // ── parseAllergenTags ───────────────────────────────────────────────

    func testParseAllergenTags() {
        XCTAssertEqual(
            AllergenLookupHelpers.parseAllergenTags(#"["en:peanuts","en:milk"]"#),
            ["en:peanuts", "en:milk"])
        XCTAssertEqual(AllergenLookupHelpers.parseAllergenTags(nil), [])
        XCTAssertEqual(AllergenLookupHelpers.parseAllergenTags(""), [])
        XCTAssertEqual(AllergenLookupHelpers.parseAllergenTags("not json"), [])
        XCTAssertEqual(AllergenLookupHelpers.parseAllergenTags(#"{"not":"array"}"#), [])
        XCTAssertEqual(
            AllergenLookupHelpers.parseAllergenTags(#"["en:peanuts","",null,42,"en:milk"]"#),
            ["en:peanuts", "en:milk"])
    }

    // ── route (buildLookupUrl's decision) ───────────────────────────────

    func testRouteSearchPath() {
        XCTAssertEqual(AllergenLookupHelpers.route(for: "nutella"),
                       .search(query: "nutella", limit: 20))
        XCTAssertEqual(AllergenLookupHelpers.route(for: "nutella", limit: 5),
                       .search(query: "nutella", limit: 5))
        XCTAssertEqual(AllergenLookupHelpers.route(for: "  nutella  "),
                       .search(query: "nutella", limit: 20))
        XCTAssertEqual(AllergenLookupHelpers.route(for: "mac & cheese"),
                       .search(query: "mac & cheese", limit: 20))
        XCTAssertEqual(AllergenLookupHelpers.route(for: ""), .blank)
        XCTAssertEqual(AllergenLookupHelpers.route(for: "   "), .blank)
        XCTAssertEqual(AllergenLookupHelpers.route(for: nil), .blank)
    }

    func testRouteDirectGtinPath() {
        XCTAssertEqual(AllergenLookupHelpers.route(for: "3017620422003"),
                       .offProduct(code: "3017620422003"))
        XCTAssertEqual(AllergenLookupHelpers.route(for: "12345678"),
                       .offProduct(code: "12345678"))
        XCTAssertEqual(AllergenLookupHelpers.route(for: " 3017-6204-22003 "),
                       .offProduct(code: "3017620422003"))
        // 7 and 15 digits are NOT GTINs — they search.
        XCTAssertEqual(AllergenLookupHelpers.route(for: "1234567"),
                       .search(query: "1234567", limit: 20))
        XCTAssertEqual(AllergenLookupHelpers.route(for: "123456789012345"),
                       .search(query: "123456789012345", limit: 20))
    }
}
