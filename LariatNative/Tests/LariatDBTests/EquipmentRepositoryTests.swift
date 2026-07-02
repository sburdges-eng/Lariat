import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Behavior-parity port of the four /api/equipment routes against an on-disk
/// temp GRDB fixture seeded with the REAL equipment schemas (lib/db.ts
/// ~L1690-1748 + the L3500-3511 column migrations folded in).
///
/// AUDIT POSTURE (asserted below): the web routes post NO audit_events for
/// any equipment write — successful native writes must leave audit_events
/// empty too (DishComponents precedent). No PIN (open surface). No
/// idempotency — duplicate adds create duplicate rows (divergence from the
/// web's withIdempotency transport wrapper, asserted).
///
/// Web oracle: tests/js/test-equipment-location-scoping.mjs (location scoping
/// for all four routes — natively the repository takes locationId directly;
/// the ?location / body-alias mechanics are web transport concerns).
final class EquipmentRepositoryTests: XCTestCase {

    private func ctx(location: String = "default", cook: String? = nil) -> RegulatedWriteContext {
        RegulatedWriteContext(
            actorCookId: cook,
            actorSource: RegulatedWriteContext.nativeCookActorSource,
            locationId: location,
            shiftDate: "2026-07-02"
        )
    }

    // ── POST /api/equipment ─────────────────────────────────────────────

