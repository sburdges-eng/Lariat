import XCTest
import GRDB
@testable import LariatModel

final class RecordsTests: XCTestCase {
    func testDecodeAccountingVariance() throws {
        let q = try DatabaseQueue()
        try q.write { db in
            try db.execute(sql: "CREATE TABLE accounting_variance (id INTEGER, location_id TEXT, theoretical_cogs REAL, actual_cogs REAL, variance_amount REAL, variance_pct REAL, snapshot_at TEXT, extra TEXT)")
            try db.execute(sql: "INSERT INTO accounting_variance VALUES (1,'default',1000,1120,120,12,'2026-06-16','ignored')")
        }
        let row = try q.read { try AccountingVariance.fetchOne($0, sql: "SELECT * FROM accounting_variance") }
        XCTAssertEqual(row?.theoreticalCogs, 1000)
        XCTAssertEqual(row?.actualCogs, 1120)
        XCTAssertEqual(row?.locationId, "default")
    }
}
