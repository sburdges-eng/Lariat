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

    // ── T6 parity tests ───────────────────────────────────────────────────────

    /// B3 — costing-ingest freshness.
    /// Fixture seeds one 'costing' run started datetime('now','-2 hours').
    /// Mirror of readLastCostingIngest() in lib/costingBenchmarks.mjs.
    func testCostingIngestFreshness() async throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let repo = ManagementRollupRepository(database: try LariatDatabase(path: path), locationId: "default")
        let snap = try await repo.load()

        let ingest = try XCTUnwrap(snap.lastCostingIngest,
            "Expected lastCostingIngest to be non-nil from fixture")
        XCTAssertEqual(ingest.lastStatus, "ok")
        // started_at is runtime-relative (now - 2h); assert band rather than exact value.
        // A fresh test run should show age close to 120 min; allow 110–130 for slow CI.
        let age = try XCTUnwrap(ingest.ageMinutes, "Expected ageMinutes to be non-nil")
        XCTAssertGreaterThanOrEqual(age, 110, "age_minutes should be ≥ 110 (fixture: now - 2h)")
        XCTAssertLessThanOrEqual(age, 130, "age_minutes should be ≤ 130 (fixture: now - 2h)")
    }

    /// Price-shock summary.
    /// Fixture seeds Sysco/F001 with baseline=3.50 (now-5d) and latest=3.85 (now-1d).
    /// delta ≈ +10% > 5% threshold, direction=up → total=1, up=1, down=0.
    /// Mirror of readPriceShockSummary(db, locationId) in app/management/page.jsx
    /// which calls listPriceShocks(db, { location_id, windowDays:7, minPctMove:5, limit:100 }).
    func testPriceShockSummary() async throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let repo = ManagementRollupRepository(database: try LariatDatabase(path: path), locationId: "default")
        let snap = try await repo.load()

        let shocks = try XCTUnwrap(snap.priceShocks,
            "Expected priceShocks to be non-nil from fixture")
        // Fixture: 1 SKU (Sysco/F001) with +10% move in 7-day window
        XCTAssertEqual(shocks.total, 1)
        XCTAssertEqual(shocks.up, 1)
        XCTAssertEqual(shocks.down, 0)
    }

    /// Depletion-exception count.
    /// Fixture seeds sales_lines with Burger, Tacos, MysteryX.
    /// dish_components has entries for Burger and Tacos (so they resolve cleanly).
    /// MysteryX has no dish_components → exactly 1 depletion exception.
    /// Mirror of listDepletionExceptions(db, { location_id, limit:100 }).length
    /// in app/management/page.jsx.
    func testDepletionExceptionCount() async throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let repo = ManagementRollupRepository(database: try LariatDatabase(path: path), locationId: "default")
        let snap = try await repo.load()

        XCTAssertEqual(snap.depletionExceptionCount, 1,
            "Only MysteryX should be a depletion exception; Burger and Tacos resolve via dish_components")
    }
}