    func testAddEquipmentAppliesDefaultsAndWritesNoAudit() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }
        let id = try repo.addEquipment(
            input: EquipmentAddInput(name: "  Vulcan VC44GD  ", purchaseCost: 4200.50),
            context: ctx()
        )
        XCTAssertGreaterThan(id, 0)
        try writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM equipment WHERE id = ?", arguments: [id])!
            XCTAssertEqual(row["name"], "Vulcan VC44GD")            // trimmed
            XCTAssertEqual(row["category"], "Uncategorized")        // default
            XCTAssertEqual(row["status"], "active")                 // default
            XCTAssertEqual(row["purchase_cost"], 4200.50)
            XCTAssertEqual(row["location_id"], "default")
            // WEB-PARITY AUDIT POSTURE: no audit_events for equipment writes.
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? -1, 0,
                           "web POST /api/equipment writes no audit_events; native mirrors that")
        }
    }

    func testAddEquipmentRequiresNameAndWritesNothing() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }
        XCTAssertThrowsError(try repo.addEquipment(input: EquipmentAddInput(name: "   "), context: ctx())) {
            XCTAssertEqual($0 as? EquipmentWriteError, .nameRequired)
        }
        XCTAssertThrowsError(try repo.addEquipment(input: EquipmentAddInput(name: nil), context: ctx())) {
            XCTAssertEqual($0 as? EquipmentWriteError, .nameRequired)
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM equipment") ?? -1, 0)
        }
    }

    func testAddEquipmentClipsLongFields() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }
        let id = try repo.addEquipment(
            input: EquipmentAddInput(
                name: String(repeating: "n", count: 300),
                category: String(repeating: "c", count: 100),
                notes: String(repeating: "x", count: 3000)
            ),
            context: ctx()
        )
        try writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM equipment WHERE id = ?", arguments: [id])!
            XCTAssertEqual((row["name"] as String).count, 200)      // MAX_NAME
            XCTAssertEqual((row["category"] as String).count, 60)   // clip(category, 60)
            XCTAssertEqual((row["notes"] as String).count, 2000)    // MAX_NOTES
        }
    }

    func testAddEquipmentIsLocationScoped() async throws {
        let (repo, _, path) = try makeRepo()
        defer { cleanup(path: path) }
        _ = try repo.addEquipment(input: EquipmentAddInput(name: "Reach-in", category: "Refrigeration"), context: ctx(location: "south"))
        _ = try repo.addEquipment(input: EquipmentAddInput(name: "Combi", category: "Cooking"), context: ctx(location: "north"))
        // test-equipment-location-scoping.mjs: reads scoped per location.
        let south = try await repo.listEquipment(locationId: "south")
        XCTAssertEqual(south.map(\.name), ["Reach-in"])
        let north = try await repo.listEquipment(locationId: "north")
        XCTAssertEqual(north.map(\.name), ["Combi"])
    }

    // ── GET /api/equipment: aggregate + ordering ────────────────────────

    func testListEquipmentAggregatesMaintenanceCostAndOrders() async throws {
        let (repo, _, path) = try makeRepo()
        defer { cleanup(path: path) }
        let fryer = try repo.addEquipment(input: EquipmentAddInput(name: "Fryer", category: "Fryers"), context: ctx())
        let oven = try repo.addEquipment(input: EquipmentAddInput(name: "Combi", category: "Ovens"), context: ctx())
        _ = try repo.addMaintenance(input: EquipmentMaintenanceAddInput(equipmentId: fryer, serviceDate: "2026-06-01", type: "Repair", cost: 250), context: ctx())
        _ = try repo.addMaintenance(input: EquipmentMaintenanceAddInput(equipmentId: fryer, serviceDate: "2026-07-01", type: "Routine", cost: 99.5), context: ctx())

        let rows = try await repo.listEquipment(locationId: "default")
        // ORDER BY category, name → Fryers before Ovens.
        XCTAssertEqual(rows.map(\.name), ["Fryer", "Combi"])
        XCTAssertEqual(rows.first { $0.id == fryer }?.maintenanceCost, 349.5)
        XCTAssertEqual(rows.first { $0.id == oven }?.maintenanceCost, 0)   // COALESCE → 0
    }

    // ── POST /api/equipment/maintenance ─────────────────────────────────

    func testAddMaintenanceValidationsAndDefaults() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }
        let eq = try repo.addEquipment(input: EquipmentAddInput(name: "Combi"), context: ctx())

        XCTAssertThrowsError(try repo.addMaintenance(
            input: EquipmentMaintenanceAddInput(equipmentId: nil, serviceDate: "2026-07-02"), context: ctx())) {
            XCTAssertEqual($0 as? EquipmentWriteError, .equipmentIdRequired)
        }
        XCTAssertThrowsError(try repo.addMaintenance(
            input: EquipmentMaintenanceAddInput(equipmentId: 0, serviceDate: "2026-07-02"), context: ctx())) {
            XCTAssertEqual($0 as? EquipmentWriteError, .equipmentIdRequired)
        }
        XCTAssertThrowsError(try repo.addMaintenance(
            input: EquipmentMaintenanceAddInput(equipmentId: eq, serviceDate: "  "), context: ctx())) {
            XCTAssertEqual($0 as? EquipmentWriteError, .serviceDateRequired)
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM equipment_maintenance") ?? -1, 0,
                           "typed errors must fire BEFORE any write")
        }

        let id = try repo.addMaintenance(
            input: EquipmentMaintenanceAddInput(equipmentId: eq, serviceDate: "2026-07-02", cost: 250, cookId: "alice"),
            context: ctx(location: "default")
        )
        try writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM equipment_maintenance WHERE id = ?", arguments: [id])!
            XCTAssertEqual(row["type"], "Routine")                  // default
            XCTAssertEqual(row["cost"], 250.0)
            XCTAssertEqual(row["cook_id"], "alice")
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? -1, 0)
        }
    }

    func testMaintenanceListFiltersByEquipmentAndOrders() async throws {
        let (repo, _, path) = try makeRepo()
        defer { cleanup(path: path) }
        let a = try repo.addEquipment(input: EquipmentAddInput(name: "A"), context: ctx())
        let b = try repo.addEquipment(input: EquipmentAddInput(name: "B"), context: ctx())
        _ = try repo.addMaintenance(input: EquipmentMaintenanceAddInput(equipmentId: a, serviceDate: "2026-06-01"), context: ctx())
        let a2 = try repo.addMaintenance(input: EquipmentMaintenanceAddInput(equipmentId: a, serviceDate: "2026-07-01"), context: ctx())
        _ = try repo.addMaintenance(input: EquipmentMaintenanceAddInput(equipmentId: b, serviceDate: "2026-06-15"), context: ctx())

        let forA = try await repo.listMaintenance(equipmentId: a, locationId: "default")
        // ORDER BY service_date DESC, id DESC.
        XCTAssertEqual(forA.map(\.serviceDate), ["2026-07-01", "2026-06-01"])
        XCTAssertEqual(forA.first?.id, a2)
        let all = try await repo.listMaintenance(locationId: "default")
        XCTAssertEqual(all.count, 3)
    }

    // ── POST /api/equipment/parts ───────────────────────────────────────

    func testAddPartValidationsAndListOrdering() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }
        let eq = try repo.addEquipment(input: EquipmentAddInput(name: "Cooler"), context: ctx())

        XCTAssertThrowsError(try repo.addPart(
            input: EquipmentPartAddInput(equipmentId: eq, partNumber: "  "), context: ctx())) {
            XCTAssertEqual($0 as? EquipmentWriteError, .partNumberRequired)
        }
        XCTAssertThrowsError(try repo.addPart(
            input: EquipmentPartAddInput(equipmentId: -3, partNumber: "OEM-1"), context: ctx())) {
            XCTAssertEqual($0 as? EquipmentWriteError, .equipmentIdRequired)
        }

        _ = try repo.addPart(
            input: EquipmentPartAddInput(equipmentId: eq, partNumber: "OEM-2", description: "Door gasket", unitPrice: 18.75, qtyOnHand: 2),
            context: ctx()
        )
        _ = try repo.addPart(input: EquipmentPartAddInput(equipmentId: eq, partNumber: "OEM-1"), context: ctx())

        let parts = try await repo.listParts(equipmentId: eq, locationId: "default")
        // ORDER BY equipment_id, part_number.
        XCTAssertEqual(parts.map(\.partNumber), ["OEM-1", "OEM-2"])
        XCTAssertEqual(parts.last?.unitPrice, 18.75)
        try await writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? -1, 0)
        }
    }

    // ── POST /api/equipment/schedule ────────────────────────────────────

    func testAddScheduleValidationsAndNullsLastOrdering() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }
        let eq = try repo.addEquipment(input: EquipmentAddInput(name: "Hood"), context: ctx())

        XCTAssertThrowsError(try repo.addSchedule(
            input: EquipmentScheduleAddInput(equipmentId: eq, task: nil, frequency: "Monthly"), context: ctx())) {
            XCTAssertEqual($0 as? EquipmentWriteError, .taskRequired)
        }
        XCTAssertThrowsError(try repo.addSchedule(
            input: EquipmentScheduleAddInput(equipmentId: eq, task: "Degrease", frequency: " "), context: ctx())) {
            XCTAssertEqual($0 as? EquipmentWriteError, .frequencyRequired)
        }

        _ = try repo.addSchedule(
            input: EquipmentScheduleAddInput(equipmentId: eq, task: "No due date", frequency: "Monthly"),
            context: ctx()
        )
        _ = try repo.addSchedule(
            input: EquipmentScheduleAddInput(equipmentId: eq, task: "Filter", frequency: "Weekly", nextDue: "2026-07-10"),
            context: ctx()
        )
        let rows = try await repo.listSchedule(equipmentId: eq, locationId: "default")
        // ORDER BY equipment_id, COALESCE(next_due, '9999-12-31') → dated first.
        XCTAssertEqual(rows.map(\.task), ["Filter", "No due date"])
        try await writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? -1, 0)
        }
    }

    // ── divergence: NO idempotency — duplicate adds are two rows ────────

    func testDuplicateAddsCreateDuplicateRows() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }
        _ = try repo.addEquipment(input: EquipmentAddInput(name: "Slicer"), context: ctx())
        _ = try repo.addEquipment(input: EquipmentAddInput(name: "Slicer"), context: ctx())
        try writeDB.pool.read { db in
            XCTAssertEqual(
                try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM equipment WHERE name = 'Slicer'") ?? -1, 2,
                "no idempotency layer natively — the web's withIdempotency is transport-level"
            )
        }
    }

    // ── FK parity: equipment_id must exist (foreign_keys = ON both sides) ──

    func testMaintenanceForMissingEquipmentFailsFK() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanup(path: path) }
        XCTAssertThrowsError(try repo.addMaintenance(
            input: EquipmentMaintenanceAddInput(equipmentId: 999, serviceDate: "2026-07-02"),
            context: ctx()
        ))
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM equipment_maintenance") ?? -1, 0)
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private func makeRepo() throws -> (EquipmentRepository, LariatWriteDatabase, String) {
        let path = try seedEquipmentDatabase()
        let readDB = try LariatDatabase(path: path)
        let writeDB = try LariatWriteDatabase(path: path)
        return (EquipmentRepository(readDB: readDB, writeDB: writeDB), writeDB, path)
    }

    private func cleanup(path: String) {
        try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent)
    }
}

