import XCTest
import GRDB
@testable import LariatDB

/// Parity tests for the read-only CloudBridge status surface (A5.4 option B,
/// ratified 2026-07-03).
///
/// Web oracles:
///   - `tests/js/test-cloud-bridge-queue.mjs` — `depth()` counts batches
///     "available to claim" (dead_letter = 0 AND claimed_at IS NULL); claimed
///     (in-flight) rows are excluded; `deadLetterDepth()` counts dead_letter = 1.
///     Neither is location-scoped (the board shows `dead_letter_depth_total`).
///   - `tests/js/test-cloud-bridge-stub.mjs` — `bridge.status()` is a stub:
///     `{ lastPushAt: null, lastPullAt: null, queueDepth: 0, lastError: null }`,
///     and `isCloudBridgeConfigured()` is true only when BOTH the URL and the
///     secret are present (JS truthiness: empty string is falsy).
///
/// READ-ONLY: no writes, no audit rows — the repository opens only the
/// read-only `LariatDatabase`.
final class CloudBridgeStatusRepositoryTests: XCTestCase {

    // Build a temp WAL SQLite file with just the one table the repo reads
    // (`cloud_bridge_outbox`, schema from lib/db.ts::initSchema), seeded via a
    // writer DatabasePool, then reopened read-only through LariatDatabase
    // (MarginDeltasRepositoryTests precedent). NO native migration — this is a
    // web-owned table the harness recreates only for the test.
    private func makeDB(seed: (Database) throws -> Void) throws -> (LariatDatabase, String) {
        let dir = NSTemporaryDirectory() + "lariat-cloudbridge-" + UUID().uuidString
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let path = (dir as NSString).appendingPathComponent("lariat.db")
        let writer = try DatabasePool(path: path)  // establishes WAL mode
        try writer.write { db in
            try db.execute(sql: """
                CREATE TABLE cloud_bridge_outbox (
                  id            INTEGER PRIMARY KEY AUTOINCREMENT,
                  table_name    TEXT NOT NULL,
                  location_id   TEXT NOT NULL DEFAULT 'default',
                  rows_json     TEXT NOT NULL,
                  attempts      INTEGER NOT NULL DEFAULT 0,
                  last_error    TEXT,
                  dead_letter   INTEGER NOT NULL DEFAULT 0,
                  enqueued_at   TEXT NOT NULL DEFAULT (datetime('now')),
                  claimed_at    TEXT,
                  claim_owner   TEXT
                );
                """)
            try seed(db)
        }
        // writer deinits, closing the pool; WAL persists so a read-only pool can open it.
        return (try LariatDatabase(path: path), dir)
    }

    /// Insert one outbox row. `claimed: true` → in-flight (claimed_at set).
    private func insertBatch(
        _ db: Database,
        table: String = "settlement_summaries",
        locationId: String = "default",
        deadLetter: Bool = false,
        claimed: Bool = false,
        lastError: String? = nil
    ) throws {
        try db.execute(sql: """
            INSERT INTO cloud_bridge_outbox
              (table_name, location_id, rows_json, attempts, last_error, dead_letter, claimed_at)
            VALUES (?, ?, '[{"x":1}]', ?, ?, ?, ?)
            """, arguments: [
                table, locationId,
                deadLetter ? 5 : 0,
                lastError,
                deadLetter ? 1 : 0,
                claimed || deadLetter ? "2026-07-03 10:00:00" : nil,
            ])
    }

    // ── load(): queue counts ────────────────────────────────────────────────

    /// Oracle: "depth() — empty": depth()=0, deadLetterDepth()=0. Plus the
    /// status-endpoint stub parity: lastPushAt / lastPullAt / lastError are
    /// null — the web bridge never persists a last-sync (ack() DELETEs pushed
    /// rows), so an empty queue reports NO sync data, not fake zeros-as-health.
    func testEmptyQueueReportsZeroDepthsAndNoSyncData() async throws {
        let (db, dir) = try makeDB { _ in }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let status = try await CloudBridgeStatusRepository(database: db).load()
        XCTAssertEqual(status.queuedDepth, 0)
        XCTAssertEqual(status.deadLetterTotal, 0)
        XCTAssertNil(status.lastPushAt, "web bridge.status() stub: lastPushAt is null")
        XCTAssertNil(status.lastPullAt, "web bridge.status() stub: lastPullAt is null")
        XCTAssertNil(status.lastError, "web bridge.status() stub: lastError is null")
    }

