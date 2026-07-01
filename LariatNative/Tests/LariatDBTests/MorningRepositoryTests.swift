import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

// Behavior-parity port of tests/js/test-morning-digest.mjs against an in-memory
// (on-disk temp) GRDB fixture seeded with the real morning-digest schema. This is
// a READ-ONLY surface — no write DB, no audit_events. Exercises the four morning
// SELECTs (86 board, certs, maintenance, BEO prep) + the price-shock ranking, then
// runs them through MorningCompute for end-to-end digest parity.
//
// `today` is pinned to "2026-04-25" (TODAY in the web test). Price-shock snapshots
// use runtime-relative datetime('now', ...) offsets so they stay inside the 7-day
// window on any calendar day (matching the shared fixture convention).
final class MorningRepositoryTests: XCTestCase {

    private let today = "2026-04-25"

    // ── "assembles the manager-open digest from existing tables" ───────────────

    func testFetchAssemblesEverySection() async throws {
        let path = try seedMorningDatabase(today: today)
        defer { cleanup(path: path) }
        let repo = MorningRepository(database: try LariatDatabase(path: path), locationId: "default")

        let bundle = try await repo.fetch(today: today)

        // 86 board: Avocado unresolved; Lime resolved (excluded) → count 1
        XCTAssertEqual(bundle.eightySixCount, 1)
        XCTAssertEqual(bundle.eightySixItems.map { $0.item }, ["Avocado"])
        XCTAssertEqual(bundle.eightySixItems.first?.reason, "vendor short")

        // Price shocks: Avocado AVO-1 baseline 20 → latest 25 = +25% (in window)
        XCTAssertEqual(bundle.priceShocks.count, 1)
        XCTAssertEqual(bundle.priceShocks.first?.sku, "AVO-1")
        XCTAssertEqual(bundle.priceShocks.first?.ingredient, "Avocado")
        XCTAssertEqual(bundle.priceShocks.first?.deltaPct ?? 0, 25.0, accuracy: 0.0001)

        // Certs raw (ordered expires_on ASC): cook-1 (today+3), cook-2 (2026-05-20 far)
        XCTAssertEqual(bundle.certRows.map { $0.cookId }, ["cook-1", "cook-2"])

        // Maintenance raw: Walk-in cooler due today
        XCTAssertEqual(bundle.maintenanceRows.map { $0.equipmentName }, ["Walk-in cooler"])

        // BEO raw: Wedding tasting, 1 open / 1 done / 2 total
        XCTAssertEqual(bundle.beoRows.count, 1)
        XCTAssertEqual(bundle.beoRows.first?.title, "Wedding tasting")
        XCTAssertEqual(bundle.beoRows.first?.openTasks, 1)
        XCTAssertEqual(bundle.beoRows.first?.doneTasks, 1)
        XCTAssertEqual(bundle.beoRows.first?.totalTasks, 2)

        // End-to-end through MorningCompute (alerts from an empty summary).
        let digest = MorningCompute.assemble(
            summary: zeroSummary(), bundle: bundle, locationId: "default", today: today)
        XCTAssertEqual(digest.eightySix.count, 1)
        XCTAssertEqual(digest.priceShocks.count, 1)
        XCTAssertEqual(digest.certsExpiringWeek.count, 1)          // cook-2 filtered out by 7-day window
        XCTAssertEqual(digest.certsExpiringWeek.items.first?.cookId, "cook-1")
        XCTAssertEqual(digest.maintenanceDue.count, 1)
        XCTAssertEqual(digest.beoPrep.count, 1)
        XCTAssertTrue(digest.webhookText.contains("86 board: 1 item"))
        XCTAssertTrue(digest.webhookText.contains("Price shocks: 1 item"))
    }

    // ── "scopes every section to the requested location" ───────────────────────

    func testScopesEverySectionToLocation() async throws {
        let path = try seedScopedDatabase(today: today)
        defer { cleanup(path: path) }
        let db = try LariatDatabase(path: path)

        let a = try await MorningRepository(database: db, locationId: "kitchen-a").fetch(today: today)
        let b = try await MorningRepository(database: db, locationId: "kitchen-b").fetch(today: today)

        XCTAssertEqual(a.eightySixCount, 1)
        XCTAssertEqual(a.maintenanceRows.count, 1)   // Flat top belongs to kitchen-a
        XCTAssertEqual(b.eightySixCount, 1)
        XCTAssertEqual(b.maintenanceRows.count, 0)   // kitchen-b has no maintenance schedule
    }

    // ── "limits BEO prep to events that still have open tasks" ─────────────────

    func testBeoPrepOnlyEventsWithOpenTasks() async throws {
        let path = try seedBeoDatabase(today: today)
        defer { cleanup(path: path) }
        let repo = MorningRepository(database: try LariatDatabase(path: path), locationId: "default")

        let bundle = try await repo.fetch(today: today)

        // 10 fully-done events excluded by HAVING open > 0; only the 1 open-prep event survives.
        XCTAssertEqual(bundle.beoRows.count, 1)
        XCTAssertEqual(bundle.beoRows.map { $0.title }, ["Open prep event"])
        XCTAssertEqual(bundle.beoRows.first?.openTasks, 1)
    }

