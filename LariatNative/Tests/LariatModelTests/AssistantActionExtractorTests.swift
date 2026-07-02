import XCTest
@testable import LariatModel

/// Value-parity port of tests/js/test-extract-action.mjs — every case.
final class AssistantActionExtractorTests: XCTestCase {

    func testReturnsNilPayloadWhenNoJSONObject() {
        let r = AssistantActionExtractor.extractAction("Just a regular answer.")
        XCTAssertNil(r.payload)
        XCTAssertEqual(r.stripped, "Just a regular answer.")
    }

    func testParsesFencedJSONAndStripsFencePlusJSON() {
        let content = "```json\n{\"action\":\"eighty_six\",\"item\":\"salmon\"}\n```\nMarked salmon as 86."
        let r = AssistantActionExtractor.extractAction(content)
        XCTAssertEqual(r.payload?.action, "eighty_six")
        XCTAssertEqual(r.payload?["item"], .string("salmon"))
        XCTAssertEqual(r.stripped, "Marked salmon as 86.")
    }

    func testParsesUnfencedJSON() {
        let content = "{\"action\":\"eighty_six\",\"item\":\"salmon\"}\nMarked salmon as 86."
        let r = AssistantActionExtractor.extractAction(content)
        XCTAssertEqual(r.payload?.action, "eighty_six")
        XCTAssertEqual(r.payload?["item"], .string("salmon"))
        XCTAssertEqual(r.stripped, "Marked salmon as 86.")
    }

    func testHandlesNestedJSONObjects() {
        let content = "{\"action\":\"beo_add_prep\",\"recipes\":[{\"recipe_slug\":\"sauce\"}]}\nQueued."
        let r = AssistantActionExtractor.extractAction(content)
        XCTAssertEqual(r.payload?.action, "beo_add_prep")
        XCTAssertEqual(
            r.payload?["recipes"],
            .array([.object(["recipe_slug": .string("sauce")])])
        )
        XCTAssertEqual(r.stripped, "Queued.")
    }

    func testMalformedJSONReturnsNilPayload() {
        let r = AssistantActionExtractor.extractAction("{not valid json}")
        XCTAssertNil(r.payload)
        // stripped still goes through stripFences on the raw content.
        XCTAssertFalse(r.stripped.isEmpty)
    }

    func testMissingActionFieldReturnsNilPayload() {
        XCTAssertNil(AssistantActionExtractor.extractAction("{\"foo\":\"bar\"}").payload)
    }

    func testNonStringActionReturnsNilPayload() {
        XCTAssertNil(AssistantActionExtractor.extractAction("{\"action\":42}").payload)
    }

    func testBraceInsideStringLiteralDoesNotTripDepth() {
        let r = AssistantActionExtractor.extractAction("{\"action\":\"x\",\"note\":\"hello { world}\"}")
        XCTAssertEqual(r.payload?.action, "x")
        XCTAssertEqual(r.payload?["note"], .string("hello { world}"))
    }

    func testEscapedQuoteInsideStringDoesNotCloseEarly() {
        // JS oracle: '{"action":"x","note":"a\\"b}"}' → note == 'a"b}'
        let content = "{\"action\":\"x\",\"note\":\"a\\\"b}\"}"
        let r = AssistantActionExtractor.extractAction(content)
        XCTAssertEqual(r.payload?.action, "x")
        XCTAssertEqual(r.payload?["note"], .string("a\"b}"))
    }

    // ── stripFences ──────────────────────────────────────────────────

    func testStripFencesRemovesJsonFences() {
        XCTAssertEqual(AssistantActionExtractor.stripFences("```json\nhello\n```"), "hello")
    }

    func testStripFencesRemovesPlainFences() {
        XCTAssertEqual(AssistantActionExtractor.stripFences("```\nhello\n```"), "hello")
    }

    func testStripFencesLeavesProseAloneModuloTrim() {
        XCTAssertEqual(AssistantActionExtractor.stripFences("  hello world  "), "hello world")
    }

    // ── UNTRUSTED-input accessors (route coercion parity) ────────────

    func testJsNumberCoercionParity() {
        // JS Number() semantics the route's guards depend on.
        XCTAssertEqual(AssistantJSONValue.number(3).jsNumber, 3)
        XCTAssertEqual(AssistantJSONValue.string("3").jsNumber, 3)
        XCTAssertTrue(AssistantJSONValue.string("5 lbs").jsNumber.isNaN)
        XCTAssertTrue(AssistantJSONValue.string("three").jsNumber.isNaN)
        XCTAssertEqual(AssistantJSONValue.null.jsNumber, 0)          // Number(null) = 0
        XCTAssertEqual(AssistantJSONValue.bool(true).jsNumber, 1)
        XCTAssertEqual(AssistantJSONValue.string("").jsNumber, 0)    // Number('') = 0
        XCTAssertTrue(AssistantJSONValue.object([:]).jsNumber.isNaN)
        // Missing key ⇒ undefined ⇒ NaN.
        let p = AssistantActionPayload(action: "x", fields: [:])
        XCTAssertTrue(p.jsNumber("delta").isNaN)
    }

    func testStrictFiniteNumberGateOnlyAdmitsRealNumbers() {
        XCTAssertEqual(AssistantJSONValue.number(38.5).strictFiniteNumber, 38.5)
        XCTAssertNil(AssistantJSONValue.string("38.5").strictFiniteNumber)
        XCTAssertNil(AssistantJSONValue.object(["foo": .number(1)]).strictFiniteNumber)
        XCTAssertNil(AssistantJSONValue.null.strictFiniteNumber)
    }

    func testClipParity() {
        XCTAssertEqual(AssistantJSONValue.string("  x  ").clip(10), "x")
        XCTAssertEqual(AssistantJSONValue.string(String(repeating: "a", count: 400)).clip(300)?.count, 300)
        XCTAssertNil(AssistantJSONValue.string("   ").clip(10))
        XCTAssertNil(AssistantJSONValue.number(5).clip(10), "clip only accepts strings — route parity")
    }
}
