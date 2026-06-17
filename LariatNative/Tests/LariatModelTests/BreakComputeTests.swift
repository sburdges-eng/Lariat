import XCTest
@testable import LariatModel

final class BreakComputeTests: XCTestCase {
    func testRequiredRestBreaks() {
        XCTAssertEqual(BreakCompute.requiredRestBreaks(shiftHours: 3.5), 1)
        XCTAssertEqual(BreakCompute.requiredRestBreaks(shiftHours: 8), 2)
        XCTAssertEqual(BreakCompute.requiredRestBreaks(shiftHours: 0), 0)
    }

    func testRequiresMealBreak() {
        XCTAssertFalse(BreakCompute.requiresMealBreak(shiftHours: 4.9))
        XCTAssertTrue(BreakCompute.requiresMealBreak(shiftHours: 5))
    }

    func testEvaluateShiftOwedRest() {
        let eval = BreakCompute.evaluateShift(
            shiftStartedAt: "2026-06-17T10:00:00.000Z",
            shiftEndedAt: "2026-06-17T18:00:00.000Z",
            breaks: []
        )
        XCTAssertEqual(eval.requiredRestBreaks, 2)
        XCTAssertEqual(eval.restBreaksOwed, 2)
        XCTAssertEqual(eval.requiredMealBreaks, 1)
    }
}
