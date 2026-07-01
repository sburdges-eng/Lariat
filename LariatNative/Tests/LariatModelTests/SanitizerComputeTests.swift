import XCTest
@testable import LariatModel

// Value-parity port of tests/js/test-sanitizer-rules.mjs — sanitizer concentration
// band validation (F4 / FDA §4-703.11). Known input/output values lifted from the
// web test so the Swift classifier cannot drift from the JS rule module.

final class SanitizerComputeTests: XCTestCase {

    // ── bandFor ─────────────────────────────────────────────────────────

    func testChlorineHotBandIs50To100() {
        let b = SanitizerCompute.bandFor(.chlorine, waterTempF: 75)
        XCTAssertEqual(b, SanitizerBand(minPpm: 50, maxPpm: 100, label: "chlorine @≥75°F"))
    }

    func testChlorineExactly75UsesHotBand() {
        XCTAssertEqual(SanitizerCompute.bandFor(.chlorine, waterTempF: 75)?.minPpm, 50)
    }

    func testChlorineColdBandIs75To100() {
        let b = SanitizerCompute.bandFor(.chlorine, waterTempF: 70)
        XCTAssertEqual(b, SanitizerBand(minPpm: 75, maxPpm: 100, label: "chlorine @<75°F"))
    }

    func testChlorineNullTempDefaultsToColdStricterBand() {
        XCTAssertEqual(SanitizerCompute.bandFor(.chlorine, waterTempF: nil)?.minPpm, 75)
    }

    func testChlorine74point9UsesColdBand() {
        XCTAssertEqual(SanitizerCompute.bandFor(.chlorine, waterTempF: 74.9)?.minPpm, 75)
    }

    func testQuatIs150To400RegardlessOfTemp() {
        let hot = SanitizerCompute.bandFor(.quat, waterTempF: 120)
        let cold = SanitizerCompute.bandFor(.quat, waterTempF: 40)
        let nullt = SanitizerCompute.bandFor(.quat, waterTempF: nil)
        XCTAssertEqual(hot, SanitizerBand(minPpm: 150, maxPpm: 400, label: "quaternary ammonia"))
        XCTAssertEqual(cold, hot)
        XCTAssertEqual(nullt, hot)
    }

    func testIodineIs12point5To25() {
        let b = SanitizerCompute.bandFor(.iodine, waterTempF: nil)
        XCTAssertEqual(b, SanitizerBand(minPpm: 12.5, maxPpm: 25, label: "iodine"))
    }

    func testOtherReturnsNil() {
        XCTAssertNil(SanitizerCompute.bandFor(.other, waterTempF: 100))
    }

    func testChemistriesSetIsExactlyTheFourWeSupport() {
        XCTAssertEqual(
            SanitizerCompute.chemistries.map(\.rawValue).sorted(),
            ["chlorine", "iodine", "other", "quat"]
        )
    }

    // ── validateSanitizerCheck ──────────────────────────────────────────

    private func validate(
        chemistry: String? = "chlorine",
        concentration: Double? = 80,
        waterTemp: Double? = 75,
        pointLabel: String? = "Dish pit final rinse"
    ) -> ValidateSanitizerResult {
        SanitizerCompute.validateSanitizerCheck(
            chemistryRaw: chemistry,
            concentrationPpm: concentration,
            waterTempF: waterTemp,
            pointLabel: pointLabel
        )
    }

    func testValidateAcceptsCleanInput() {
        XCTAssertEqual(validate(), .success)
    }

    func testValidateAcceptsNullWaterTemp() {
        XCTAssertEqual(validate(waterTemp: nil), .success)
    }

