import XCTest
@testable import LariatModel

/// Pinning the below-par predicate — parity with `par/page.jsx`: low iff both
/// par_qty and on_hand are present AND on_hand < par_qty.
final class InventoryParComputeTests: XCTestCase {
    func testLowWhenOnHandBelowPar() {
        XCTAssertTrue(InventoryParCompute.isLowPar(parQty: 10, onHand: 4))
    }
    func testNotLowWhenOnHandAtOrAbovePar() {
        XCTAssertFalse(InventoryParCompute.isLowPar(parQty: 10, onHand: 10))
        XCTAssertFalse(InventoryParCompute.isLowPar(parQty: 10, onHand: 12))
    }
    func testNeverLowWhenEitherMissing() {
        XCTAssertFalse(InventoryParCompute.isLowPar(parQty: nil, onHand: 4))   // no par set
        XCTAssertFalse(InventoryParCompute.isLowPar(parQty: 10, onHand: nil))  // never counted
        XCTAssertFalse(InventoryParCompute.isLowPar(parQty: nil, onHand: nil))
    }
}
