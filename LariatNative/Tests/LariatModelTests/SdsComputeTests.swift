import XCTest
@testable import LariatModel

// Value-parity port of tests/js/test-sds-rules.mjs — SDS-registry validator
// (OSHA HCS, 29 CFR 1910.1200). Known input/output values lifted from the web
// test so the Swift validator cannot drift from the JS rule module (lib/sds.ts).

final class SdsComputeTests: XCTestCase {

    // ── Citations and constants ───────────────────────────────────────

    func testCitationPointsToHazCom() {
        XCTAssertTrue(SdsCompute.citation.contains("1910.1200"))
    }

    func testRetentionCitationNamesOnSiteRequirement() {
        XCTAssertTrue(SdsCompute.retentionCitation.contains("1910.1200(g)"))
    }

    func testGhsHazardClassesExposesInspectorFacingSet() {
        XCTAssertTrue(SdsCompute.ghsHazardClasses.contains("flammable"))
        XCTAssertTrue(SdsCompute.ghsHazardClasses.contains("corrosive"))
        XCTAssertTrue(SdsCompute.ghsHazardClasses.contains("toxic"))
        XCTAssertTrue(SdsCompute.ghsHazardClasses.contains("oxidizer"))
        XCTAssertTrue(SdsCompute.ghsHazardClasses.contains("irritant"))
        XCTAssertGreaterThanOrEqual(SdsCompute.ghsHazardClasses.count, 6)
    }

    func testFieldLengthBoundsArePositive() {
        for n in [
            SdsCompute.productNameMaxLen,
            SdsCompute.manufacturerMaxLen,
            SdsCompute.hazardClassMaxLen,
            SdsCompute.storageLocationMaxLen,
            SdsCompute.pdfPathMaxLen,
            SdsCompute.urlMaxLen,
        ] {
            XCTAssertGreaterThan(n, 0)
        }
    }

    // ── product_name (required) ───────────────────────────────────────

    func testRejectsMissingProductName() {
        let r = SdsCompute.validate(productName: nil, manufacturer: "Ecolab")
        XCTAssertFalse(r.isOk)
        XCTAssertTrue(r.reason!.contains("product_name"))
    }

    func testRejectsEmptyProductName() {
        XCTAssertFalse(SdsCompute.validate(productName: "").isOk)
    }

    func testRejectsWhitespaceOnlyProductName() {
        XCTAssertFalse(SdsCompute.validate(productName: "   ").isOk)
    }

    func testAcceptsNonEmptyProductName() {
        XCTAssertTrue(SdsCompute.validate(productName: "Quat 256").isOk)
    }

    func testRejectsProductNameOverMax() {
        let r = SdsCompute.validate(productName: String(repeating: "x", count: SdsCompute.productNameMaxLen + 1))
        XCTAssertFalse(r.isOk)
        XCTAssertTrue(r.reason!.range(of: "product_name|length", options: .regularExpression) != nil)
    }

    func testAcceptsProductNameAtMaxInclusive() {
        let r = SdsCompute.validate(productName: String(repeating: "x", count: SdsCompute.productNameMaxLen))
        XCTAssertTrue(r.isOk)
    }

    // ── optional string fields ────────────────────────────────────────

    func testRejectsManufacturerOverMax() {
        let r = SdsCompute.validate(productName: "Quat 256",
                                    manufacturer: String(repeating: "m", count: SdsCompute.manufacturerMaxLen + 1))
        XCTAssertFalse(r.isOk)
    }

    func testAcceptsManufacturerAtMaxInclusive() {
        let r = SdsCompute.validate(productName: "Quat 256",
                                    manufacturer: String(repeating: "m", count: SdsCompute.manufacturerMaxLen))
        XCTAssertTrue(r.isOk)
    }

    func testRejectsStorageLocationOverMax() {
        let r = SdsCompute.validate(productName: "Quat 256",
                                    storageLocation: String(repeating: "x", count: SdsCompute.storageLocationMaxLen + 1))
        XCTAssertFalse(r.isOk)
    }

    // ── hazard_class (GHS enum) ───────────────────────────────────────

    func testAcceptsKnownGhsClassFlammable() {
        XCTAssertTrue(SdsCompute.validate(productName: "Quat 256", hazardClass: "flammable").isOk)
    }

    func testAcceptsKnownGhsClassCorrosive() {
        XCTAssertTrue(SdsCompute.validate(productName: "Quat 256", hazardClass: "corrosive").isOk)
    }

    func testAcceptsHazardClassCaseInsensitively() {
        XCTAssertTrue(SdsCompute.validate(productName: "Quat 256", hazardClass: "FLAMMABLE").isOk)
    }

    func testRejectsUnknownHazardClass() {
        let r = SdsCompute.validate(productName: "Quat 256", hazardClass: "spicy")
        XCTAssertFalse(r.isOk)
        XCTAssertTrue(r.reason!.contains("hazard_class"))
    }

    func testAcceptsMissingHazardClass() {
        XCTAssertTrue(SdsCompute.validate(productName: "Quat 256").isOk)
    }

    // ── pdf_path / url ────────────────────────────────────────────────

    func testRejectsPdfPathOverMax() {
        let r = SdsCompute.validate(productName: "Quat 256",
                                    pdfPath: String(repeating: "p", count: SdsCompute.pdfPathMaxLen + 1))
        XCTAssertFalse(r.isOk)
    }

