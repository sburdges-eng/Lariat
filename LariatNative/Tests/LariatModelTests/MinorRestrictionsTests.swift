import XCTest
@testable import LariatModel

final class MinorRestrictionsTests: XCTestCase {
    func testProhibitedStations() {
        for id in ["prep", "prep-cold", "prep_hot", "slicer", "meat-grinder",
                   "hobart-mixer", "bakery", "fry", "fryer", "fry-2"] {
            XCTAssertTrue(
                MinorRestrictions.isStationProhibitedForMinor(id),
                "\(id) should be prohibited for minors"
            )
        }
    }

    func testAllowedStations() {
        for id in ["line", "expo", "dish", "garmo", "plate-up", "grill", "saute", ""] {
            XCTAssertFalse(
                MinorRestrictions.isStationProhibitedForMinor(id),
                "\(id) should be allowed for minors"
            )
        }
    }

    func testTrimsWhitespaceAndIsCaseInsensitive() {
        XCTAssertTrue(MinorRestrictions.isStationProhibitedForMinor("  SLICER  "))
        XCTAssertTrue(MinorRestrictions.isStationProhibitedForMinor("Prep-Cold"))
    }

    func testCitationMatchesWeb() {
        XCTAssertTrue(MinorRestrictions.citation.contains("YEOA"))
        XCTAssertTrue(MinorRestrictions.citation.contains("Hazardous Orders"))
    }
}
