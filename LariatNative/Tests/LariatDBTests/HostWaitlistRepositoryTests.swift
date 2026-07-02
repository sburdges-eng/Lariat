import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Ports the non-transport oracle cases in `tests/js/test-host-waitlist-api.mjs`
/// (GET/POST /api/host/waitlist + PATCH /api/host/waitlist/[id]). The web
/// 401-without-PIN cases are enforced natively at the view-model layer
/// (`ManagementWrite.requireSession` + `PinEntrySheet`, VendorLink
/// precedent) — there is no app-target test harness, so they are not
/// duplicated here. The file-stream audit posture (JSONL, NO audit_events)
/// IS pinned here.
final class HostWaitlistRepositoryTests: XCTestCase {

    // ── GET ──────────────────────────────────────────────────────────────

    func testEmptyPartiesAndZeroedSummary() async throws {
        let h = try Harness()
        defer { h.cleanup() }

        let snap = try await h.repo.load(locationId: "default")
        XCTAssertEqual(snap.parties, [])
        XCTAssertEqual(snap.summary.waiting, 0)
    }

    /// Authored against the GET query: waiting always shows; seated/left
    /// only when stamped today; other locations excluded.
    func testLoadFiltersToActiveAndTodayRows() async throws {
        let h = try Harness()
        defer { h.cleanup() }

        let now = HostWaitlistRepository.nowIso()
        let today = String(now.prefix(10))
        try await h.writeDB.pool.write { db in
            try db.execute(
                sql: """
                  INSERT INTO waitlist_parties (location_id, party_name, party_size, status, seated_at, left_at) VALUES
                    ('default', 'Waiting',      2, 'waiting', NULL, NULL),
                    ('default', 'SeatedToday',  2, 'seated', ?, NULL),
                    ('default', 'SeatedOld',    2, 'seated', '2020-01-01T18:00:00.000Z', NULL),
                    ('default', 'LeftToday',    2, 'left', NULL, ?),
                    ('default', 'LeftOld',      2, 'left', NULL, '2020-01-01T18:00:00.000Z'),
                    ('elsewhere', 'OtherLoc',   2, 'waiting', NULL, NULL);
                  """,
                arguments: ["\(today)T12:00:00.000Z", "\(today)T12:30:00.000Z"]
            )
        }

        let snap = try await h.repo.load(locationId: "default", nowIso: now)
        XCTAssertEqual(
            Set(snap.parties.map(\.partyName)),
            ["Waiting", "SeatedToday", "LeftToday"]
        )
        XCTAssertEqual(snap.summary.waiting, 1)
        XCTAssertEqual(snap.summary.seatedToday, 1)
        XCTAssertEqual(snap.summary.leftToday, 1)
    }

    // ── POST ─────────────────────────────────────────────────────────────

    func testAddRejectsMissingPartyName() throws {
        let h = try Harness()
        defer { h.cleanup() }

        XCTAssertThrowsError(
            try h.repo.addParty(input: WaitlistAddInput(partyName: nil, partySize: 2), locationId: "default")
        ) { XCTAssertEqual($0 as? WaitlistWriteError, .invalidInput) }
    }

    func testAddRejectsNonPositivePartySize() throws {
        let h = try Harness()
        defer { h.cleanup() }

        XCTAssertThrowsError(
            try h.repo.addParty(input: WaitlistAddInput(partyName: "X", partySize: 0), locationId: "default")
        ) { XCTAssertEqual($0 as? WaitlistWriteError, .invalidInput) }
    }

    func testAddInsertsPartyAndReturnsRow() throws {
        let h = try Harness()
        defer { h.cleanup() }

        let party = try h.repo.addParty(
            input: WaitlistAddInput(partyName: "Hendricks", partySize: 4, phone: "555-1212"),
            locationId: "default"
        )
        XCTAssertEqual(party.partyName, "Hendricks")
        XCTAssertEqual(party.partySize, 4)
        XCTAssertEqual(party.phone, "555-1212")
        XCTAssertEqual(party.status, "waiting")
        XCTAssertGreaterThan(party.id, 0)
        XCTAssertFalse(party.joinedAt.isEmpty)
    }

    func testAddHonorsLocationId() throws {
        let h = try Harness()
        defer { h.cleanup() }

        _ = try h.repo.addParty(
            input: WaitlistAddInput(partyName: "Other Loc", partySize: 2),
            locationId: "other"
        )
        let count = try h.writeDB.pool.read { db in
            try Int.fetchOne(
                db, sql: "SELECT COUNT(*) FROM waitlist_parties WHERE location_id = 'other'"
            ) ?? 0
        }
        XCTAssertEqual(count, 1)
    }

    // ── PATCH ────────────────────────────────────────────────────────────

    func testTransitionUnknownIdThrowsNotFound() throws {
        let h = try Harness()
        defer { h.cleanup() }

        XCTAssertThrowsError(
            try h.repo.transition(id: 9999, to: "seated")
        ) { XCTAssertEqual($0 as? WaitlistWriteError, .notFound) }
    }

    func testTransitionRejectsBadStatus() throws {
        let h = try Harness()
        defer { h.cleanup() }

        let id = try h.addParty()
        XCTAssertThrowsError(
            try h.repo.transition(id: id, to: "arrived")
        ) { XCTAssertEqual($0 as? WaitlistWriteError, .badStatus) }
    }

