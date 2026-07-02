import XCTest
@testable import LariatModel

/// Value-parity with `tests/js/test-specials-saved-rules.mjs` (the web oracle
/// for `lib/specialsValidators.ts`). JS non-string/non-number input cases are
/// unrepresentable in Swift's typed API and are intentionally absent.
final class SpecialsValidatorsTests: XCTestCase {
    // MARK: validateName

    func testValidateNameAcceptsOneChar() throws {
        XCTAssertEqual(try SpecialsValidators.validateName("A"), "A")
    }

    func testValidateNameAccepts200Chars() throws {
        XCTAssertEqual(try SpecialsValidators.validateName(String(repeating: "x", count: 200)).count, 200)
    }

    func testValidateNameTrims() throws {
        XCTAssertEqual(try SpecialsValidators.validateName("  Pork Belly App  "), "Pork Belly App")
    }

    func testValidateNameRejectsEmptyAndWhitespace() {
        XCTAssertThrowsError(try SpecialsValidators.validateName("")) {
            XCTAssertEqual($0 as? SpecialsValidationError, .nameRequired)
        }
        XCTAssertThrowsError(try SpecialsValidators.validateName("   ")) {
            XCTAssertEqual($0 as? SpecialsValidationError, .nameRequired)
        }
    }

    func testValidateNameRejects201Chars() {
        XCTAssertThrowsError(try SpecialsValidators.validateName(String(repeating: "x", count: 201))) {
            XCTAssertEqual($0 as? SpecialsValidationError, .nameTooLong)
        }
    }

    // MARK: validateSlug

    func testValidateSlugAcceptsLowercaseHyphenAndDigits() throws {
        XCTAssertEqual(try SpecialsValidators.validateSlug("pork-belly-app"), "pork-belly-app")
        XCTAssertEqual(try SpecialsValidators.validateSlug("beef-100"), "beef-100")
    }

    func testValidateSlugRejectsUppercaseSpacesUnderscores() {
        for bad in ["Pork-Belly", "pork belly", "pork_belly"] {
            XCTAssertThrowsError(try SpecialsValidators.validateSlug(bad)) {
                XCTAssertEqual($0 as? SpecialsValidationError, .slugCharset)
            }
        }
    }

    func testValidateSlugLengthBounds() throws {
        XCTAssertThrowsError(try SpecialsValidators.validateSlug("")) {
            XCTAssertEqual($0 as? SpecialsValidationError, .slugLength)
        }
        XCTAssertThrowsError(try SpecialsValidators.validateSlug(String(repeating: "a", count: 81))) {
            XCTAssertEqual($0 as? SpecialsValidationError, .slugLength)
        }
        XCTAssertNoThrow(try SpecialsValidators.validateSlug(String(repeating: "a", count: 80)))
    }

    // MARK: validateYieldQty

    func testValidateYieldQty() {
        XCTAssertEqual(try? SpecialsValidators.validateYieldQty(12), 12)
        XCTAssertEqual(try? SpecialsValidators.validateYieldQty(0.001), 0.001)
        for bad in [0.0, -1.0, Double.nan, Double.infinity] {
            XCTAssertThrowsError(try SpecialsValidators.validateYieldQty(bad)) {
                XCTAssertEqual($0 as? SpecialsValidationError, .yieldQtyInvalid)
            }
        }
    }

    // MARK: validateYieldUnit

    func testValidateYieldUnit() {
        XCTAssertEqual(try? SpecialsValidators.validateYieldUnit("g"), "g")
        XCTAssertEqual(try? SpecialsValidators.validateYieldUnit("  portions  "), "portions")
        XCTAssertThrowsError(try SpecialsValidators.validateYieldUnit("")) {
            XCTAssertEqual($0 as? SpecialsValidationError, .yieldUnitRequired)
        }
        XCTAssertThrowsError(try SpecialsValidators.validateYieldUnit("   ")) {
            XCTAssertEqual($0 as? SpecialsValidationError, .yieldUnitRequired)
        }
        XCTAssertThrowsError(try SpecialsValidators.validateYieldUnit(String(repeating: "x", count: 33))) {
            XCTAssertEqual($0 as? SpecialsValidationError, .yieldUnitTooLong)
        }
    }