    // ── helpers ────────────────────────────────────────────────────────────────

    private func zeroSummary() -> CommandSummary {
        CommandSummary(
            shiftDate: today, yesterday: "2026-04-24", locationId: "default",
            sales: .init(yesterdayNet: 0, orders: 0, guests: 0, avg7Net: 0, avg7Orders: 0, deltaPct: 0),
            eightySix: 0,
            inventory: .init(lowPar: 0, parTotal: 0, openCounts: 0),
            labor: .init(openBreaks: 0, certExpiring30d: 0, certExpired: 0,
                         performanceReviewsToday: 1, performanceReviewsTotal: 1),
            foodSafety: .init(tempBreaches: 0, tempReadings: 0, dateMarksExpired: 0,
                              dateMarksDueToday: 0, cleaningOverdue: 0, cleaningDueToday: 0,
                              probesOverdue: 0, probesFailed: 0, probesDueSoon: 0),
            preshiftNotes: 0, eventsToday: 0, eventsGuests: 0,
            reservations: .init(booked: 0, seated: 0, completed: 0, noShow: 0, cancelled: 0, total: 0),
            prep: .init(todo: 0, inProgress: 0, done: 0, skipped: 0, rush: 0),
            priceMoves: .init(total: 0, up: 0, down: 0),
            marginMoves: .init(total: 0, up: 0, down: 0),
            diningTables: .init(open: 0, seated: 0, dirty: 0, closed: 0, total: 0, seatsTotal: 0, seatsSeated: 0),
            waste: .init(today: 0, last7d: 0))
    }

    private func cleanup(path: String) {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.removeItem(atPath: dir)
    }
}

// MARK: - Fixture builders

/// Shared morning schema (the tables buildMorningDigest reads).
private func createMorningSchema(_ db: Database) throws {
    try db.execute(sql: """
        CREATE TABLE eighty_six (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          location_id TEXT NOT NULL DEFAULT 'default',
          shift_date  TEXT NOT NULL,
          item        TEXT,
          reason      TEXT,
          quantity    TEXT,
          station_id  TEXT,
          resolved_at TEXT,
          created_at  TEXT DEFAULT (datetime('now')));

        CREATE TABLE staff_certifications (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          location_id TEXT NOT NULL DEFAULT 'default',
          cook_id     TEXT,
          cert_type   TEXT,
          cert_label  TEXT,
          expires_on  TEXT,
          active      INTEGER NOT NULL DEFAULT 1);

        CREATE TABLE equipment (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          location_id TEXT NOT NULL DEFAULT 'default',
          name        TEXT,
          category    TEXT);

        CREATE TABLE equipment_maintenance_schedule (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          location_id  TEXT NOT NULL DEFAULT 'default',
          equipment_id INTEGER,
          task         TEXT,
          frequency    TEXT,
          next_due     TEXT);

        CREATE TABLE beo_events (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          location_id TEXT NOT NULL DEFAULT 'default',
          title       TEXT,
          event_date  TEXT,
          event_time  TEXT,
          guest_count INTEGER,
          status      TEXT);

        CREATE TABLE beo_prep_tasks (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          location_id TEXT NOT NULL DEFAULT 'default',
          event_id    INTEGER,
          task        TEXT,
          due_date    TEXT,
          done        INTEGER NOT NULL DEFAULT 0);

        CREATE TABLE vendor_prices_history (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          ingredient  TEXT,
          vendor      TEXT,
          sku         TEXT,
          pack_size   REAL,
          pack_unit   TEXT,
          pack_price  REAL,
          unit_price  REAL,
          category    TEXT,
          location_id TEXT NOT NULL DEFAULT 'default',
          imported_at TEXT,
          snapshot_at TEXT,
          snapshot_reason TEXT,
          run_id      INTEGER);

        CREATE TABLE vendor_prices (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          ingredient  TEXT NOT NULL,
          vendor      TEXT,
          sku         TEXT,
          pack_size   REAL,
          pack_unit   TEXT,
          pack_price  REAL,
          unit_price  REAL,
          category    TEXT,
          location_id TEXT NOT NULL DEFAULT 'default',
          imported_at TEXT DEFAULT (datetime('now')));
        """)
}

private func newFixturePath() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-morning-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.appendingPathComponent("lariat.db").path
}