    func testTransitionToSeatedStampsSeatedAt() throws {
        let h = try Harness()
        defer { h.cleanup() }

        let id = try h.addParty(name: "Big Party", size: 6)
        let party = try h.repo.transition(id: id, to: "seated")
        XCTAssertEqual(party.status, "seated")
        XCTAssertNotNil(party.seatedAt)
    }

    func testTransitionToLeftStampsLeftAt() throws {
        let h = try Harness()
        defer { h.cleanup() }

        let id = try h.addParty()
        let party = try h.repo.transition(id: id, to: "left")
        XCTAssertEqual(party.status, "left")
        XCTAssertNotNil(party.leftAt)
    }

    func testReTransitioningSeatedPartyThrows409() throws {
        let h = try Harness()
        defer { h.cleanup() }

        let id = try h.addParty()
        _ = try h.repo.transition(id: id, to: "seated")
        XCTAssertThrowsError(
            try h.repo.transition(id: id, to: "left")
        ) {
            XCTAssertEqual($0 as? WaitlistWriteError, .badTransition(from: "seated", to: "left"))
        }
    }

    // ── audit posture (web parity: JSONL file stream, NO audit_events) ───

    func testWritesLogJsonlAndNoAuditEventsRows() throws {
        let h = try Harness()
        defer { h.cleanup() }

        let id = try h.addParty(name: "Dabaja x4", size: 4)
        _ = try h.repo.transition(id: id, to: "seated")

        // JSONL: one waitlist_add + one waitlist_status_change line.
        let content = try String(contentsOfFile: h.auditPath, encoding: .utf8)
        let lines = content.split(separator: "\n").map(String.init)
        XCTAssertEqual(lines.count, 2)

        let add = try JSONSerialization.jsonObject(with: Data(lines[0].utf8)) as? [String: Any]
        XCTAssertEqual(add?["action"] as? String, "waitlist_add")
        XCTAssertEqual(add?["waitlist_party_id"] as? Int64, id)
        XCTAssertEqual(add?["location_id"] as? String, "default")
        XCTAssertEqual(add?["party_name"] as? String, "Dabaja x4")
        XCTAssertEqual(add?["party_size"] as? Int, 4)
        XCTAssertNotNil(add?["timestamp"])
        XCTAssertNotNil(add?["id"])

        let change = try JSONSerialization.jsonObject(with: Data(lines[1].utf8)) as? [String: Any]
        XCTAssertEqual(change?["action"] as? String, "waitlist_status_change")
        XCTAssertEqual(change?["from"] as? String, "waiting")
        XCTAssertEqual(change?["to"] as? String, "seated")

        // audit_events stays EMPTY — operational data, not the regulated stream.
        let auditRows = try h.writeDB.pool.read { db in
            try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? 0
        }
        XCTAssertEqual(auditRows, 0, "waitlist writes must NOT post audit_events (web parity)")
    }

    // ── harness ──────────────────────────────────────────────────────────

    private struct Harness {
        let repo: HostWaitlistRepository
        let writeDB: LariatWriteDatabase
        let auditPath: String
        let path: String

        init() throws {
            path = try seedWaitlistDatabase()
            let dir = (path as NSString).deletingLastPathComponent
            auditPath = (dir as NSString).appendingPathComponent("management-actions.jsonl")
            let readDB = try LariatDatabase(path: path)
            writeDB = try LariatWriteDatabase(path: path)
            repo = HostWaitlistRepository(
                readDB: readDB,
                writeDB: writeDB,
                auditLogger: FohAuditLogger(auditPath: auditPath)
            )
        }

        func addParty(name: String = "Test", size: Double = 2) throws -> Int64 {
            try repo.addParty(
                input: WaitlistAddInput(partyName: name, partySize: size),
                locationId: "default"
            ).id
        }

        func cleanup() {
            let dir = (path as NSString).deletingLastPathComponent
            try? FileManager.default.removeItem(atPath: dir)
        }
    }
}

/// Web schema (lib/db.ts) for waitlist_parties + an (expected-empty)
/// audit_events table to pin the file-stream-only audit posture.
private func seedWaitlistDatabase() throws -> String {
    let dir = NSTemporaryDirectory() + "lariat-waitlist-" + UUID().uuidString
    try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    let path = (dir as NSString).appendingPathComponent("lariat.db")
    let pool = try DatabasePool(path: path)
    try pool.write { db in
        try db.execute(sql: """
            CREATE TABLE waitlist_parties (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              location_id TEXT NOT NULL DEFAULT 'default',
              party_name TEXT NOT NULL,
              party_size INTEGER NOT NULL,
              joined_at TEXT NOT NULL DEFAULT (datetime('now')),
              status TEXT NOT NULL DEFAULT 'waiting'
                CHECK(status IN ('waiting','seated','left')),
              seated_at TEXT,
              left_at TEXT,
              phone TEXT,
              notes TEXT,
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE audit_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              location_id TEXT DEFAULT 'default',
              actor_cook_id TEXT,
              actor_source TEXT NOT NULL,
              entity TEXT NOT NULL,
              entity_id INTEGER,
              action TEXT NOT NULL,
              replaces_id INTEGER,
              payload_json TEXT,
              note TEXT,
              created_at TEXT DEFAULT (datetime('now'))
            );
            """)
    }
    return path
}
