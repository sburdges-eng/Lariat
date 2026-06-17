import XCTest
@testable import LariatModel

final class WriteErrorMapperTests: XCTestCase {
    func testBusyMessage() {
        struct Busy: LocalizedError { var errorDescription: String? { "SQLite error 5: database is locked" } }
        XCTAssertTrue(WriteErrorMapper.message(for: Busy()).contains("busy"))
    }
}