/// Full digest fixture — mirrors the web test's "assembles the manager-open digest" inserts.
private func seedMorningDatabase(today: String) throws -> String {
    let path = try newFixturePath()
    let queue = try DatabaseQueue(path: path)
    try queue.write { db in
        try createMorningSchema(db)

        try db.execute(sql: """
            INSERT INTO eighty_six (shift_date, item, reason, location_id)
              VALUES (?, 'Avocado', 'vendor short', 'default');
            INSERT INTO eighty_six (shift_date, item, reason, location_id, resolved_at)
              VALUES (?, 'Lime', 'resolved', 'default', datetime('now'));
            """, arguments: [today, today])

        // cert cook-1 expires today+3 (2026-04-28), cook-2 far (2026-05-20).
        try db.execute(sql: """
            INSERT INTO staff_certifications (cook_id, cert_type, cert_label, expires_on, active, location_id)
              VALUES ('cook-1', 'food_handler', 'Food Handler', '2026-04-28', 1, 'default');
            INSERT INTO staff_certifications (cook_id, cert_type, cert_label, expires_on, active, location_id)
              VALUES ('cook-2', 'food_handler', 'Food Handler', '2026-05-20', 1, 'default');
            """)

        try db.execute(sql: """
            INSERT INTO equipment (name, category, location_id)
              VALUES ('Walk-in cooler', 'cold', 'default');
            INSERT INTO equipment_maintenance_schedule (equipment_id, task, frequency, next_due, location_id)
              VALUES ((SELECT id FROM equipment WHERE name = 'Walk-in cooler'), 'Filter clean', 'weekly', ?, 'default');
            """, arguments: [today])

        try db.execute(sql: """
            INSERT INTO beo_events (title, event_date, event_time, guest_count, status, location_id)
              VALUES ('Wedding tasting', ?, '17:00', 80, 'planned', 'default');
            INSERT INTO beo_prep_tasks (event_id, task, due_date, done, location_id)
              VALUES ((SELECT id FROM beo_events WHERE title = 'Wedding tasting'), 'Marinate chicken', ?, 0, 'default');
            INSERT INTO beo_prep_tasks (event_id, task, due_date, done, location_id)
              VALUES ((SELECT id FROM beo_events WHERE title = 'Wedding tasting'), 'Pack sauces', ?, 1, 'default');
            """, arguments: [today, today, today])

        // Price snapshots: baseline 20 @ now-6d, latest 25 @ now → +25% (in 7-day window).
        try db.execute(sql: """
            INSERT INTO vendor_prices_history
              (run_id, ingredient, vendor, sku, pack_size, pack_unit, pack_price,
               unit_price, category, location_id, snapshot_at, snapshot_reason)
            VALUES
              (1, 'Avocado', 'sysco', 'AVO-1', 1, 'lb', 20, 20, 'produce', 'default', datetime('now', '-6 days'), 'test'),
              (1, 'Avocado', 'sysco', 'AVO-1', 1, 'lb', 25, 25, 'produce', 'default', datetime('now'),          'test');
            """)
    }
    return path
}

/// Location-scoping fixture: 86 rows in kitchen-a and kitchen-b; maintenance only in kitchen-a.
private func seedScopedDatabase(today: String) throws -> String {
    let path = try newFixturePath()
    let queue = try DatabaseQueue(path: path)
    try queue.write { db in
        try createMorningSchema(db)
        try db.execute(sql: """
            INSERT INTO eighty_six (shift_date, item, location_id) VALUES (?, 'A', 'kitchen-a');
            INSERT INTO eighty_six (shift_date, item, location_id) VALUES (?, 'B', 'kitchen-b');
            INSERT INTO equipment (name, category, location_id) VALUES ('Flat top', 'hot', 'kitchen-a');
            INSERT INTO equipment_maintenance_schedule (equipment_id, task, frequency, next_due, location_id)
              VALUES ((SELECT id FROM equipment WHERE name = 'Flat top'), 'Scrape', 'daily', ?, 'kitchen-a');
            """, arguments: [today, today, today])
    }
    return path
}

/// BEO-only fixture: 10 fully-done events + 1 open-prep event.
private func seedBeoDatabase(today: String) throws -> String {
    let path = try newFixturePath()
    let queue = try DatabaseQueue(path: path)
    try queue.write { db in
        try createMorningSchema(db)
        for i in 0..<10 {
            try db.execute(sql: """
                INSERT INTO beo_events (title, event_date, event_time, guest_count, status, location_id)
                  VALUES (?, ?, '08:00', 20, 'planned', 'default');
                INSERT INTO beo_prep_tasks (event_id, task, due_date, done, location_id)
                  VALUES ((SELECT MAX(id) FROM beo_events), 'Wrapped', ?, 1, 'default');
                """, arguments: ["Done event \(i + 1)", today, today])
        }
        try db.execute(sql: """
            INSERT INTO beo_events (title, event_date, event_time, guest_count, status, location_id)
              VALUES ('Open prep event', ?, '18:00', 60, 'planned', 'default');
            INSERT INTO beo_prep_tasks (event_id, task, due_date, done, location_id)
              VALUES ((SELECT MAX(id) FROM beo_events), 'Final garnish', ?, 0, 'default');
            """, arguments: [today, today])
    }
    return path
}
