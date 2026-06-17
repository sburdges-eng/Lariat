import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

final class ManagementRollupRepositoryTests: XCTestCase {
    func testLoadsLatestVarianceCoverageAndUnackCount() async throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let repo = ManagementRollupRepository(database: try LariatDatabase(path: path), locationId: "default")
        let snap = try await repo.load()
        XCTAssertEqual(snap.variance?.actualCogs, 950)        // latest by snapshot_at
        XCTAssertEqual(snap.coverage?.coveragePct, 95.9)
        XCTAssertEqual(snap.unacknowledgedPackSizeChanges, 1) // one row acknowledged=0
    }

    func testReloadReflectsExternalWrite() async throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let repo = ManagementRollupRepository(database: try LariatDatabase(path: path), locationId: "default")
        let before = try await repo.load()
        XCTAssertEqual(before.unacknowledgedPackSizeChanges, 1)
        // Simulate the web app writing from a separate connection:
        let writer = try DatabaseQueue(path: path)
        try await writer.write { try $0.execute(sql: "INSERT INTO pack_size_changes (vendor,sku,acknowledged) VALUES ('X','Z',0)") }
        let after = try await repo.load()
        XCTAssertEqual(after.unacknowledgedPackSizeChanges, 2)
    }

    func testStreamYieldsInitialSnapshot() async throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let repo = ManagementRollupRepository(database: try LariatDatabase(path: path), locationId: "default")
        var iterator = repo.stream(every: .milliseconds(50)).makeAsyncIterator()
        let first = await iterator.next()
        XCTAssertEqual(first?.unacknowledgedPackSizeChanges, 1)
    }
}
