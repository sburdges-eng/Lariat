import Foundation

// Port of calibration validation from `lib/calibrations.ts` (write path).

public enum CalibrationCompute {
    public static let lariatElevationFt = 7800.0
    public static let toleranceF = 2.0
    public static let seaLevelBoilF = 212.0
    public static let boilingPointFtPerF = 550.0
    public static let noteMaxLength = 500

    private static let absMinF = -100.0
    private static let absMaxF = 500.0

    public static func isCalibrationMethod(_ raw: String) -> CalibrationMethod? {
        CalibrationMethod(rawValue: raw)
    }

    public static func boilingPointF(elevationFt: Double) -> Double {
        guard elevationFt.isFinite, elevationFt > 0 else { return seaLevelBoilF }
        return seaLevelBoilF - elevationFt / boilingPointFtPerF
    }

    public static func expectedReadingF(method: CalibrationMethod, elevationFt: Double = lariatElevationFt) -> Double {
        switch method {
        case .icePoint: return 32
        case .boilingPoint: return boilingPointF(elevationFt: elevationFt)
        }
    }

    public static func validateReading(
        method: CalibrationMethod,
        readingF: Double,
        elevationFt: Double = lariatElevationFt
    ) throws -> CalibrationDecision {
        guard readingF.isFinite else {
            throw CalibrationWriteError.validationFailed("reading_f must be a finite number in °F")
        }
        if readingF < absMinF || readingF > absMaxF {
            throw CalibrationWriteError.validationFailed("reading_f \(readingF)°F is off the charts — check the probe")
        }
        let expected = expectedReadingF(method: method, elevationFt: elevationFt)
        let deviation = readingF - expected
        let absDev = abs(deviation)
        let pass = absDev <= toleranceF
        return CalibrationDecision(
            passed: pass,
            expectedF: expected,
            deviationF: deviation,
            reason: pass
                ? nil
                : String(format: "reading %.1f°F is %.1f°F off the %.1f°F target (tolerance ±%.1f°F)", readingF, absDev, expected, toleranceF)
        )
    }
}
