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

    func testDecodeDishCoverageSnapshot() throws {
        let q = try DatabaseQueue()
        try q.write { db in
            try db.execute(sql: "CREATE TABLE dish_coverage_snapshot (location_id TEXT, total_dishes INTEGER, covered_dishes INTEGER, coverage_pct REAL, extra TEXT)")
            try db.execute(sql: "INSERT INTO dish_coverage_snapshot VALUES ('loc-1',50,40,80.0,'ignored')")
        }
        let row = try q.read { try DishCoverageSnapshot.fetchOne($0, sql: "SELECT * FROM dish_coverage_snapshot") }
        XCTAssertEqual(row?.locationId, "loc-1")
        XCTAssertEqual(row?.totalDishes, 50)
        XCTAssertEqual(row?.coveredDishes, 40)
        XCTAssertEqual(row?.coveragePct, 80.0)
    }

    func testDecodePackSizeChange() throws {
        let q = try DatabaseQueue()
        try q.write { db in
            try db.execute(sql: "CREATE TABLE pack_size_change (id INTEGER, vendor TEXT, sku TEXT, acknowledged INTEGER, extra TEXT)")
            try db.execute(sql: "INSERT INTO pack_size_change VALUES (7,'AcmeCo','SKU-99',1,'ignored')")
        }
        let row = try q.read { try PackSizeChange.fetchOne($0, sql: "SELECT * FROM pack_size_change") }
        XCTAssertEqual(row?.id, 7)
        XCTAssertEqual(row?.vendor, "AcmeCo")
        XCTAssertEqual(row?.sku, "SKU-99")
        XCTAssertEqual(row?.acknowledged, true)
    }
}
