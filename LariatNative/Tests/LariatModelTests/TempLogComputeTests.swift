import XCTest
@testable import LariatModel

final class TempLogComputeTests: XCTestCase {
    private var coldHold: TempPoint {
        TempLogCompute.getTempPoint("walk_in_cooler")!
    }

    private var poultry: TempPoint {
        TempLogCompute.getTempPoint("cook_poultry")!
    }

    func testInRangePasses() {
        let r = TempLogCompute.validateTempReading(point: coldHold, readingF: 38, correctiveAction: nil)
        XCTAssertTrue(r.ok)
    }

    func testOutOfRangeWithoutNoteFails() {
        let r = TempLogCompute.validateTempReading(point: coldHold, readingF: 44, correctiveAction: nil)
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.reason?.contains("note") == true)
    }

    func testOutOfRangeWithNotePasses() {
        let r = TempLogCompute.validateTempReading(
            point: coldHold,
            readingF: 44,
            correctiveAction: "moved to reach-in"
        )
        XCTAssertTrue(r.ok)
    }

    func testEnforceThrowsNeedsCorrectiveAction() {
        XCTAssertThrowsError(
            try TempLogCompute.enforceTempReading(point: coldHold, readingF: 44, correctiveAction: nil)
        ) { error in
            guard let gate = error as? RuleGateError else { return XCTFail("expected RuleGateError") }
            XCTAssertTrue(gate.needsCorrectiveAction)
        }
    }

    func testEmptyReadingClassifiedInvalid() {
        XCTAssertThrowsError(
            try TempLogCompute.enforceTempReading(point: coldHold, readingF: .nan, correctiveAction: nil)
        ) { error in
            guard let gate = error as? RuleGateError else { return XCTFail("expected RuleGateError") }
            XCTAssertFalse(gate.needsCorrectiveAction)
        }
    }

    func testPoultry165Boundary() {
        XCTAssertEqual(TempLogCompute.classifyReading(poultry, 165), .ok)
        XCTAssertEqual(TempLogCompute.classifyReading(poultry, 164), .outOfRange)
    }

    func testClassifyReadingsGreenAndYellow() {
        let readings = [
            TempLogReadingRow(pointId: "walk_in_cooler", readingF: 38),
            TempLogReadingRow(pointId: "walk_in_cooler", readingF: 44, correctiveAction: "moved product"),
        ]
        let summary = TempLogCompute.classifyReadings(readings, expectAllPoints: false)
        XCTAssertEqual(summary.first?.status, .yellow)
    }

    func testClassifyReadingsCriticalRed() {
        let readings = [TempLogReadingRow(pointId: "walk_in_cooler", readingF: 44, correctiveAction: nil)]
        let summary = TempLogCompute.classifyReadings(readings, expectAllPoints: false)
        XCTAssertEqual(summary.first?.status, .red)
    }

    func testCorrectiveNoteTooLong() {
        let long = String(repeating: "x", count: 501)
        XCTAssertThrowsError(
            try TempLogCompute.enforceTempReading(point: coldHold, readingF: 44, correctiveAction: long)
        ) { error in
            XCTAssertEqual(error as? RuleGateError, .correctiveNoteTooLong(length: 501))
        }
    }
}
