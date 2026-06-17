import XCTest
@testable import LariatModel

final class ManagementAuditLoggerTests: XCTestCase {
    func testAppendsJsonLine() throws {
        let dir = NSTemporaryDirectory() + "audit-" + UUID().uuidString
        let path = (dir as NSString).appendingPathComponent("management-actions.jsonl")
        defer { try? FileManager.default.removeItem(atPath: dir) }
        let logger = ManagementAuditLogger(auditPath: path)
        try logger.logPackSizeAcknowledged(
            packSizeChangesId: 42,
            vendor: "Sysco",
            sku: "A1",
            prevPack: "6x#10",
            newPack: "4x#10",
            note: "OK"
        )
        let content = try String(contentsOfFile: path, encoding: .utf8)
        XCTAssertTrue(content.contains("pack_size_change_acknowledged"))
        XCTAssertTrue(content.contains("Sysco"))
    }
}
