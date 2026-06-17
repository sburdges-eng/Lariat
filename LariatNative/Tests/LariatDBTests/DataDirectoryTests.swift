import XCTest
@testable import LariatDB

final class DataDirectoryTests: XCTestCase {
    func testAbsoluteDataDir() {
        XCTAssertEqual(resolveDataDirectory(env: ["LARIAT_DATA_DIR": "/srv/lariat"], cwd: "/work"), "/srv/lariat")
    }

    func testRelativeDataDir() {
        XCTAssertEqual(resolveDataDirectory(env: ["LARIAT_DATA_DIR": "var/db"], cwd: "/work"), "/work/var/db")
    }

    func testAuditOverride() {
        XCTAssertEqual(resolveManagementAuditPath(env: ["LARIAT_AUDIT_PATH": "/tmp/audit.jsonl"], cwd: "/work"), "/tmp/audit.jsonl")
    }

    func testDefaultAuditPath() {
        let p = resolveManagementAuditPath(env: [:], cwd: "/work")
        XCTAssertTrue(p.hasSuffix("data/audit/management-actions.jsonl"))
    }
}