    /// Oracle: "drops claimed rows out of depth" — depth() counts only
    /// dead_letter = 0 AND claimed_at IS NULL. In-flight (claimed) rows and
    /// dead-lettered rows are excluded; dead-lettered rows land in
    /// deadLetterTotal instead.
    func testQueuedDepthExcludesInFlightAndDeadLettered() async throws {
        let (db, dir) = try makeDB { db in
            try self.insertBatch(db)                                  // queued
            try self.insertBatch(db)                                  // queued
            try self.insertBatch(db)                                  // queued
            try self.insertBatch(db, claimed: true)                   // in-flight
            try self.insertBatch(db, deadLetter: true, lastError: "410 gone")  // DLQ
            try self.insertBatch(db, deadLetter: true, lastError: "500")       // DLQ
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let status = try await CloudBridgeStatusRepository(database: db).load()
        XCTAssertEqual(status.queuedDepth, 3, "in-flight + dead-lettered rows are excluded from depth()")
        XCTAssertEqual(status.deadLetterTotal, 2)
    }

    /// Parity with `dead_letter_depth_total` (GET /api/cloud-bridge/dead-letters
    /// + the board's "Stuck" card): the dead-letter COUNT is NOT location-scoped
    /// — a manager sees total stuck batches across sites, exactly like the web
    /// `deadLetterDepth()`. (Only the triage LIST is location-scoped, and the
    /// list stays on the edge with the requeue/drop actions.)
    func testDeadLetterTotalIsNotLocationScoped() async throws {
        let (db, dir) = try makeDB { db in
            try self.insertBatch(db, locationId: "kitchen-a", deadLetter: true)
            try self.insertBatch(db, locationId: "kitchen-b", deadLetter: true)
            try self.insertBatch(db, locationId: "kitchen-b")  // queued, not dead
        }
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let status = try await CloudBridgeStatusRepository(database: db).load()
        XCTAssertEqual(status.deadLetterTotal, 2, "deadLetterDepth() counts all locations")
        XCTAssertEqual(status.queuedDepth, 1, "depth() counts all locations")
    }

    // ── isConfigured(): env parity ──────────────────────────────────────────

    /// Oracle: `isCloudBridgeConfigured()` matrix from test-cloud-bridge-stub.mjs
    /// — requires BOTH LARIAT_CLOUD_BRIDGE_URL and LARIAT_CLOUD_BRIDGE_SECRET.
    /// JS truthiness: an empty string is falsy → unconfigured.
    func testIsConfiguredRequiresBothUrlAndSecret() {
        XCTAssertFalse(CloudBridgeStatusRepository.isConfigured(environment: [:]))
        XCTAssertFalse(CloudBridgeStatusRepository.isConfigured(
            environment: ["LARIAT_CLOUD_BRIDGE_SECRET": "k"]))
        XCTAssertFalse(CloudBridgeStatusRepository.isConfigured(
            environment: ["LARIAT_CLOUD_BRIDGE_URL": "u"]))
        XCTAssertTrue(CloudBridgeStatusRepository.isConfigured(
            environment: ["LARIAT_CLOUD_BRIDGE_URL": "u", "LARIAT_CLOUD_BRIDGE_SECRET": "k"]))
        // Boolean('') === false on the web.
        XCTAssertFalse(CloudBridgeStatusRepository.isConfigured(
            environment: ["LARIAT_CLOUD_BRIDGE_URL": "", "LARIAT_CLOUD_BRIDGE_SECRET": "k"]))
        XCTAssertFalse(CloudBridgeStatusRepository.isConfigured(
            environment: ["LARIAT_CLOUD_BRIDGE_URL": "u", "LARIAT_CLOUD_BRIDGE_SECRET": ""]))
    }
}
