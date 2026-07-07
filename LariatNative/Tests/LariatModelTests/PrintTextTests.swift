import XCTest
@testable import LariatModel

// Pins the boundary-consistency contract of `PrintText.pad` — the bug this
// helper fixes was an inconsistent output length at the width boundary (an
// under-width value padded to exactly `width`, but an at-or-over-width value
// got `count + 1`, shifting every later column by ≥1 relative to shorter
// rows). These are spec-pinning assertions, not a red-then-green pair: they
// should PASS against the helper as written.
final class PrintTextTests: XCTestCase {

    private let width = 10

    func testUnderWidthValuePadsToWidthPlusOne() {
        let s = "abc" // 3 chars, under width
        XCTAssertEqual(PrintText.pad(s, width).count, width + 1)
    }

    func testExactWidthValueAlsoPadsToWidthPlusOne() {
        let s = String(repeating: "x", count: width) // exactly width
        XCTAssertEqual(PrintText.pad(s, width).count, width + 1)
    }

    func testOverWidthValuePadsToItsOwnLengthPlusOne() {
        let s = String(repeating: "x", count: width + 5) // over width
        XCTAssertEqual(PrintText.pad(s, width).count, s.count + 1)
    }

    func testAlwaysHasAtLeastOneTrailingSpace() {
        for s in ["", "a", String(repeating: "x", count: width), String(repeating: "x", count: width + 3)] {
            XCTAssertTrue(PrintText.pad(s, width).hasSuffix(" "))
        }
    }
}
