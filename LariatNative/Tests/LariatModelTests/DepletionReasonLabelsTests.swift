import XCTest
@testable import LariatModel

final class DepletionReasonLabelsTests: XCTestCase {
    func testEveryReasonHasLabel() {
        for r: DepletionReason in [.noDishComponents, .recipeMissingYield, .crossDimUnitMismatch, .unknownUnit, .invalidQty] {
            XCTAssertFalse(DepletionReasonLabels.label(r).isEmpty, "missing label for \(r.rawValue)")
        }
    }
    func testToneMapping() {
        XCTAssertEqual(DepletionReasonLabels.tone(.noDishComponents), .red)
        XCTAssertEqual(DepletionReasonLabels.tone(.invalidQty), .red)
        XCTAssertEqual(DepletionReasonLabels.tone(.crossDimUnitMismatch), .blue)
        XCTAssertEqual(DepletionReasonLabels.tone(.recipeMissingYield), .yellow)
        XCTAssertEqual(DepletionReasonLabels.tone(.unknownUnit), .yellow)
    }
}
