import XCTest
@testable import LariatModel

final class WriteErrorMapperTests: XCTestCase {
    func testBusyMessage() {
        struct Busy: LocalizedError { var errorDescription: String? { "SQLite error 5: database is locked" } }
        XCTAssertTrue(WriteErrorMapper.message(for: Busy()).contains("busy"))
    }

    func testRuleGateCorrectiveMessage() {
        let err = RuleGateError.needsCorrectiveAction(pointId: "walk_in_cooler", reason: "needs a note on the fix")
        XCTAssertTrue(WriteErrorMapper.message(for: err).contains("note"))
    }

    func testTempLogPinMessage() {
        XCTAssertTrue(WriteErrorMapper.message(for: TempLogWriteError.pinRequiredForPastDate).contains("PIN"))
    }
}
