import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

final class PerformanceReviewsRepositoryTests: XCTestCase {
    func testCreateInsertsReviewAndAuditEvent() throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let auditDir = NSTemporaryDirectory() + "perf-audit-" + UUID().uuidString
        let auditPath = (auditDir as NSString).appendingPathComponent("management-actions.jsonl")
        defer { try? FileManager.default.removeItem(atPath: auditDir) }

        let db = try LariatWriteDatabase(path: path)
        let repo = PerformanceReviewsRepository(
            database: db,
            auditLogger: ManagementAuditLogger(auditPath: auditPath)
        )
        let context = RegulatedWriteContext.nativeMac(
            pinUser: ManagerPinUser(id: 3, locationId: "default", name: "Pat", role: "manager")
        )

        let id = try repo.create(
            input: PerformanceReviewCreateInput(
                cookName: "Dana",
                cookUuid: "uuid-dana",
                reviewDate: "2026-06-17",
                punctualityScore: 5,
                techniqueScore: 4,
                speedScore: 5,
                notes: "Strong shift",
                reviewerName: "Chef Bob",
                locationId: "default"
            ),
            auditContext: context
        )
        XCTAssertGreaterThan(id, 0)

        let rows = try repo.list(locationId: "default")
        XCTAssertTrue(rows.contains { $0.id == id && $0.cookName == "Dana" })

        try db.pool.read { database in
            let auditCount = try Int.fetchOne(
                database,
                sql: "SELECT COUNT(*) FROM audit_events WHERE entity = 'performance_reviews' AND entity_id = ?",
                arguments: [id]
            )
            XCTAssertEqual(auditCount, 1)
        }

        let audit = try String(contentsOfFile: auditPath, encoding: .utf8)
        XCTAssertTrue(audit.contains("performance_review_logged"))
        XCTAssertTrue(audit.contains("Dana"))
    }

    func testCreateRejectsMissingFields() throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let db = try LariatWriteDatabase(path: path)
        let repo = PerformanceReviewsRepository(database: db, auditLogger: ManagementAuditLogger(auditPath: NSTemporaryDirectory() + "x.jsonl"))

        XCTAssertThrowsError(
            try repo.create(
                input: PerformanceReviewCreateInput(
                    cookName: "Dana",
                    cookUuid: nil,
                    reviewDate: "",
                    punctualityScore: 5,
                    techniqueScore: 4,
                    speedScore: 5,
                    notes: nil,
                    reviewerName: "Chef",
                    locationId: "default"
                ),
                auditContext: .nativeMac(pinUser: nil)
            )
        ) { error in
            XCTAssertTrue(error is PerformanceReviewWriteError)
        }
    }

    func testCreateRejectsInvalidScores() throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let db = try LariatWriteDatabase(path: path)
        let repo = PerformanceReviewsRepository(database: db, auditLogger: ManagementAuditLogger(auditPath: NSTemporaryDirectory() + "y.jsonl"))

        XCTAssertThrowsError(
            try repo.create(
                input: PerformanceReviewCreateInput(
                    cookName: "Dana",
                    cookUuid: nil,
                    reviewDate: "2026-06-17",
                    punctualityScore: 6,
                    techniqueScore: 4,
                    speedScore: 5,
                    notes: nil,
                    reviewerName: "Chef",
                    locationId: "default"
                ),
                auditContext: .nativeMac(pinUser: nil)
            )
        ) { error in
            guard case PerformanceReviewWriteError.invalidScores = error else {
                return XCTFail("expected invalidScores")
            }
        }
    }
}
