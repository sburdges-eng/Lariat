import XCTest
@testable import LariatModel

/// Coverage for `CalibrationCompute` (port of lib/calibrations.ts write path).
/// The C1 verify pass found no `CalibrationComputeTests` file — the §4-502.11
/// pass/fail math (±2.0°F tolerance, ice-point 32°F, altitude-adjusted boiling
/// point) was untested. These pin the boundary + reject branches.
final class CalibrationComputeTests: XCTestCase {
    private func failureMessage(_ body: () throws -> Void) -> String? {
        do { try body(); return nil }
        catch let CalibrationWriteError.validationFailed(m) { return m }
        catch { return "\(error)" }
    }

    func testExpectedIcePointIs32() {
        XCTAssertEqual(CalibrationCompute.expectedReadingF(method: .icePoint), 32, accuracy: 1e-9)
    }

    func testBoilingPointAdjustsForLariatAltitude() {
        // 212 − 7800/550 = 197.8181…°F
        XCTAssertEqual(CalibrationCompute.boilingPointF(elevationFt: 7800), 212 - 7800 / 550, accuracy: 1e-9)
        XCTAssertEqual(
            CalibrationCompute.expectedReadingF(method: .boilingPoint, elevationFt: 7800),
            212 - 7800 / 550, accuracy: 1e-9
        )
    }

    func testBoilingPointFallsBackToSeaLevelForNonPositiveElevation() {
        XCTAssertEqual(CalibrationCompute.boilingPointF(elevationFt: 0), 212, accuracy: 1e-9)
        XCTAssertEqual(CalibrationCompute.boilingPointF(elevationFt: -100), 212, accuracy: 1e-9)
    }

    func testIcePointExactlyAtToleranceBoundaryPasses() throws {
        // |34 − 32| == 2.0 == tolerance → PASS (inclusive boundary).
        let d = try CalibrationCompute.validateReading(method: .icePoint, readingF: 34)
        XCTAssertTrue(d.passed)
        XCTAssertNil(d.reason)
        XCTAssertEqual(d.expectedF, 32, accuracy: 1e-9)
        XCTAssertEqual(d.deviationF, 2, accuracy: 1e-9)

        let low = try CalibrationCompute.validateReading(method: .icePoint, readingF: 30)
        XCTAssertTrue(low.passed)   // |30 − 32| == 2.0 → PASS
    }

    func testIcePointJustOverToleranceFails() throws {
        let d = try CalibrationCompute.validateReading(method: .icePoint, readingF: 34.1)
        XCTAssertFalse(d.passed)
        XCTAssertNotNil(d.reason)
    }

    func testExactIcePointReadingPasses() throws {
        let d = try CalibrationCompute.validateReading(method: .icePoint, readingF: 32)
        XCTAssertTrue(d.passed)
        XCTAssertEqual(d.deviationF, 0, accuracy: 1e-9)
    }

    func testBoilingPointReadingAtAltitudePasses() throws {
        let expected = CalibrationCompute.boilingPointF(elevationFt: 7800)
        let d = try CalibrationCompute.validateReading(method: .boilingPoint, readingF: expected, elevationFt: 7800)
        XCTAssertTrue(d.passed)
    }

    func testNonFiniteReadingRejected() {
        XCTAssertEqual(
            failureMessage { _ = try CalibrationCompute.validateReading(method: .icePoint, readingF: .infinity) },
            "reading_f must be a finite number in °F"
        )
        XCTAssertNotNil(failureMessage { _ = try CalibrationCompute.validateReading(method: .icePoint, readingF: .nan) })
    }

    func testOffTheChartsReadingRejected() {
        XCTAssertTrue(failureMessage { _ = try CalibrationCompute.validateReading(method: .icePoint, readingF: 600) }?.contains("off the charts") == true)
        XCTAssertTrue(failureMessage { _ = try CalibrationCompute.validateReading(method: .icePoint, readingF: -200) }?.contains("off the charts") == true)
    }
}
