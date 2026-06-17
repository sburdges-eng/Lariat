import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

final class PackChangesRepositoryTests: XCTestCase {
    func testListOpenAndAcknowledge() throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let auditDir = NSTemporaryDirectory() + "audit-" + UUID().uuidString
        let auditPath = (auditDir as NSString).appendingPathComponent("management-actions.jsonl")
        defer { try? FileManager.default.removeItem(atPath: auditDir) }

        let db = try LariatWriteDatabase(path: path)
        let repo = PackChangesRepository(database: db, auditLogger: ManagementAuditLogger(auditPath: auditPath))

        let open = try repo.list(filter: .open)
        XCTAssertEqual(open.count, 1)
        XCTAssertEqual(open[0].vendor, "Sysco")
        XCTAssertEqual(open[0].sku, "A1")

        let before = try repo.unacknowledgedCount()
        XCTAssertEqual(before, 1)

        let ack = try repo.acknowledge(id: open[0].id, note: "confirmed")
        XCTAssertTrue(ack.found)
        XCTAssertFalse(ack.wasAlreadyAcknowledged)

        XCTAssertEqual(try repo.unacknowledgedCount(), 0)

        let again = try repo.acknowledge(id: open[0].id, note: nil)
        XCTAssertTrue(again.wasAlreadyAcknowledged)

        let audit = try String(contentsOfFile: auditPath, encoding: .utf8)
        XCTAssertEqual(audit.components(separatedBy: "\n").filter { !$0.isEmpty }.count, 1)
    }

    func testAcknowledgeMissingRow() throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let db = try LariatWriteDatabase(path: path)
        let repo = PackChangesRepository(database: db, auditLogger: ManagementAuditLogger(auditPath: NSTemporaryDirectory() + "x.jsonl"))
        let result = try repo.acknowledge(id: 99999, note: nil)
        XCTAssertFalse(result.found)
    }
}
