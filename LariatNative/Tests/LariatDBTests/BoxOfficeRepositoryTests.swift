import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

// Behavior-parity ports of `tests/js/test-box-office-repo.mjs` (sources,
// transactional DB audit, scan scoping, completeness) and
// `tests/js/test-box-office-dice-idempotency.mjs` (the money-critical DICE
// retry contract). Cash custody is regulated → every write asserts against
// `audit_events` directly. `actor_source` is `native_mac` (web uses
// `box_office`/`dice_ingest` — established native divergence).
final class BoxOfficeRepositoryTests: XCTestCase {

    private let day = "2026-06-01"

    private func makeFixture() throws -> (ShowsFixture, BoxOfficeRepository) {
        let fx = try ShowsFixture.make()
        try fx.insertShow(id: 1, band: "Test Band", date: "2026-05-01", sourceRow: 1)
        try fx.insertShow(id: 2, locationId: "satellite", band: "Test Band 2", date: "2026-05-02", sourceRow: 2)
        let repo = BoxOfficeRepository(readDB: fx.readDB, writeDB: fx.writeDB, locationId: "default")
        return (fx, repo)
    }

    private func context(actor: String? = "door_anna") -> RegulatedWriteContext {
        RegulatedWriteContext(
            actorCookId: actor,
            actorSource: RegulatedWriteContext.nativeMacActorSource,
            locationId: "default",
            shiftDate: day
        )
    }

    private func satelliteRepo(_ fx: ShowsFixture) -> BoxOfficeRepository {
        BoxOfficeRepository(readDB: fx.readDB, writeDB: fx.writeDB, locationId: "satellite")
    }

    private func auditRows(_ fx: ShowsFixture, entityId: Int64? = nil) throws -> [Row] {
        try fx.writeDB.pool.read { db in
            if let entityId {
                return try Row.fetchAll(
                    db,
                    sql: "SELECT * FROM audit_events WHERE entity = 'box_office_lines' AND entity_id = ? ORDER BY id ASC",
                    arguments: [entityId]
                )
            }
            return try Row.fetchAll(
                db,
                sql: "SELECT * FROM audit_events WHERE entity = 'box_office_lines' ORDER BY id ASC"
            )
        }
    }

    private func count(_ fx: ShowsFixture, _ sql: String) throws -> Int {
        try fx.writeDB.pool.read { db in try Int.fetchOne(db, sql: sql) ?? -1 }
    }

    // ── createLine — sources ───────────────────────────────────────────

