import XCTest
@testable import LariatModel

final class DateMarkComputeTests: XCTestCase {
    func testComputeDiscardOnAddsSixDays() throws {
        XCTAssertEqual(try DateMarkCompute.computeDiscardOn(preparedOn: "2026-04-20"), "2026-04-26")
    }

    func testValidateCreateRejectsEmptyItem() {
        let result = DateMarkCompute.validateCreate(item: "  ", preparedOn: "2026-04-20")
        guard case .failure(let err) = result else { return XCTFail("expected failure") }
        XCTAssertEqual(err, .validationFailed("Item is required"))
    }

    func testScanExpiringBatchesSortsExpiredFirst() {
        let rows = [
            DateMarkRow(
                id: 1, locationId: "default", item: "A", batchRef: nil,
                preparedOn: "2026-04-12", discardOn: "2026-04-18",
                discardedAt: nil, discardedByCookId: nil, discardReason: nil,
                cookId: nil, createdAt: nil
            ),
            DateMarkRow(
                id: 2, locationId: "default", item: "B", batchRef: nil,
                preparedOn: "2026-04-19", discardOn: "2026-04-25",
                discardedAt: nil, discardedByCookId: nil, discardReason: nil,
                cookId: nil, createdAt: nil
            ),
        ]
        let scan = DateMarkCompute.scanExpiringBatches(rows, today: "2026-04-20")
        XCTAssertEqual(scan.first?.status, .expired)
        XCTAssertEqual(scan.first?.daysUntilDiscard, -2)
    }
}
