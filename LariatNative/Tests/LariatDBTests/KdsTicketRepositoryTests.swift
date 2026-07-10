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

    // ── Bump-back (port of tests/js/test-kds-bump-route.mjs) ────────────────

    /// Happy path: all fields → 1 state row, hashed PIN (fixed vector), insert audit.
    func testFirstBumpAllFieldsInsertAudit() throws {
        let (readDB, writeDB, auditPath, dbPath) = try makeRepos()
        defer { cleanup(dbPath: dbPath, auditPath: auditPath) }
        try seedTicket(writeDB, id: "tkt_abc")
        let repo = KdsTicketRepository(readDB: readDB, writeDB: writeDB, auditLogger: ManagementAuditLogger(auditPath: auditPath))

        let bumpedAt = "2026-05-04T18:42:11.000Z"
        let result = try repo.bump(
            ticketId: "tkt_abc",
            input: KdsBumpInput(bumpedAt: bumpedAt, station: "grill", cookPin: "1234"),
            context: .nativeCook(cookId: nil)
        )
        // canonical response shape { id, bumped_at }
        XCTAssertEqual(result, KdsBumpResult(id: "tkt_abc", bumpedAt: bumpedAt))

        try writeDB.pool.read { db in
            let cnt = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM kds_ticket_states WHERE ticket_id='tkt_abc'") ?? 0
            XCTAssertEqual(cnt, 1)
            let at = try String.fetchOne(db, sql: "SELECT bumped_at FROM kds_ticket_states WHERE ticket_id='tkt_abc'")
            XCTAssertEqual(at, bumpedAt)
            let station = try String.fetchOne(db, sql: "SELECT bumped_station FROM kds_ticket_states WHERE ticket_id='tkt_abc'")
            XCTAssertEqual(station, "grill")
            // PIN hashed with salted PBKDF2 (audit 2026-07-10 P0-3), never raw
            // or unsalted SHA-256; the stored value verifies against the PIN.
            let hash = try String.fetchOne(db, sql: "SELECT bumped_pin_hash FROM kds_ticket_states WHERE ticket_id='tkt_abc'")!
            XCTAssertNotEqual(hash, "1234")
            XCTAssertFalse(PinHash.isLegacyHash(hash))
            XCTAssertTrue(PinHash.verify("1234", hash))
            // one insert audit for the state entity
            let auditCnt = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='kds_ticket_state' AND action='insert'") ?? 0
            XCTAssertEqual(auditCnt, 1)
            let src = try String.fetchOne(db, sql: "SELECT actor_source FROM audit_events WHERE entity='kds_ticket_state'")
            XCTAssertEqual(src, "kds_app")
        }
    }

    /// Empty body → server-stamps a canonical bumped_at; station + pin NULL.
    func testEmptyBodyServerStamp() throws {
        let (readDB, writeDB, auditPath, dbPath) = try makeRepos()
        defer { cleanup(dbPath: dbPath, auditPath: auditPath) }
        try seedTicket(writeDB, id: "tkt_empty")
        let repo = KdsTicketRepository(readDB: readDB, writeDB: writeDB, auditLogger: ManagementAuditLogger(auditPath: auditPath))

        let before = KdsBumpRules.nowIsoCanonical()
        let result = try repo.bump(ticketId: "tkt_empty", input: KdsBumpInput(), context: .nativeCook(cookId: nil))
        let after = KdsBumpRules.nowIsoCanonical()

        XCTAssertEqual(result.id, "tkt_empty")
        // server-stamped time is canonical and falls between the bookends (lexicographic ISO order)
        XCTAssertTrue(KdsBumpRules.isIso8601Utc(result.bumpedAt))
        XCTAssertTrue(result.bumpedAt >= before && result.bumpedAt <= after,
                      "bumped_at \(result.bumpedAt) should be between \(before) and \(after)")
        try writeDB.pool.read { db in
            let station = try String.fetchOne(db, sql: "SELECT bumped_station FROM kds_ticket_states WHERE ticket_id='tkt_empty'")
            XCTAssertNil(station)
            let hash = try String.fetchOne(db, sql: "SELECT bumped_pin_hash FROM kds_ticket_states WHERE ticket_id='tkt_empty'")
            XCTAssertNil(hash)
        }
    }

    /// Unknown-but-well-formed station slug is accepted (forward compat, protocol §2).
    func testUnknownStationSlugAccepted() throws {
        let (readDB, writeDB, auditPath, dbPath) = try makeRepos()
        defer { cleanup(dbPath: dbPath, auditPath: auditPath) }
        try seedTicket(writeDB, id: "tkt_expo")
        let repo = KdsTicketRepository(readDB: readDB, writeDB: writeDB, auditLogger: ManagementAuditLogger(auditPath: auditPath))

        _ = try repo.bump(ticketId: "tkt_expo", input: KdsBumpInput(station: "expo"), context: .nativeCook(cookId: nil))
        try writeDB.pool.read { db in
            let station = try String.fetchOne(db, sql: "SELECT bumped_station FROM kds_ticket_states WHERE ticket_id='tkt_expo'")
            XCTAssertEqual(station, "expo")
        }
    }

    /// Re-bump: kept-latest bumped_at, still one row, insert then correction audit.
    func testFirstBumpThenRebumpAuditAndKeptLatest() throws {
        let (readDB, writeDB, auditPath, dbPath) = try makeRepos()
        defer { cleanup(dbPath: dbPath, auditPath: auditPath) }
        try seedTicket(writeDB, id: "T1")
        let repo = KdsTicketRepository(readDB: readDB, writeDB: writeDB, auditLogger: ManagementAuditLogger(auditPath: auditPath))

        let first = try repo.bump(ticketId: "T1", input: KdsBumpInput(bumpedAt: "2026-05-04T18:42:11.000Z", station: "grill", cookPin: "1234"), context: .nativeCook(cookId: nil))
        XCTAssertEqual(first.bumpedAt, "2026-05-04T18:42:11.000Z")
        let second = try repo.bump(ticketId: "T1", input: KdsBumpInput(bumpedAt: "2026-05-04T18:45:00.000Z", station: "sides"), context: .nativeCook(cookId: nil))
        XCTAssertEqual(second.bumpedAt, "2026-05-04T18:45:00.000Z")

        try writeDB.pool.read { db in
            // one state row, kept-latest
            let cnt = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM kds_ticket_states WHERE ticket_id='T1'") ?? 0
            XCTAssertEqual(cnt, 1)
            let at = try String.fetchOne(db, sql: "SELECT bumped_at FROM kds_ticket_states WHERE ticket_id='T1'")
            XCTAssertEqual(at, "2026-05-04T18:45:00.000Z")
            // insert + correction audits, in order
            let actions = try String.fetchAll(db, sql: "SELECT action FROM audit_events WHERE entity='kds_ticket_state' ORDER BY id")
            XCTAssertEqual(actions, ["insert", "correction"])
            // pin-less re-bump overwrites the prior hash with NULL (excluded.bumped_pin_hash)
            let hash = try String.fetchOne(db, sql: "SELECT bumped_pin_hash FROM kds_ticket_states WHERE ticket_id='T1'")
            XCTAssertNil(hash)
        }
    }

    /// Correction audit payload carries prior_bumped_at + the new bumped_at.
    func testCorrectionPayloadCarriesPriorBumpedAt() throws {
        let (readDB, writeDB, auditPath, dbPath) = try makeRepos()
        defer { cleanup(dbPath: dbPath, auditPath: auditPath) }
        try seedTicket(writeDB, id: "tkt_pay")
        let repo = KdsTicketRepository(readDB: readDB, writeDB: writeDB, auditLogger: ManagementAuditLogger(auditPath: auditPath))

        let t1 = "2026-05-04T18:00:00.000Z"
        let t2 = "2026-05-04T18:05:00.000Z"
        _ = try repo.bump(ticketId: "tkt_pay", input: KdsBumpInput(bumpedAt: t1), context: .nativeCook(cookId: nil))
        _ = try repo.bump(ticketId: "tkt_pay", input: KdsBumpInput(bumpedAt: t2), context: .nativeCook(cookId: nil))

        try writeDB.pool.read { db in
            let payloadJson = try String.fetchOne(db, sql: """
                SELECT payload_json FROM audit_events
                 WHERE entity='kds_ticket_state' AND action='correction'
                 ORDER BY id DESC LIMIT 1
                """)
            let payload = try JSONSerialization.jsonObject(with: Data(XCTUnwrap(payloadJson).utf8)) as? [String: Any]
            XCTAssertEqual(payload?["prior_bumped_at"] as? String, t1)
            XCTAssertEqual(payload?["bumped_at"] as? String, t2)
        }
    }

    /// 404: ticket id not known to Lariat → no state row, no audit row.
    func testBumpUnknownTicket404() throws {
        let (readDB, writeDB, auditPath, dbPath) = try makeRepos()
        defer { cleanup(dbPath: dbPath, auditPath: auditPath) }
        let repo = KdsTicketRepository(readDB: readDB, writeDB: writeDB, auditLogger: ManagementAuditLogger(auditPath: auditPath))

        XCTAssertThrowsError(try repo.bump(ticketId: "tkt_missing", input: KdsBumpInput(bumpedAt: "2026-05-04T18:42:11.000Z"), context: .nativeCook(cookId: nil))) { err in
            XCTAssertEqual(err as? KdsWriteError, .bumpTicketNotFound)
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM kds_ticket_states") ?? -1, 0)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='kds_ticket_state'") ?? -1, 0)
        }
    }

    /// 400-equivalent: a blank ticket id is rejected before any DB work.
    func testBlankTicketIdRejected() throws {
        let (readDB, writeDB, auditPath, dbPath) = try makeRepos()
        defer { cleanup(dbPath: dbPath, auditPath: auditPath) }
        let repo = KdsTicketRepository(readDB: readDB, writeDB: writeDB, auditLogger: ManagementAuditLogger(auditPath: auditPath))
        XCTAssertThrowsError(try repo.bump(ticketId: "   ", input: KdsBumpInput(), context: .nativeCook(cookId: nil))) { err in
            XCTAssertEqual(err as? KdsWriteError, .ticketIdRequired)
        }
    }

    /// Web `parseTicketId` REJECTS (400) an over-length id rather than truncating.
    /// Pin reject-don't-coerce: a 201-char id throws even when its 200-char prefix
    /// IS a real ticket — the prefix ticket must NOT be bumped by a truncated match.
    func testOverLengthTicketIdRejectedNotTruncated() throws {
        let (readDB, writeDB, auditPath, dbPath) = try makeRepos()
        defer { cleanup(dbPath: dbPath, auditPath: auditPath) }
        let prefix = String(repeating: "a", count: 200)   // a real ticket id (at the limit)
        try seedTicket(writeDB, id: prefix)
        let repo = KdsTicketRepository(readDB: readDB, writeDB: writeDB, auditLogger: ManagementAuditLogger(auditPath: auditPath))

        // 201 chars whose 200-char prefix collides with the seeded ticket → must reject.
        XCTAssertThrowsError(try repo.bump(ticketId: prefix + "b", input: KdsBumpInput(), context: .nativeCook(cookId: nil))) { err in
            XCTAssertEqual(err as? KdsWriteError, .ticketIdRequired)
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM kds_ticket_states") ?? -1, 0,
                           "over-length bump must not truncate-and-match the prefix ticket")
        }
        // Boundary: exactly 200 chars is accepted (matches web's `> 200` reject).
        let ok = try repo.bump(ticketId: prefix, input: KdsBumpInput(), context: .nativeCook(cookId: nil))
        XCTAssertEqual(ok.id, prefix)
    }

    /// 422-equivalent: non-canonical ISO-8601 bumped_at → validationFailed, no write.
    func testNonCanonicalIsoRejected() throws {
        let (readDB, writeDB, auditPath, dbPath) = try makeRepos()
        defer { cleanup(dbPath: dbPath, auditPath: auditPath) }
        try seedTicket(writeDB, id: "tkt_bad")
        let repo = KdsTicketRepository(readDB: readDB, writeDB: writeDB, auditLogger: ManagementAuditLogger(auditPath: auditPath))
        XCTAssertThrowsError(try repo.bump(ticketId: "tkt_bad", input: KdsBumpInput(bumpedAt: "2026-05-04 18:42:11"), context: .nativeCook(cookId: nil))) { err in
            guard case KdsWriteError.validationFailed(let msg)? = err as? KdsWriteError else {
                return XCTFail("expected validationFailed")
            }
            XCTAssertTrue(msg.contains("bumped_at"))
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM kds_ticket_states") ?? -1, 0)
        }
    }

    /// 422-equivalent: mixed-case station → validationFailed, no write.
    func testMixedCaseStationRejected() throws {
        let (readDB, writeDB, auditPath, dbPath) = try makeRepos()
        defer { cleanup(dbPath: dbPath, auditPath: auditPath) }
        try seedTicket(writeDB, id: "tkt_case")
        let repo = KdsTicketRepository(readDB: readDB, writeDB: writeDB, auditLogger: ManagementAuditLogger(auditPath: auditPath))
        XCTAssertThrowsError(try repo.bump(ticketId: "tkt_case", input: KdsBumpInput(station: "Grill"), context: .nativeCook(cookId: nil))) { err in
            guard case KdsWriteError.validationFailed(let msg)? = err as? KdsWriteError else {
                return XCTFail("expected validationFailed")
            }
            XCTAssertTrue(msg.contains("station"))
        }
    }

    /// Atomicity: exactly one state row + one audit row land in the same commit.
    func testBumpAuditAndStateCommittedTogether() throws {
        let (readDB, writeDB, auditPath, dbPath) = try makeRepos()
        defer { cleanup(dbPath: dbPath, auditPath: auditPath) }
        try seedTicket(writeDB, id: "tkt_tx")
        let repo = KdsTicketRepository(readDB: readDB, writeDB: writeDB, auditLogger: ManagementAuditLogger(auditPath: auditPath))

        _ = try repo.bump(ticketId: "tkt_tx", input: KdsBumpInput(bumpedAt: "2026-05-04T18:42:11.000Z"), context: .nativeCook(cookId: nil))
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity='kds_ticket_state'") ?? -1, 1)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM kds_ticket_states WHERE ticket_id='tkt_tx'") ?? -1, 1)
        }
    }

    /// Location scoping: a ticket under 'default' is 404 when bumped under another location.
    func testBumpLocationScoped404() throws {
        let (readDB, writeDB, auditPath, dbPath) = try makeRepos()
        defer { cleanup(dbPath: dbPath, auditPath: auditPath) }
        try seedTicket(writeDB, id: "tkt_loc", location: "default")
        let repo = KdsTicketRepository(readDB: readDB, writeDB: writeDB, auditLogger: ManagementAuditLogger(auditPath: auditPath))
        let otherLoc = RegulatedWriteContext.nativeCook(cookId: nil, locationId: "loc_other")
        XCTAssertThrowsError(try repo.bump(ticketId: "tkt_loc", input: KdsBumpInput(), context: otherLoc)) { err in
            XCTAssertEqual(err as? KdsWriteError, .bumpTicketNotFound)
        }
    }

    /// Latent web behavior carry-forward (do NOT fix): bump writes only
    /// kds_ticket_states and never sets kds_tickets.bumped_at, so loadOpen
    /// (WHERE bumped_at IS NULL) still returns the ticket after a bump.
    func testBumpDoesNotRemoveTicketFromOpenBoard() async throws {
        let (readDB, writeDB, auditPath, dbPath) = try makeRepos()
        defer { cleanup(dbPath: dbPath, auditPath: auditPath) }
        let repo = KdsTicketRepository(readDB: readDB, writeDB: writeDB, auditLogger: ManagementAuditLogger(auditPath: auditPath))
        _ = try repo.punch(
            input: KdsPunchInput(
                orderNumber: "9",
                lines: [KdsPunchLineInput(itemName: "Wings", quantity: 1, station: "grill")],
                cookId: "al"
            ),
            context: .nativeCook(cookId: "al")
        )
        let before = try await repo.loadOpen()
        XCTAssertEqual(before.tickets.count, 1)
        let ticketId = before.tickets[0].id
        XCTAssertNil(before.tickets[0].bumpedAt, "unbumped ticket must carry no bump state")

        let result = try repo.bump(ticketId: ticketId, input: KdsBumpInput(station: "grill"), context: .nativeCook(cookId: "al"))

        // Web parity: the bumped ticket STAYS on the open board — but the
        // board surfaces the state row's bumped_at so the UI can show it.
        let after = try await repo.loadOpen()
        XCTAssertEqual(after.tickets.count, 1)
        XCTAssertEqual(after.tickets[0].id, ticketId)
        XCTAssertEqual(after.tickets[0].bumpedAt, result.bumpedAt)
    }

    /// Bump state is location-scoped: a same-id state row under another
    /// location must not leak onto this location's open board.
    func testLoadOpenBumpStateIsLocationScoped() async throws {
        let (readDB, writeDB, auditPath, dbPath) = try makeRepos()
        defer { cleanup(dbPath: dbPath, auditPath: auditPath) }
        try seedTicket(writeDB, id: "tkt_scope", location: "default")
        try writeDB.write { db in
            try db.execute(
                sql: """
                  INSERT INTO kds_ticket_states (ticket_id, location_id, bumped_at)
                  VALUES ('tkt_scope', 'loc_other', '2026-05-04T19:00:00.000Z')
                  """
            )
        }
        let repo = KdsTicketRepository(readDB: readDB, writeDB: writeDB, auditLogger: ManagementAuditLogger(auditPath: auditPath))
        let snap = try await repo.loadOpen(locationId: "default")
        XCTAssertEqual(snap.tickets.count, 1)
        XCTAssertNil(snap.tickets[0].bumpedAt, "another location's bump state must not surface here")
    }

    private func seedTicket(_ writeDB: LariatWriteDatabase, id: String, location: String = "default") throws {
        try writeDB.write { db in
            try db.execute(
                sql: "INSERT INTO kds_tickets (id, location_id, order_number, placed_at) VALUES (?, ?, '1042', '2026-05-04T18:40:00.000Z')",
                arguments: [id, location]
            )
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
                CREATE TABLE kds_ticket_states (
                  ticket_id TEXT NOT NULL,
                  location_id TEXT NOT NULL DEFAULT 'default',
                  bumped_at TEXT NOT NULL,
                  bumped_station TEXT,
                  bumped_pin_hash TEXT,
                  created_at TEXT NOT NULL DEFAULT (datetime('now')),
                  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                  PRIMARY KEY (ticket_id, location_id)
                );
                CREATE TABLE audit_events (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  entity TEXT NOT NULL,
                  entity_id INTEGER,
                  action TEXT NOT NULL,
                  actor_cook_id TEXT,
                  actor_source TEXT NOT NULL,
                  replaces_id INTEGER,
                  payload_json TEXT,
                  note TEXT,
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
