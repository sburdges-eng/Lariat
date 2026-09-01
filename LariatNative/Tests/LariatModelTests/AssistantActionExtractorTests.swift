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

    // ── KA v3 parity: strip EVERY JSON object; never leak a 2nd block ──

    func testStripsDoubleEmittedActionBlock() {
        let content = "```json\n{\"action\":\"scale_recipe\",\"recipe\":\"bacon_jam\",\"multiplier\":3}\n```\n"
            + "Scaled bacon jam x3.\n"
            + "```json\n{\"action\":\"scale_recipe\",\"recipe\":\"bacon_jam\",\"multiplier\":3}\n```"
        let r = AssistantActionExtractor.extractAction(content)
        XCTAssertEqual(r.payload?.action, "scale_recipe")
        XCTAssertFalse(r.stripped.contains("```"))
        XCTAssertFalse(r.stripped.contains("\"action\""))
        XCTAssertEqual(r.stripped, "Scaled bacon jam x3.")
    }

    func testStripsTrailingUnfencedSecondObject() {
        let content = "{\"action\":\"eighty_six\",\"item\":\"salmon\"}\nMarked 86.\n{\"action\":\"eighty_six\",\"item\":\"salmon\"}"
        let r = AssistantActionExtractor.extractAction(content)
        XCTAssertEqual(r.payload?.action, "eighty_six")
        XCTAssertFalse(r.stripped.contains("\"action\""))
        XCTAssertEqual(r.stripped, "Marked 86.")
    }

    func testKeepsFirstActionObjectWhenNonActionPrecedes() {
        let content = "{\"note\":\"preamble\"}\n{\"action\":\"eighty_six\",\"item\":\"salmon\"}\nMarked 86."
        let r = AssistantActionExtractor.extractAction(content)
        XCTAssertEqual(r.payload?.action, "eighty_six")
        XCTAssertFalse(r.stripped.contains("{"))
        XCTAssertEqual(r.stripped, "Marked 86.")
    }

    func testPreservesProseBracesThatAreNotJSON() {
        let content = "{\"action\":\"eighty_six\",\"item\":\"salmon\"}\nUse a 1/2 pan (not a full)."
        let r = AssistantActionExtractor.extractAction(content)
        XCTAssertEqual(r.stripped, "Use a 1/2 pan (not a full).")
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

    func testIsDegenerateAnswerFlagsXmlMimicry() {
        let garbled = [
            "<pico>", "  <ingredients>",
            "    <ingredient name=\"green chile\" />",
            "    <ingredient name=\"thyme\" />",
            "    <ingredient name=\"pork rind\" />",
            "  </ingredients>", "</pico>",
        ].joined(separator: "\n")
        XCTAssertTrue(AssistantActionExtractor.isDegenerateAnswer(garbled))
    }

    func testIsDegenerateAnswerFlagsRepetitionLoop() {
        let loop = Array(repeating: "- diced shallot and garlic clove", count: 6).joined(separator: "\n")
        XCTAssertTrue(AssistantActionExtractor.isDegenerateAnswer(loop))
    }

    func testIsDegenerateAnswerPassesHonestAnswers() {
        XCTAssertFalse(AssistantActionExtractor.isDegenerateAnswer("Walk-in is at 38F — inside the safe range."))
        XCTAssertFalse(AssistantActionExtractor.isDegenerateAnswer(
            "Green Chilli — makes 8 qt · expo\n• pork butt — 10 lb\n• water — 5 cup\nTags: wheat"))
        XCTAssertFalse(AssistantActionExtractor.isDegenerateAnswer(""))
    }

    // MARK: - Truthful answers the guard must not eat
    //
    // Mirrors tests/js/test-extract-action.mjs. The first cut counted a
    // repeated line anywhere, which destroyed 7 of 13 realistic answers.

    func testKeepsLineCheckWhereStationsShareAStatusLine() {
        let lineCheck = """
        Line check, 4:30 pm:
        Grill
        Not logged yet.
        Saute
        Not logged yet.
        Fry
        Not logged yet.
        Expo
        Not logged yet.
        """
        XCTAssertFalse(AssistantActionExtractor.isDegenerateAnswer(lineCheck))
    }

    func testKeepsListingOfUntaggedRecipes() {
        let cards = [
            ["Pico de Gallo — makes 4 qt · garde", "• roma tomato — 10 cup", "• red onion — 2 cup"],
            ["Mexi Slaw — makes 2 qt · garde", "• green cabbage — 8 cup", "• lime juice — 1 cup"],
            ["Birria Consomme — makes 6 qt · line", "• beef chuck — 12 lb", "• guajillo chile — 3 cup"],
            ["Aji Verde — makes 1 qt · garde", "• cilantro — 4 cup", "• jalapeno — 6 ea"],
        ]
        .map { $0.joined(separator: "\n") + "\nTags: none listed — check with a manager." }
        .joined(separator: "\n\n")
        XCTAssertFalse(AssistantActionExtractor.isDegenerateAnswer(cards))
    }

    func testKeepsParListingRepeatingOneItemAcrossStations() {
        let pars = [
            "Par levels for tonight:",
            "Grill station", "• pico de gallo — 2 qt",
            "Saute station", "• pico de gallo — 2 qt",
            "Fry station", "• pico de gallo — 2 qt",
            "Expo station", "• pico de gallo — 2 qt",
        ].joined(separator: "\n")
        XCTAssertFalse(AssistantActionExtractor.isDegenerateAnswer(pars))
    }

    func testDoesNotMistakeVendorEmailsOrUrlsForMarkup() {
        let contacts = [
            "Vendor contacts:",
            "Shamrock <orders@shamrockfoods.com>",
            "Sysco <meat@sysco.com>",
            "US Foods <dry@usfoods.com>",
            "Borden <dairy@borden.com>",
            "Bunzl <paper@bunzl.com>",
        ].joined(separator: "\n")
        XCTAssertFalse(AssistantActionExtractor.isDegenerateAnswer(contacts))

        let urls = (0...4).map { "Rule \($0): see <https://fda.gov/haccp/rule\($0)>" }.joined(separator: "\n")
        XCTAssertFalse(AssistantActionExtractor.isDegenerateAnswer(urls))
    }

    func testKeepsMarkdownTableWithRepeatingRows() {
        let table = [
            "| date | variance |", "| --- | --- |",
            "| 2026-06-16 | 0 |", "| 2026-06-16 | 0 |",
            "| 2026-06-16 | 0 |", "| 2026-06-16 | 0 |",
        ].joined(separator: "\n")
        XCTAssertFalse(AssistantActionExtractor.isDegenerateAnswer(table))
    }

    // MARK: - Loops the guard must still catch

    func testCatchesLoopAppendedToOtherwiseGoodAnswer() {
        let tail = ((1...20).map { "Prep step \($0): dice and hold cold." }
            + Array(repeating: "- diced shallot and garlic clove", count: 5))
            .joined(separator: "\n")
        XCTAssertTrue(AssistantActionExtractor.isDegenerateAnswer(tail))
    }

    func testCatchesLoopInterleavedWithFiller() {
        let interleaved = [
            "Aji verde uses cilantro.", "filler line one here",
            "Aji verde uses cilantro.", "filler line two here",
            "Aji verde uses cilantro.", "filler line three ok",
            "Aji verde uses cilantro.", "filler line four ok",
        ].joined(separator: "\n")
        XCTAssertTrue(AssistantActionExtractor.isDegenerateAnswer(interleaved))
    }

    /// Regression: `split(separator: "\n")` does not split CRLF, because
    /// "\r\n" is one grapheme cluster. A CRLF answer collapsed to a single
    /// line here and the repeat signal could never fire, while the web twin's
    /// did — a fail-open divergence on the iPad target.
    func testScoresCrlfAnswerTheSameAsLf() {
        let body = Array(repeating: "- diced shallot and garlic clove", count: 6)
        XCTAssertTrue(AssistantActionExtractor.isDegenerateAnswer(body.joined(separator: "\r\n")))
        XCTAssertTrue(AssistantActionExtractor.isDegenerateAnswer(body.joined(separator: "\n")))
    }
}
