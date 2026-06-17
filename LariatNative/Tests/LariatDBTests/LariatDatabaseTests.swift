import XCTest
import GRDB
@testable import LariatDB

final class LariatDatabaseTests: XCTestCase {
    func testOpensReadOnlyAndReads() throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let db = try LariatDatabase(path: path)
        let count = try db.pool.read { try Int.fetchOne($0, sql: "SELECT COUNT(*) FROM accounting_variance") }
        XCTAssertEqual(count, 4) // 2 P0 snapshot rows + 2 T10 trend rows
    }

    func testRejectsWrites() throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let db = try LariatDatabase(path: path)
        XCTAssertThrowsError(try db.pool.write { try $0.execute(sql: "INSERT INTO pack_size_changes (vendor,sku) VALUES ('x','y')") })
    }
}
