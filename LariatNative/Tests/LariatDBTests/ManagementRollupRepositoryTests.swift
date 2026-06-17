import XCTest
@testable import LariatDB
@testable import LariatModel

final class ManagementRollupRepositoryTests: XCTestCase {
    func testLoadsLatestVarianceCoverageAndUnackCount() throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let repo = ManagementRollupRepository(database: try LariatDatabase(path: path), locationId: "default")
        let snap = try repo.load()
        XCTAssertEqual(snap.variance?.actualCogs, 950)        // latest by snapshot_at
        XCTAssertEqual(snap.coverage?.coveragePct, 95.9)
        XCTAssertEqual(snap.unacknowledgedPackSizeChanges, 1) // one row acknowledged=0
    }
}