    func testAcceptsRelativePdfPath() {
        XCTAssertTrue(SdsCompute.validate(productName: "Quat 256", pdfPath: "sds/quat-256.pdf").isOk)
    }

    func testAcceptsHttpsUrl() {
        XCTAssertTrue(SdsCompute.validate(productName: "Quat 256", url: "https://example.com/sds.pdf").isOk)
    }

    func testRejectsNonHttpUrl() {
        let r = SdsCompute.validate(productName: "Quat 256", url: "ftp://example.com/sds.pdf")
        XCTAssertFalse(r.isOk)
        XCTAssertTrue(r.reason!.contains("url"))
    }

    func testRejectsFileUrl() {
        XCTAssertFalse(SdsCompute.validate(productName: "Quat 256", url: "file:///tmp/sheet.pdf").isOk)
    }

    func testRejectsUrlOverMax() {
        let r = SdsCompute.validate(productName: "Quat 256",
                                    url: "https://example.com/" + String(repeating: "x", count: SdsCompute.urlMaxLen))
        XCTAssertFalse(r.isOk)
    }

    // ── last_reviewed (ISO date) ──────────────────────────────────────

    func testAcceptsIsoDate() {
        XCTAssertTrue(SdsCompute.validate(productName: "Quat 256", lastReviewed: "2026-04-29").isOk)
    }

    func testRejectsMmDdYyyy() {
        let r = SdsCompute.validate(productName: "Quat 256", lastReviewed: "04/29/2026")
        XCTAssertFalse(r.isOk)
        XCTAssertTrue(r.reason!.contains("last_reviewed"))
    }

    func testRejectsUnparseableDate() {
        XCTAssertFalse(SdsCompute.validate(productName: "Quat 256", lastReviewed: "tuesday").isOk)
    }

    func testAcceptsMissingLastReviewed() {
        XCTAssertTrue(SdsCompute.validate(productName: "Quat 256").isOk)
    }

    // ── last_reviewed phantom dates ───────────────────────────────────

    func testRejectsFeb30() {
        let r = SdsCompute.validate(productName: "Quat 256", lastReviewed: "2026-02-30")
        XCTAssertFalse(r.isOk)
        XCTAssertTrue(r.reason!.range(of: "not a real calendar date", options: .caseInsensitive) != nil)
    }

    func testRejectsMonth13() {
        let r = SdsCompute.validate(productName: "Quat 256", lastReviewed: "2025-13-01")
        XCTAssertFalse(r.isOk)
        XCTAssertTrue(r.reason!.contains("last_reviewed"))
    }

    func testRejectsApril31() {
        let r = SdsCompute.validate(productName: "Quat 256", lastReviewed: "2026-04-31")
        XCTAssertFalse(r.isOk)
        XCTAssertTrue(r.reason!.range(of: "not a real calendar date", options: .caseInsensitive) != nil)
    }

    func testRejectsJune31() {
        let r = SdsCompute.validate(productName: "Quat 256", lastReviewed: "2026-06-31")
        XCTAssertFalse(r.isOk)
        XCTAssertTrue(r.reason!.range(of: "not a real calendar date", options: .caseInsensitive) != nil)
    }

    func testAcceptsFeb28() {
        XCTAssertTrue(SdsCompute.validate(productName: "Quat 256", lastReviewed: "2026-02-28").isOk)
    }

    func testAcceptsLeapDay() {
        XCTAssertTrue(SdsCompute.validate(productName: "Quat 256", lastReviewed: "2024-02-29").isOk)
    }

    func testAcceptsYearBoundary() {
        XCTAssertTrue(SdsCompute.validate(productName: "Quat 256", lastReviewed: "2026-12-31").isOk)
    }

    // ── active flag ───────────────────────────────────────────────────

    func testAcceptsActiveTrue() {
        let r = SdsCompute.validate(productName: "Quat 256", active: true)
        XCTAssertTrue(r.isOk)
        XCTAssertEqual(r.value?.active, 1)
    }

    func testAcceptsActiveFalse() {
        let r = SdsCompute.validate(productName: "Quat 256", active: false)
        XCTAssertTrue(r.isOk)
        XCTAssertEqual(r.value?.active, 0)
    }

    func testAcceptsMissingActive() {
        let r = SdsCompute.validate(productName: "Quat 256")
        XCTAssertTrue(r.isOk)
        XCTAssertNil(r.value?.active)
    }

    // ── normalized value on success ───────────────────────────────────

    func testReturnsTrimmedStringsOnOk() {
        let r = SdsCompute.validate(
            productName: "  Quat 256  ",
            manufacturer: "  Ecolab  ",
            hazardClass: "  Corrosive  "
        )
        XCTAssertTrue(r.isOk)
        let v = r.value!
        XCTAssertEqual(v.productName, "Quat 256")
        XCTAssertEqual(v.manufacturer, "Ecolab")
        XCTAssertEqual(v.hazardClass, "corrosive") // canonicalized lowercase
    }

    func testValueFieldsNullWhenAbsent() {
        let r = SdsCompute.validate(productName: "Quat 256")
        XCTAssertTrue(r.isOk)
        let v = r.value!
        XCTAssertNil(v.manufacturer)
        XCTAssertNil(v.hazardClass)
        XCTAssertNil(v.url)
        XCTAssertNil(v.pdfPath)
    }
}