    func testAcceptsEveryValidSource() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        for source in ["dice", "walkup", "comp", "will_call", "guestlist"] {
            let line = try repo.createLine(
                .init(showId: 1, source: source, qty: 1, facePrice: 25),
                context: context()
            )
            XCTAssertEqual(line.source, source)
            XCTAssertEqual(line.qty, 1)
        }
    }

    func testRejectsUnknownSourceAtValidator() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        XCTAssertThrowsError(try repo.createLine(
            .init(showId: 1, source: "free", qty: 1), context: context()
        )) { err in
            XCTAssertTrue("\(err.localizedDescription)".contains("invalid source"))
        }
    }

    func testRejectsNonPositiveQty() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        XCTAssertThrowsError(try repo.createLine(
            .init(showId: 1, source: "walkup", qty: 0), context: context()
        )) { err in
            XCTAssertTrue("\(err.localizedDescription)".contains("qty"))
        }
    }

    func testInsertWritesDbAuditRow() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        let line = try repo.createLine(
            .init(showId: 1, source: "walkup", qty: 2, facePrice: 30),
            context: context(actor: "door_anna")
        )
        let events = try auditRows(fx, entityId: line.id)
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0]["action"] as String, "insert")
        XCTAssertEqual(events[0]["actor_cook_id"] as String?, "door_anna")
        XCTAssertEqual(events[0]["actor_source"] as String, "native_mac")
        let payload = try XCTUnwrap(
            try JSONSerialization.jsonObject(
                with: Data((events[0]["payload_json"] as String).utf8)
            ) as? [String: Any]
        )
        XCTAssertEqual(payload["qty"] as? Int, 2)
        XCTAssertEqual(payload["source"] as? String, "walkup")
    }

    // ── transactional audit (rollback pins) ────────────────────────────

    func testCreateRollsBackWhenAuditInsertFails() throws {
        // Web pin: drop audit_events → the source INSERT must roll back.
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        let ddl = try fx.writeDB.pool.read { db in
            try String.fetchOne(
                db, sql: "SELECT sql FROM sqlite_master WHERE type='table' AND name='audit_events'"
            )
        }
        try fx.seed { db in try db.execute(sql: "DROP TABLE audit_events") }
        defer { try? fx.seed { db in try db.execute(sql: ddl!) } }

        XCTAssertThrowsError(try repo.createLine(
            .init(showId: 1, source: "walkup", qty: 3, facePrice: 25),
            context: context()
        ))
        XCTAssertEqual(
            try count(fx, "SELECT COUNT(*) FROM box_office_lines WHERE show_id = 1"), 0,
            "audit failure must roll back the source insert"
        )
    }

    func testMarkScannedRollsBackWhenAuditFails() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        let line = try repo.createLine(
            .init(showId: 1, source: "dice", qty: 1, facePrice: 30, externalRef: "DICE-ROLLBACK-1"),
            context: context()
        )
        let ddl = try fx.writeDB.pool.read { db in
            try String.fetchOne(
                db, sql: "SELECT sql FROM sqlite_master WHERE type='table' AND name='audit_events'"
            )
        }
        try fx.seed { db in try db.execute(sql: "DROP TABLE audit_events") }
        defer { try? fx.seed { db in try db.execute(sql: ddl!) } }

        XCTAssertThrowsError(try repo.markScanned(showId: 1, lineId: line.id, context: context()))
        let scanned = try fx.writeDB.pool.read { db in
            try String.fetchOne(
                db, sql: "SELECT scanned_at FROM box_office_lines WHERE id = ?", arguments: [line.id]
            )
        }
        XCTAssertNil(scanned, "audit failure must roll back the scan UPDATE")
    }

    func testSchemaCheckOnSourceRejectsBypass() throws {
        // Second line of defence: the DB CHECK fires if a future code path
        // skips the validator.
        let (fx, _) = try makeFixture()
        defer { fx.cleanup() }
        XCTAssertThrowsError(try fx.seed { db in
            try db.execute(sql: """
                INSERT INTO box_office_lines (show_id, location_id, source, qty)
                VALUES (1, 'default', 'free', 1)
                """)
        })
    }

    // ── listLines ──────────────────────────────────────────────────────

    func testListNewestFirst() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        try repo.createLine(.init(showId: 1, source: "walkup", qty: 1, facePrice: 25), context: context())
        try repo.createLine(.init(showId: 1, source: "comp", qty: 1, facePrice: 0), context: context())
        let list = try await repo.listLines(showId: 1)
        XCTAssertEqual(list.count, 2)
        XCTAssertEqual(list[0].source, "comp")
        XCTAssertEqual(list[1].source, "walkup")
    }

    func testListRespectsLocationScoping() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        try repo.createLine(.init(showId: 1, source: "walkup", qty: 1, facePrice: 25), context: context())
        try satelliteRepo(fx).createLine(
            .init(showId: 2, source: "walkup", qty: 1, facePrice: 25),
            context: RegulatedWriteContext(actorCookId: nil, actorSource: "native_mac",
                                           locationId: "satellite", shiftDate: day)
        )
        let a = try await repo.listLines(showId: 1)
        let b = try await satelliteRepo(fx).listLines(showId: 2)
        let c = try await satelliteRepo(fx).listLines(showId: 1)
        XCTAssertEqual(a.count, 1)
        XCTAssertEqual(b.count, 1)
        XCTAssertEqual(c.count, 0)
    }

    // ── summarize (DB variant) ─────────────────────────────────────────

    func testSummarizeAggregatesQtyRevenueFeesBySource() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        try repo.createLine(.init(showId: 1, source: "dice", qty: 50, facePrice: 30, fees: 4), context: context())
        try repo.createLine(.init(showId: 1, source: "walkup", qty: 10, facePrice: 35, fees: 0), context: context())
        try repo.createLine(.init(showId: 1, source: "comp", qty: 4, facePrice: 0), context: context())
        let s = try await repo.summarize(showId: 1)
        XCTAssertEqual(s.totalQty, 64)
        XCTAssertEqual(s.totalRevenue, Double(50 * 30 + 10 * 35))
        XCTAssertEqual(s.totalFees, 4)
        XCTAssertEqual(s.bySource[.dice]?.qty, 50)
        XCTAssertEqual(s.bySource[.walkup]?.qty, 10)
        XCTAssertEqual(s.bySource[.comp]?.qty, 4)
        XCTAssertEqual(s.scannedQty, 0)
        XCTAssertEqual(s.unscannedQty, 64)
    }

    // ── markScanned ────────────────────────────────────────────────────

    func testMarkScannedSetsTimestampAndWritesUpdateAudit() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        let line = try repo.createLine(
            .init(showId: 1, source: "dice", qty: 1, facePrice: 30, externalRef: "DICE-7777"),
            context: context()
        )
        let scanned = try repo.markScanned(showId: 1, lineId: line.id, context: context())
        XCTAssertNotNil(scanned)
        XCTAssertNotNil(scanned?.scannedAt)
        let events = try auditRows(fx, entityId: line.id)
        XCTAssertEqual(events.count, 2)
        XCTAssertEqual(events[1]["action"] as String, "update")
        let payload = try XCTUnwrap(
            try JSONSerialization.jsonObject(
                with: Data((events[1]["payload_json"] as String).utf8)
            ) as? [String: Any]
        )
        XCTAssertEqual(payload["op"] as? String, "mark_scanned")
        XCTAssertEqual(payload["external_ref"] as? String, "DICE-7777")
    }

    func testMarkScannedNilWhenAlreadyScannedNoSecondAudit() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        let line = try repo.createLine(
            .init(showId: 1, source: "walkup", qty: 1, facePrice: 25), context: context()
        )
        XCTAssertNotNil(try repo.markScanned(showId: 1, lineId: line.id, context: context()))
        let second = try repo.markScanned(showId: 1, lineId: line.id, context: context())
        XCTAssertNil(second)
        XCTAssertEqual(try auditRows(fx, entityId: line.id).count, 2)  // insert + first scan only
    }

    func testMarkScannedNilOnLocationMismatch() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        let line = try repo.createLine(
            .init(showId: 1, source: "walkup", qty: 1, facePrice: 25), context: context()
        )
        let cross = try satelliteRepo(fx).markScanned(
            showId: 1, lineId: line.id,
            context: RegulatedWriteContext(actorCookId: nil, actorSource: "native_mac",
                                           locationId: "satellite", shiftDate: day)
        )
        XCTAssertNil(cross)
        let scanned = try fx.writeDB.pool.read { db in
            try String.fetchOne(db, sql: "SELECT scanned_at FROM box_office_lines WHERE id = ?", arguments: [line.id])
        }
        XCTAssertNil(scanned)
    }

    func testMarkScannedNilOnShowIdMismatch() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        let line = try repo.createLine(
            .init(showId: 1, source: "walkup", qty: 1, facePrice: 25), context: context()
        )
        XCTAssertNil(try repo.markScanned(showId: 2, lineId: line.id, context: context()))
        let scanned = try fx.writeDB.pool.read { db in
            try String.fetchOne(db, sql: "SELECT scanned_at FROM box_office_lines WHERE id = ?", arguments: [line.id])
        }
        XCTAssertNil(scanned)
    }

    func testMarkScannedRejectsNonPositiveIds() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        XCTAssertThrowsError(try repo.markScanned(showId: 1, lineId: 0, context: context())) { err in
            XCTAssertTrue("\(err.localizedDescription)".contains("line_id"))
        }
        XCTAssertThrowsError(try repo.markScanned(showId: 0, lineId: 1, context: context())) { err in
            XCTAssertTrue("\(err.localizedDescription)".contains("show_id"))
        }
    }

    // ── completeness ───────────────────────────────────────────────────

    func testCompletenessScoresZeroWithNoLines() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        let s = try await repo.summarize(showId: 1)
        XCTAssertEqual(BoxOfficeCompleteness.from(summary: s).score, 0)
    }

    func testCompletenessFullWithDicePlusWalkup() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        try repo.createLine(.init(showId: 1, source: "dice", qty: 50, facePrice: 30), context: context())
        try repo.createLine(.init(showId: 1, source: "walkup", qty: 5, facePrice: 35), context: context())
        let c = BoxOfficeCompleteness.from(summary: try await repo.summarize(showId: 1))
        XCTAssertEqual(c.score, 1)
        XCTAssertTrue(c.hasDiceLines)
        XCTAssertTrue(c.hasWalkupLines)
    }

    // ── DICE bulk upsert — idempotency contract ────────────────────────

    private var batchA: [DiceLineInput] {
        [
            DiceLineInput(showId: 1, externalRef: "DICE-1001", ticketClass: "GA", qty: 1, facePrice: 25.0, fees: 4.5),
            DiceLineInput(showId: 1, externalRef: "DICE-1002", ticketClass: "VIP", qty: 2, facePrice: 75.0, fees: 10.0),
            DiceLineInput(showId: 1, externalRef: "DICE-1003", ticketClass: "GA", qty: 1, facePrice: 25.0, fees: 4.5),
        ]
    }

    func testDiceFirstCallInsertsNRowsAndNAudits() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        let result = try repo.bulkUpsertFromDice(batchA, context: context(actor: nil))
        XCTAssertEqual(result, DiceBulkUpsertResult(inserted: 3, updated: 0))
        XCTAssertEqual(try count(fx, "SELECT COUNT(*) FROM box_office_lines"), 3)
        XCTAssertEqual(try auditRows(fx).count, 3)
    }

    func testDiceSecondIdenticalCallWritesNeitherRowsNorAudit() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        try repo.bulkUpsertFromDice(batchA, context: context(actor: nil))
        let auditBefore = try auditRows(fx).count
        let result = try repo.bulkUpsertFromDice(batchA, context: context(actor: nil))
        XCTAssertEqual(result, DiceBulkUpsertResult(inserted: 0, updated: 0))
        XCTAssertEqual(try count(fx, "SELECT COUNT(*) FROM box_office_lines"), 3, "no duplicate rows on retry")
        XCTAssertEqual(try auditRows(fx).count, auditBefore, "no audit churn on a no-op retry")
    }

    func testDiceThreeRetriesStillThreeRows() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        try repo.bulkUpsertFromDice(batchA, context: context(actor: nil))
        try repo.bulkUpsertFromDice(batchA, context: context(actor: nil))
        try repo.bulkUpsertFromDice(batchA, context: context(actor: nil))
        XCTAssertEqual(try count(fx, "SELECT COUNT(*) FROM box_office_lines"), 3)
    }

    func testDiceRevisionUpdatesNotInserts() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        try repo.bulkUpsertFromDice(batchA, context: context(actor: nil))
        let auditBefore = try auditRows(fx).count

        var revised = batchA
        revised[0] = DiceLineInput(showId: 1, externalRef: "DICE-1001", ticketClass: "GA",
                                   qty: 1, facePrice: 30.0, fees: 4.5)   // upgraded ticket
        let result = try repo.bulkUpsertFromDice(revised, context: context(actor: nil))
        XCTAssertEqual(result, DiceBulkUpsertResult(inserted: 0, updated: 1))
        XCTAssertEqual(try count(fx, "SELECT COUNT(*) FROM box_office_lines"), 3, "UPDATE must NOT add a new row")

        let face = try fx.writeDB.pool.read { db in
            try Double.fetchOne(
                db, sql: "SELECT face_price FROM box_office_lines WHERE external_ref = ?",
                arguments: ["DICE-1001"]
            )
        }
        XCTAssertEqual(face, 30.0)

        let events = try auditRows(fx)
        XCTAssertEqual(events.count, auditBefore + 1, "one audit row for the one revised line")
        let last = events.last!
        XCTAssertEqual(last["action"] as String, "update")
        let payload = try XCTUnwrap(
            try JSONSerialization.jsonObject(
                with: Data((last["payload_json"] as String).utf8)
            ) as? [String: Any]
        )
        XCTAssertEqual(payload["op"] as? String, "dice_revision")
        XCTAssertEqual((payload["before"] as? [String: Any])?["face_price"] as? Double, 25.0)
        XCTAssertEqual((payload["after"] as? [String: Any])?["face_price"] as? Double, 30.0)
    }

    func testMultipleWalkupLinesWithNullExternalRefAllInsert() throws {
        // Partial UNIQUE is `WHERE external_ref IS NOT NULL` — NULL refs
        // must never collide.
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        for _ in 0..<3 {
            try repo.createLine(
                .init(showId: 1, source: "walkup", qty: 1, facePrice: 25.0, fees: 0, externalRef: nil),
                context: context()
            )
        }
        XCTAssertEqual(
            try count(fx, "SELECT COUNT(*) FROM box_office_lines WHERE source = 'walkup'"), 3
        )
    }

    func testSameExternalRefUnderDifferentSourceDoesNotCollide() throws {
        // Constraint keys (source, external_ref), not external_ref alone.
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        try repo.bulkUpsertFromDice([batchA[0]], context: context(actor: nil))
        try repo.createLine(
            .init(showId: 1, source: "walkup", qty: 1, facePrice: 25.0, fees: 0, externalRef: "DICE-1001"),
            context: context()
        )
        XCTAssertEqual(try count(fx, "SELECT COUNT(*) FROM box_office_lines"), 2)
    }

    func testTwoDistinctDiceRefsBothInsert() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        try repo.bulkUpsertFromDice([batchA[0], batchA[1]], context: context(actor: nil))
        XCTAssertEqual(try count(fx, "SELECT COUNT(*) FROM box_office_lines"), 2)
    }

    func testDiceValidationThrowsOnMissingRefAndBadQty() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        XCTAssertThrowsError(try repo.bulkUpsertFromDice(
            [DiceLineInput(showId: 1, externalRef: "", qty: 1)], context: context(actor: nil)
        )) { err in
            XCTAssertTrue("\(err.localizedDescription)".contains("external_ref must be a non-empty string"))
        }
        XCTAssertEqual(try count(fx, "SELECT COUNT(*) FROM box_office_lines"), 0)
        XCTAssertThrowsError(try repo.bulkUpsertFromDice(
            [DiceLineInput(showId: 1, externalRef: "DICE-1", qty: 0)], context: context(actor: nil)
        )) { err in
            XCTAssertTrue("\(err.localizedDescription)".contains("qty must be a positive integer"))
        }
    }
}
