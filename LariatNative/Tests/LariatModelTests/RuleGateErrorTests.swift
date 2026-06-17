import XCTest
@testable import LariatModel

final class RuleGateErrorTests: XCTestCase {
    func testNeedsCorrectiveActionFlag() {
        let err = RuleGateError.needsCorrectiveAction(pointId: "walk_in_cooler", reason: "needs note")
        XCTAssertTrue(err.needsCorrectiveAction)
    }

    func testValidationFailedNotCorrective() {
        let err = RuleGateError.validationFailed("bad input")
        XCTAssertFalse(err.needsCorrectiveAction)
    }
}