/// Real web schema (lib/db.ts ~L1690-1748, with the equipment column
/// migrations model_number/vendor/vendor_order_ref/manual_path/notes folded
/// in) + audit_events so the zero-audit posture is observable.
private func seedEquipmentDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-equipment-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path
    let dbQueue = try DatabasePool(path: path)
    try dbQueue.write { db in
        try db.execute(sql: """
            CREATE TABLE equipment (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              category TEXT NOT NULL,
              make_model TEXT,
              serial_number TEXT,
              purchase_date TEXT,
              warranty_expiration TEXT,
              purchase_cost REAL,
              status TEXT DEFAULT 'active',
              location_id TEXT DEFAULT 'default',
              model_number TEXT,
              vendor TEXT,
              vendor_order_ref TEXT,
              manual_path TEXT,
              notes TEXT
            );
            CREATE TABLE equipment_maintenance (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              equipment_id INTEGER NOT NULL,
              service_date TEXT NOT NULL,
              type TEXT NOT NULL,
              cost REAL,
              notes TEXT,
              receipt_reference TEXT,
              cook_id TEXT,
              location_id TEXT DEFAULT 'default',
              created_at TEXT DEFAULT (datetime('now')),
              FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE
            );
            CREATE TABLE equipment_parts (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              equipment_id INTEGER NOT NULL,
              part_number TEXT NOT NULL,
              description TEXT,
              vendor TEXT,
              unit_price REAL,
              qty_on_hand REAL,
              last_ordered TEXT,
              last_order_ref TEXT,
              notes TEXT,
              location_id TEXT DEFAULT 'default',
              created_at TEXT DEFAULT (datetime('now')),
              FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE
            );
            CREATE TABLE equipment_maintenance_schedule (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              equipment_id INTEGER NOT NULL,
              task TEXT NOT NULL,
              frequency TEXT NOT NULL,
              last_done TEXT,
              next_due TEXT,
              notes TEXT,
              location_id TEXT DEFAULT 'default',
              created_at TEXT DEFAULT (datetime('now')),
              FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE
            );
            CREATE TABLE audit_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              entity TEXT NOT NULL, entity_id INTEGER, action TEXT NOT NULL,
              actor_cook_id TEXT, actor_source TEXT NOT NULL, replaces_id INTEGER,
              payload_json TEXT, note TEXT, shift_date TEXT, location_id TEXT,
              created_at TEXT DEFAULT (datetime('now'))
            );
            """)
    }
    return path
}
