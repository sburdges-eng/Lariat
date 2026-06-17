import XCTest
import GRDB
@testable import LariatDB

final class LariatWriteDatabaseTests: XCTestCase {
    func testWritesPackSizeChange() throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let db = try LariatWriteDatabase(path: path)
        try db.write { try $0.execute(sql: "INSERT INTO pack_size_changes (vendor,sku,acknowledged) VALUES ('T','S',0)") }
        let count = try db.pool.read { try Int.fetchOne($0, sql: "SELECT COUNT(*) FROM pack_size_changes WHERE vendor='T'") }
        XCTAssertEqual(count, 1)
    }

    func testReadPoolStillRejectsWrites() throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let read = try LariatDatabase(path: path)
        XCTAssertThrowsError(try read.pool.write { try $0.execute(sql: "INSERT INTO pack_size_changes (vendor,sku) VALUES ('x','y')") })
    }
}

    func testRejectsMissingDatabaseFile() {
        let missing = (NSTemporaryDirectory() as NSString).appendingPathComponent("no-such-lariat-\(UUID().uuidString).db")
        XCTAssertThrowsError(try LariatWriteDatabase(path: missing)) { error in
            XCTAssertTrue(error is LariatWriteDatabaseError)
        }
    }