    // MARK: validatePatchKeys

    func testValidatePatchKeys() {
        XCTAssertEqual(SpecialsValidators.validatePatchKeys(["name"]),
                       SpecialsValidators.PatchKeyResult(ok: true, rejected: []))
        XCTAssertEqual(SpecialsValidators.validatePatchKeys(["scratch_notes"]),
                       SpecialsValidators.PatchKeyResult(ok: true, rejected: []))
        XCTAssertTrue(SpecialsValidators.validatePatchKeys(["name", "scratch_notes"]).ok)

        let rejected = SpecialsValidators.validatePatchKeys(["name", "ai_answer", "cost_total"])
        XCTAssertFalse(rejected.ok)
        XCTAssertEqual(rejected.rejected.sorted(), ["ai_answer", "cost_total"])

        let empty = SpecialsValidators.validatePatchKeys([])
        XCTAssertFalse(empty.ok)
        XCTAssertEqual(empty.rejected, [])
    }

    // MARK: clipText

    func testClipText() {
        XCTAssertEqual(SpecialsValidators.clipText("hello", max: 100), "hello")
        XCTAssertEqual(SpecialsValidators.clipText(String(repeating: "x", count: 50), max: 10),
                       String(repeating: "x", count: 10))
        XCTAssertEqual(SpecialsValidators.clipText(nil, max: 10), "")
        XCTAssertEqual(SpecialsValidators.clipText("", max: 10), "")
        XCTAssertEqual(SpecialsValidators.clipText(String(repeating: "x", count: 10), max: 10).count, 10)
    }

    func testClipTextDoesNotSplitSurrogatePairs() {
        // "😀" is two UTF-16 units; a cut at 1 must not emit a lone surrogate.
        XCTAssertEqual(SpecialsValidators.clipText("😀", max: 1), "")
        XCTAssertEqual(SpecialsValidators.clipText("a😀", max: 2), "a")
        XCTAssertEqual(SpecialsValidators.clipText("a😀", max: 3), "a😀")
    }

    // MARK: caps

    func testCapsMatchWebConstants() {
        XCTAssertEqual(SpecialsValidators.scratchNotesMax, 4000)
        XCTAssertEqual(SpecialsValidators.pantryTextMax, 4000)
        XCTAssertEqual(SpecialsValidators.promptTextMax, 2000)
        XCTAssertEqual(SpecialsValidators.categoryMax, 64)
        XCTAssertEqual(SpecialsValidators.snippetMax, 120)
    }

    // MARK: validateJsonField

    func testValidateJsonField() throws {
        XCTAssertEqual(try SpecialsValidators.validateJsonField("{\"a\":1}", field: "cost_breakdown"), "{\"a\":1}")
        XCTAssertEqual(try SpecialsValidators.validateJsonField("[{\"a\":1}]", field: "sources"), "[{\"a\":1}]")
        XCTAssertNil(try SpecialsValidators.validateJsonField(nil, field: "sources"))
        XCTAssertThrowsError(try SpecialsValidators.validateJsonField("not json", field: "cost_breakdown")) {
            XCTAssertEqual($0 as? SpecialsValidationError, .invalidJson(field: "cost_breakdown"))
        }
    }

    // MARK: snippet

    func testSnippetCollapsesWhitespaceAndCaps() {
        XCTAssertEqual(SpecialsValidators.snippet("  a\n\nb\t c  "), "a b c")
        XCTAssertEqual(SpecialsValidators.snippet(nil), "")
        let long = String(repeating: "x", count: 500)
        XCTAssertEqual(SpecialsValidators.snippet(long).count, 120)
    }
}