    func testValidateRejectsUnknownChemistry() {
        let r = validate(chemistry: "bleach")
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.reason?.range(of: "chemistry", options: .caseInsensitive) != nil)
    }

    func testValidateRejectsMissingConcentration() {
        let r = validate(concentration: nil)
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.reason?.range(of: "concentration", options: .caseInsensitive) != nil)
    }

    func testValidateRejectsNaNConcentration() {
        XCTAssertFalse(validate(concentration: .nan).ok)
    }

    func testValidateRejectsNegativeConcentration() {
        let r = validate(concentration: -5)
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.reason?.range(of: "charts", options: .caseInsensitive) != nil
                      || r.reason?.range(of: "strip", options: .caseInsensitive) != nil)
    }

    func testValidateRejectsConcentrationAbovePlausibleMax() {
        let r = validate(concentration: 1500)
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.reason?.range(of: "charts", options: .caseInsensitive) != nil
                      || r.reason?.range(of: "strip", options: .caseInsensitive) != nil)
    }

    func testValidateAcceptsConcentrationAtZero() {
        XCTAssertEqual(validate(concentration: 0), .success)
    }

    func testValidateAcceptsConcentrationAtExactly1000() {
        XCTAssertEqual(validate(concentration: 1000), .success)
    }

    func testValidateRejectsMissingPointLabel() {
        let r = validate(pointLabel: "")
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.reason?.range(of: "point_label", options: .caseInsensitive) != nil)
    }

    func testValidateRejectsWhitespaceOnlyPointLabel() {
        XCTAssertFalse(validate(pointLabel: "   ").ok)
    }

    func testValidateRejectsNonFiniteWaterTemp() {
        XCTAssertFalse(validate(waterTemp: .infinity).ok)
    }

    func testValidateRejectsWaterTempOutOfPlausibleRange() {
        let r = validate(waterTemp: 300)
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.reason?.range(of: "water_temp", options: .caseInsensitive) != nil)
    }

    // ── classifySanitizer ───────────────────────────────────────────────

    func testChlorine80ppm75FIsOk() {
        let r = SanitizerCompute.classifySanitizer(.chlorine, concentrationPpm: 80, waterTempF: 75)
        XCTAssertEqual(r.status, .ok)
        XCTAssertNil(r.breachReason)
        XCTAssertEqual(r.requiredMinPpm, 50)
    }

    func testChlorine40ppm80FIsLow() {
        let r = SanitizerCompute.classifySanitizer(.chlorine, concentrationPpm: 40, waterTempF: 80)
        XCTAssertEqual(r.status, .low)
        XCTAssertNotNil(r.breachReason)
        XCTAssertTrue(r.breachReason?.contains("40") == true)
    }

    func testChlorine200ppm80FIsHigh() {
        let r = SanitizerCompute.classifySanitizer(.chlorine, concentrationPpm: 200, waterTempF: 80)
        XCTAssertEqual(r.status, .high)
        XCTAssertNotNil(r.breachReason)
    }

    func testChlorine60ppm70FColdBandRequires75IsLow() {
        let r = SanitizerCompute.classifySanitizer(.chlorine, concentrationPpm: 60, waterTempF: 70)
        XCTAssertEqual(r.status, .low)
    }

    func testChlorine60ppm80FHotBandAllows50IsOk() {
        let r = SanitizerCompute.classifySanitizer(.chlorine, concentrationPpm: 60, waterTempF: 80)
        XCTAssertEqual(r.status, .ok)
    }

    func testQuat200ppmIsOk() {
        XCTAssertEqual(SanitizerCompute.classifySanitizer(.quat, concentrationPpm: 200, waterTempF: nil).status, .ok)
    }

    func testQuat100ppmIsLow() {
        XCTAssertEqual(SanitizerCompute.classifySanitizer(.quat, concentrationPpm: 100, waterTempF: nil).status, .low)
    }

    func testQuat500ppmIsHigh() {
        XCTAssertEqual(SanitizerCompute.classifySanitizer(.quat, concentrationPpm: 500, waterTempF: nil).status, .high)
    }

    func testIodine15ppmIsOk() {
        XCTAssertEqual(SanitizerCompute.classifySanitizer(.iodine, concentrationPpm: 15, waterTempF: nil).status, .ok)
    }

    func testIodine10ppmIsLow() {
        XCTAssertEqual(SanitizerCompute.classifySanitizer(.iodine, concentrationPpm: 10, waterTempF: nil).status, .low)
    }

    func testIodine30ppmIsHigh() {
        XCTAssertEqual(SanitizerCompute.classifySanitizer(.iodine, concentrationPpm: 30, waterTempF: nil).status, .high)
    }

    func testOtherIsOkRegardlessOfConcentration() {
        let r = SanitizerCompute.classifySanitizer(.other, concentrationPpm: 0.1, waterTempF: nil)
        XCTAssertEqual(r.status, .ok)
        XCTAssertNil(r.band)
        XCTAssertNil(r.requiredMinPpm)
        XCTAssertNil(r.requiredMaxPpm)
    }

    func testEdgeChlorine50ppmHotBandIsOkInclusive() {
        XCTAssertEqual(SanitizerCompute.classifySanitizer(.chlorine, concentrationPpm: 50, waterTempF: 80).status, .ok)
    }

    func testEdgeChlorine100ppmIsOkInclusive() {
        XCTAssertEqual(SanitizerCompute.classifySanitizer(.chlorine, concentrationPpm: 100, waterTempF: 80).status, .ok)
    }

    func testEdgeChlorine49ppmHotBandIsLow() {
        XCTAssertEqual(SanitizerCompute.classifySanitizer(.chlorine, concentrationPpm: 49, waterTempF: 80).status, .low)
    }

    // ── DEFAULT_POINTS sanity ────────────────────────────────────────────

    func testEveryDefaultPointHasSupportedChemistry() {
        for p in SanitizerCompute.defaultPoints {
            XCTAssertTrue(SanitizerCompute.chemistries.contains(p.chemistry), "unsupported chemistry on \(p.id)")
        }
    }

    func testDefaultPointIdsAreUniqueAndSnakeCase() {
        let ids = SanitizerCompute.defaultPoints.map(\.id)
        XCTAssertEqual(Set(ids).count, ids.count)
        for id in ids {
            XCTAssertNotNil(id.range(of: "^[a-z][a-z0-9_]*$", options: .regularExpression), "bad id: \(id)")
        }
    }

    func testAtLeastOneDishPitPointExists() {
        XCTAssertTrue(SanitizerCompute.defaultPoints.contains { $0.id.contains("dish") })
    }

    func testAtLeastOneWipingBucketPointExists() {
        XCTAssertTrue(SanitizerCompute.defaultPoints.contains { $0.id.contains("wiping") })
    }

    // ── breach_reason string parity (integers print without .0) ──────────

    func testBreachReasonFormatsIntegersCleanly() {
        let r = SanitizerCompute.classifySanitizer(.quat, concentrationPpm: 100, waterTempF: nil)
        // Web: "quaternary ammonia read 100 ppm (min 150)"
        XCTAssertEqual(r.breachReason, "quaternary ammonia read 100 ppm (min 150)")
    }

    func testBreachReasonKeepsFractionalIodineBand() {
        let r = SanitizerCompute.classifySanitizer(.iodine, concentrationPpm: 10, waterTempF: nil)
        // Web: "iodine read 10 ppm (min 12.5)"
        XCTAssertEqual(r.breachReason, "iodine read 10 ppm (min 12.5)")
    }
}
