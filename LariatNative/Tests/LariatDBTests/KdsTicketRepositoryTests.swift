import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

final class KdsTicketRepositoryTests: XCTestCase {
    func testPunchInsertsTicketLinesAndJsonlAudit() throws {
        let (readDB, writeDB, auditPath, dbPath) = try makeRepos()
        defer { cleanup(dbPath: dbPath, auditPath: auditPath) }

        let logger = ManagementAuditLogger(auditPath: auditPath)
        let repo = KdsTicketRepository(readDB: readDB, writeDB: writeDB, auditLogger: logger)
        let context = RegulatedWriteContext.nativeCook(cookId: "alice")

        let ticket = try repo.punch(
            input: KdsPunchInput(
                orderNumber: "42",
                destination: "dine-in",
                lines: [
                    KdsPunchLineInput(itemName: "Burger", quantity: 2, station: "Grill", modifiers: "no onion"),
                ],
                cookId: "alice"
            ),
            context: context
        )
        XCTAssertEqual(ticket.orderNumber, "42")
        XCTAssertEqual(ticket.lines.count, 1)
        XCTAssertEqual(ticket.lines.first?.station, "grill")

        let audit = try String(contentsOfFile: auditPath, encoding: .utf8)
        XCTAssertTrue(audit.contains("kds_tickets.create"))
        XCTAssertTrue(audit.contains(ticket.id))

        try writeDB.pool.read { db in
            let auditCount = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? 0
            XCTAssertEqual(auditCount, 0)
        }
    }

    func testLoadOpenGroupsLines() async throws {
        let (readDB, writeDB, auditPath, dbPath) = try makeRepos()
        defer { cleanup(dbPath: dbPath, auditPath: auditPath) }

        let repo = KdsTicketRepository(readDB: readDB, writeDB: writeDB, auditLogger: ManagementAuditLogger(auditPath: auditPath))
        let context = RegulatedWriteContext.nativeCook(cookId: "bob")
        _ = try repo.punch(
            input: KdsPunchInput(
                orderNumber: "7",
                lines: [KdsPunchLineInput(itemName: "Fries", quantity: 1, station: "sides")],
                cookId: "bob"
            ),
            context: context
        )

        let snap = try await repo.loadOpen()
        XCTAssertEqual(snap.tickets.count, 1)
        XCTAssertEqual(snap.tickets.first?.lines.first?.itemName, "Fries")
    }

    func testEmptyOrderNumberRejected() throws {
        let (readDB, writeDB, auditPath, dbPath) = try makeRepos()
        defer { cleanup(dbPath: dbPath, auditPath: auditPath) }

        let repo = KdsTicketRepository(readDB: readDB, writeDB: writeDB, auditLogger: ManagementAuditLogger(auditPath: auditPath))
        XCTAssertThrowsError(
            try repo.punch(
                input: KdsPunchInput(orderNumber: "  ", lines: [KdsPunchLineInput(itemName: "X", quantity: 1, station: "bar")]),
                context: RegulatedWriteContext.nativeCook(cookId: "alice")
            )
        ) { error in
            XCTAssertEqual(error as? KdsWriteError, .orderNumberRequired)
        }
    }

    private func makeRepos() throws -> (LariatDatabase, LariatWriteDatabase, String, String) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("lariat-kds-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let dbPath = dir.appendingPathComponent("lariat.db").path
        let auditPath = dir.appendingPathComponent("audit.jsonl").path

        let pool = try DatabaseQueue(path: dbPath)
        try pool.write { db in
            try db.execute(sql: """
                CREATE TABLE kds_tickets (
                  id TEXT PRIMARY KEY,
                  location_id TEXT NOT NULL DEFAULT 'default',
                  order_number TEXT NOT NULL,
                  placed_at TEXT NOT NULL,
                  destination TEXT,
                  bumped_at TEXT,
                  created_by_cook_id TEXT,
                  created_at TEXT DEFAULT (datetime('now'))
                );
                CREATE TABLE kds_ticket_lines (
                  id TEXT PRIMARY KEY,
                  ticket_id TEXT NOT NULL,
                  sort_order INTEGER NOT NULL DEFAULT 0,
                  item_name TEXT NOT NULL,
                  quantity INTEGER NOT NULL,
                  station TEXT NOT NULL,
                  modifiers TEXT
                );
                CREATE TABLE audit_events (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  entity TEXT NOT NULL,
                  entity_id INTEGER,
                  action TEXT NOT NULL,
                  actor_cook_id TEXT,
                  actor_source TEXT NOT NULL,
                  payload_json TEXT,
                  shift_date TEXT,
                  location_id TEXT,
                  created_at TEXT DEFAULT (datetime('now'))
                );
                """)
        }
        return (try LariatDatabase(path: dbPath), try LariatWriteDatabase(path: dbPath), auditPath, dbPath)
    }

    private func cleanup(dbPath: String, auditPath: String) {
        let dir = (dbPath as NSString).deletingLastPathComponent
        try? FileManager.default.removeItem(atPath: dir)
    }
}
