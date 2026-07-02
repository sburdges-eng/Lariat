import XCTest
@testable import LariatModel

/// Value-parity port of tests/js/test-cook-message-classifier.mjs — every case.
final class AssistantMessageClassifierTests: XCTestCase {
    private func isCmd(_ s: String?) -> Bool { AssistantMessageClassifier.isImperativeCommand(s) }
    private func pin(_ s: String?) -> Bool { AssistantMessageClassifier.requiresPinBeforeLlm(s) }

    func testCommandLeading86Verb() {
        XCTAssertTrue(isCmd("86 the salmon"))
        XCTAssertTrue(isCmd("86 the test-salmon, we just ran out"))
        XCTAssertTrue(isCmd("eighty-six the salmon"))
        XCTAssertTrue(isCmd("eighty six the line"))
    }

    func testCommandOtherImperativeVerbs() {
        XCTAssertTrue(isCmd("log 5 lb of carrots received"))
        XCTAssertTrue(isCmd("mark the walk-in broken"))
        XCTAssertTrue(isCmd("give Jenny a gold star"))
        XCTAssertTrue(isCmd("add 2 lb prep to the BEO"))
        XCTAssertTrue(isCmd("record reach-in cooler at 38F"))
        XCTAssertTrue(isCmd("scale chicken stock by 2"))
        XCTAssertTrue(isCmd("receive 30 lb pork shoulder at 35F"))
    }

    func testQuestion86AsNoun() {
        XCTAssertFalse(isCmd("What is currently 86?"))
        XCTAssertFalse(isCmd("what's 86 today?"))
        XCTAssertFalse(isCmd("Is salmon 86 today?"))
        XCTAssertFalse(isCmd("Anything 86?"))
        XCTAssertFalse(isCmd("Are any items 86?"))
    }

    func testQuestionLeadingInterrogatives() {
        XCTAssertFalse(isCmd("What recipes use heavy cream?"))
        XCTAssertFalse(isCmd("How much salmon do we have?"))
        XCTAssertFalse(isCmd("Where does the queso live?"))
        XCTAssertFalse(isCmd("Why is the walk-in warm?"))
        XCTAssertFalse(isCmd("Can I substitute lime for lemon?"))
        XCTAssertFalse(isCmd("Do we have any pork shoulder left?"))
    }

    func testQuestionMarkForcesQuestionEvenWithImperativeLead() {
        XCTAssertFalse(isCmd("86 the salmon?"))
        XCTAssertFalse(isCmd("Mark walk-in broken?"))
    }

    func testAmbiguousBareStatementIsQuestion() {
        XCTAssertFalse(isCmd("The salmon is out"))
        XCTAssertFalse(isCmd("walk-in feels warm"))
        XCTAssertFalse(isCmd("Hello"))
        XCTAssertFalse(isCmd("thanks"))
    }

    func testCaseInsensitivity() {
        XCTAssertTrue(isCmd("86 THE SALMON"))
        XCTAssertTrue(isCmd("LOG 5 LB OF CARROTS"))
        XCTAssertFalse(isCmd("IS X 86?"))
    }

    func testWhitespaceAndEmptyInputs() {
        XCTAssertFalse(isCmd(""))
        XCTAssertFalse(isCmd("   "))
        XCTAssertFalse(isCmd("\n\t"))
        XCTAssertTrue(isCmd("  86 the salmon  "))
    }

    func testNonStringInputs() {
        // JS oracle passes null/undefined/numbers/objects; the typed Swift port
        // only admits String? — nil covers the non-string family.
        XCTAssertFalse(isCmd(nil))
        XCTAssertFalse(pin(nil))
    }

    func testPinRequiredClearMutations() {
        XCTAssertTrue(pin("86 the salmon"))
        XCTAssertTrue(pin("eighty-six the salmon"))
        XCTAssertTrue(pin("log 5 lb of carrots received"))
        XCTAssertTrue(pin("mark the walk-in broken"))
        XCTAssertTrue(pin("update inventory for cilantro"))
        XCTAssertTrue(pin("generate prep for grill"))
    }

    func testPinNotRequiredForReadLikeImperatives() {
        XCTAssertFalse(pin("update me on sales"))
        XCTAssertFalse(pin("generate a cooling report"))
        XCTAssertFalse(pin("show recent temp log"))
        XCTAssertFalse(pin("86 the salmon?"))
    }
}
