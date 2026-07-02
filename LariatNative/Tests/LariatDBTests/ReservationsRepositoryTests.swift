import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Ports every oracle case in `tests/js/test-reservations-api.mjs`
/// (POST/GET/PATCH/DELETE of /api/reservations + the reservation ×
/// dining_tables wiring), plus the page's 'upcoming' view query (authored
/// against `app/reservations/page.jsx`).
final class ReservationsRepositoryTests: XCTestCase {

    // ── POST /api/reservations ───────────────────────────────────────────

    func testCreateWritesRowAndInsertAudit() throws {
        let h = try Harness()
        defer { h.cleanup() }

        let id = try h.createRes(partyName: "Garcia", partySize: 6)
        try h.writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM reservations WHERE id=?", arguments: [id])
            XCTAssertNotNil(row)
            XCTAssertEqual(row?["party_name"], "Garcia")
            XCTAssertEqual(row?["party_size"], 6)
            XCTAssertEqual(row?["status"], "booked")
            XCTAssertEqual(row?["source"], "manual")

            let a = try Row.fetchOne(
                db,
                sql: "SELECT * FROM audit_events WHERE entity='reservations' AND entity_id=? AND action='insert'",
                arguments: [id]
            )
            XCTAssertNotNil(a, "expected insert audit event")
            let payload = try h.payloadJSON(a)
            XCTAssertEqual(payload["party_name"] as? String, "Garcia")
            XCTAssertEqual(payload["party_size"] as? Int, 6)
        }
    }

    func testCreateRejectsEmptyPartyName() throws {
        let h = try Harness()
        defer { h.cleanup() }

        for name in ["", "   "] {
            XCTAssertThrowsError(
                try h.repo.create(
                    input: ReservationCreateInput(partyName: name, partySize: 2, reservationAt: "2026-04-25 19:00"),
                    context: h.ctx()
                )
            ) { XCTAssertEqual($0 as? ReservationWriteError, .partyNameRequired) }
        }
    }

    func testCreateRejectsPartySizeZeroAndFiftyOne() throws {
        let h = try Harness()
        defer { h.cleanup() }

        for size in [0, 51] {
            XCTAssertThrowsError(
                try h.repo.create(
                    input: ReservationCreateInput(partyName: "X", partySize: size, reservationAt: "2026-04-25 19:00"),
                    context: h.ctx()
                )
            ) { XCTAssertEqual($0 as? ReservationWriteError, .partySizeOutOfRange) }
        }
    }

    func testCreateRejectsMissingReservationAt() throws {
        let h = try Harness()
        defer { h.cleanup() }

        XCTAssertThrowsError(
            try h.repo.create(
                input: ReservationCreateInput(partyName: "X", partySize: 2, reservationAt: nil),
                context: h.ctx()
            )
        ) { XCTAssertEqual($0 as? ReservationWriteError, .reservationAtRequired) }
    }

    // ── GET /api/reservations ────────────────────────────────────────────

    func testListFiltersByDatePrefix() async throws {
        let h = try Harness()
        defer { h.cleanup() }

        _ = try h.createRes(partyName: "A", at: "2026-04-24 18:00")
        _ = try h.createRes(partyName: "B", at: "2026-04-25 18:00")
        _ = try h.createRes(partyName: "C", at: "2026-04-25 20:30")

        let rows = try await h.repo.list(filter: ReservationListFilter(date: "2026-04-25"), locationId: "default")
        XCTAssertEqual(rows.map(\.partyName), ["B", "C"])
    }

    func testListFiltersByStatus() async throws {
        let h = try Harness()
        defer { h.cleanup() }

        let idA = try h.createRes(partyName: "A")
        _ = try h.createRes(partyName: "B")
        try h.repo.update(id: idA, patch: ReservationPatch(cancel: true), context: h.ctx())

        let rows = try await h.repo.list(filter: ReservationListFilter(status: "cancelled"), locationId: "default")
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows.first?.partyName, "A")
    }

    func testListOrdersByReservationAtThenId() async throws {
        let h = try Harness()
        defer { h.cleanup() }

        let id1 = try h.createRes(partyName: "late", at: "2026-04-25 21:00")
        let id2 = try h.createRes(partyName: "early-a", at: "2026-04-25 18:00")
        let id3 = try h.createRes(partyName: "early-b", at: "2026-04-25 18:00")

        let rows = try await h.repo.list(filter: ReservationListFilter(date: "2026-04-25"), locationId: "default")
        XCTAssertEqual(rows.map(\.id), [id2, id3, id1])
    }

    func testListScopesByLocation() async throws {
        let h = try Harness()
        defer { h.cleanup() }

        _ = try h.createRes(partyName: "kA", locationId: "kitchen-a")
        _ = try h.createRes(partyName: "kB", locationId: "kitchen-b")

        let a = try await h.repo.list(locationId: "kitchen-a")
        XCTAssertEqual(a.map(\.partyName), ["kA"])
        let b = try await h.repo.list(locationId: "kitchen-b")
        XCTAssertEqual(b.map(\.partyName), ["kB"])
    }

    /// Authored against app/reservations/page.jsx 'upcoming' view: from
    /// today on, open statuses only.
    func testUpcomingViewExcludesClosedStatuses() async throws {
        let h = try Harness()
        defer { h.cleanup() }

        _ = try h.createRes(partyName: "past", at: "2026-04-20 18:00")
        _ = try h.createRes(partyName: "open-today", at: "2026-04-25 18:00")
        _ = try h.createRes(partyName: "open-later", at: "2026-04-28 18:00")
        let cancelled = try h.createRes(partyName: "cancelled-later", at: "2026-04-29 18:00")
        try h.repo.update(id: cancelled, patch: ReservationPatch(cancel: true), context: h.ctx())

        let rows = try await h.repo.upcoming(from: "2026-04-25", locationId: "default")
        XCTAssertEqual(rows.map(\.partyName), ["open-today", "open-later"])
    }

    // ── PATCH /api/reservations/:id ──────────────────────────────────────

    func testSeatSetsStatusSeatedAtAndTableId() throws {
        let h = try Harness()
        defer { h.cleanup() }

        let id = try h.createRes()
        try h.repo.update(id: id, patch: ReservationPatch(seat: true, tableId: "T7"), context: h.ctx())

        try h.writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM reservations WHERE id=?", arguments: [id])
            XCTAssertEqual(row?["status"], "seated")
            XCTAssertNotNil(row?["seated_at"] as String?, "seated_at should be set")
            XCTAssertEqual(row?["table_id"], "T7")
        }
    }

    func testCompleteSetsCompletedAtAndAuditsFromTo() throws {
        let h = try Harness()
        defer { h.cleanup() }

        let id = try h.createRes()
        try h.repo.update(id: id, patch: ReservationPatch(seat: true), context: h.ctx())
        try h.repo.update(id: id, patch: ReservationPatch(complete: true), context: h.ctx())

        try h.writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM reservations WHERE id=?", arguments: [id])
            XCTAssertEqual(row?["status"], "completed")
            XCTAssertNotNil(row?["completed_at"] as String?)

            let a = try Row.fetchOne(
                db,
                sql: """
                  SELECT * FROM audit_events
                   WHERE entity='reservations' AND entity_id=? AND action='update'
                   ORDER BY id DESC LIMIT 1
                  """,
                arguments: [id]
            )
            let payload = try h.payloadJSON(a)
            XCTAssertEqual(payload["from_status"] as? String, "seated")
            XCTAssertEqual(payload["to_status"] as? String, "completed")
            XCTAssertEqual(payload["verb"] as? String, "complete")
        }
    }

    func testCancelSetsStatusCancelled() throws {
        let h = try Harness()
        defer { h.cleanup() }

        let id = try h.createRes()
        try h.repo.update(id: id, patch: ReservationPatch(cancel: true), context: h.ctx())
        try h.writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM reservations WHERE id=?", arguments: [id])
            XCTAssertEqual(row?["status"], "cancelled")
            XCTAssertNotNil(row?["completed_at"] as String?)
        }
    }

    func testNoShowSetsStatusNoShow() throws {
        let h = try Harness()
        defer { h.cleanup() }

        let id = try h.createRes()
        try h.repo.update(id: id, patch: ReservationPatch(noShow: true), context: h.ctx())
        try h.writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM reservations WHERE id=?", arguments: [id])
            XCTAssertEqual(row?["status"], "no_show")
            XCTAssertNotNil(row?["completed_at"] as String?)
        }
    }

    func testPlainFieldEditAuditsAndStatusUnchanged() throws {
        let h = try Harness()
        defer { h.cleanup() }

        let id = try h.createRes(partySize: 4)
        try h.repo.update(id: id, patch: ReservationPatch(partySize: 6), context: h.ctx())
        try h.writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM reservations WHERE id=?", arguments: [id])
            XCTAssertEqual(row?["party_size"], 6)
            XCTAssertEqual(row?["status"], "booked")
            let a = try Row.fetchOne(
                db,
                sql: """
                  SELECT * FROM audit_events
                   WHERE entity='reservations' AND entity_id=? AND action='update'
                   ORDER BY id DESC LIMIT 1
                  """,
                arguments: [id]
            )
            let payload = try h.payloadJSON(a)
            XCTAssertEqual(payload["from_status"] as? String, "booked")
            XCTAssertEqual(payload["to_status"] as? String, "booked")
            XCTAssertNil(payload["verb"], "no verb on a plain field edit")
        }
    }

    func testNoChangeThrows() throws {
        let h = try Harness()
        defer { h.cleanup() }

        let id = try h.createRes()
        XCTAssertThrowsError(
            try h.repo.update(id: id, patch: ReservationPatch(cookId: "alice"), context: h.ctx())
        ) { XCTAssertEqual($0 as? ReservationWriteError, .noChange) }
    }

    func testUpdateOtherLocationThrowsNotFound() throws {
        let h = try Harness()
        defer { h.cleanup() }

        let id = try h.createRes(locationId: "kitchen-a")
        XCTAssertThrowsError(
            try h.repo.update(id: id, patch: ReservationPatch(complete: true), context: h.ctx(locationId: "kitchen-b"))
        ) { XCTAssertEqual($0 as? ReservationWriteError, .notFound) }
    }

    func testMultipleVerbsThrows() throws {
        let h = try Harness()
        defer { h.cleanup() }

        let id = try h.createRes()
        XCTAssertThrowsError(
            try h.repo.update(id: id, patch: ReservationPatch(seat: true, complete: true), context: h.ctx())
        ) { XCTAssertEqual($0 as? ReservationWriteError, .multipleVerbs) }
    }

    func testSeatWithSideFieldEditCoexists() throws {
        let h = try Harness()
        defer { h.cleanup() }

        let id = try h.createRes()
        try h.repo.update(
            id: id,
            patch: ReservationPatch(seat: true, tableId: "T3", notes: "window seat"),
            context: h.ctx()
        )
        try h.writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM reservations WHERE id=?", arguments: [id])
            XCTAssertEqual(row?["status"], "seated")
            XCTAssertEqual(row?["table_id"], "T3")
            XCTAssertEqual(row?["notes"], "window seat")
        }
    }

    // ── PATCH × dining_tables wiring ─────────────────────────────────────

    func testSeatPropagatesLinkedTableOpenToSeated() throws {
        let h = try Harness()
        defer { h.cleanup() }

        try h.createTable(id: "T1")
        let id = try h.createRes(tableId: "T1")
        XCTAssertEqual(try h.tableStatus("T1"), "open")

        try h.repo.update(id: id, patch: ReservationPatch(seat: true), context: h.ctx())
        XCTAssertEqual(try h.tableStatus("T1"), "seated")

        try h.writeDB.pool.read { db in
            let a = try Row.fetchOne(
                db,
                sql: """
                  SELECT * FROM audit_events
                   WHERE entity='dining_tables' AND action='update'
                   ORDER BY id DESC LIMIT 1
                  """
            )
            XCTAssertNotNil(a, "expected table-side audit event")
            let payload = try h.payloadJSON(a)
            XCTAssertEqual(payload["id"] as? String, "T1")
            XCTAssertEqual(payload["from_status"] as? String, "open")
            XCTAssertEqual(payload["to_status"] as? String, "seated")
            XCTAssertEqual(payload["triggered_by"] as? String, "reservation_seat")
        }
    }

    func testSeatWithNewTableIdOnlySeatsTheNewTable() throws {
        let h = try Harness()
        defer { h.cleanup() }

        try h.createTable(id: "T1")
        try h.createTable(id: "T2")
        let id = try h.createRes(tableId: "T1")

        try h.repo.update(id: id, patch: ReservationPatch(seat: true, tableId: "T2"), context: h.ctx())

        try h.writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM reservations WHERE id=?", arguments: [id])
            XCTAssertEqual(row?["table_id"], "T2")
            XCTAssertEqual(row?["status"], "seated")
        }
        XCTAssertEqual(try h.tableStatus("T1"), "open", "original T1 untouched")
        XCTAssertEqual(try h.tableStatus("T2"), "seated", "new T2 is now seated")
    }

    func testCompleteMovesLinkedTableToDirty() throws {
        let h = try Harness()
        defer { h.cleanup() }

        try h.createTable(id: "T1")
        let id = try h.createRes(tableId: "T1")
        try h.repo.update(id: id, patch: ReservationPatch(seat: true), context: h.ctx())
        XCTAssertEqual(try h.tableStatus("T1"), "seated")

        try h.repo.update(id: id, patch: ReservationPatch(complete: true), context: h.ctx())
        XCTAssertEqual(try h.tableStatus("T1"), "dirty")

        try h.writeDB.pool.read { db in
            let a = try Row.fetchOne(
                db,
                sql: """
                  SELECT * FROM audit_events
                   WHERE entity='dining_tables' AND action='update'
                   ORDER BY id DESC LIMIT 1
                  """
            )
            let payload = try h.payloadJSON(a)
            XCTAssertEqual(payload["from_status"] as? String, "seated")
            XCTAssertEqual(payload["to_status"] as? String, "dirty")
            XCTAssertEqual(payload["triggered_by"] as? String, "reservation_complete")
        }
    }

    func testCancelOnSeatedReservationReleasesTableToOpen() throws {
        let h = try Harness()
        defer { h.cleanup() }

        try h.createTable(id: "T1")
        let id = try h.createRes(tableId: "T1")
        try h.repo.update(id: id, patch: ReservationPatch(seat: true), context: h.ctx())
        XCTAssertEqual(try h.tableStatus("T1"), "seated")

        try h.repo.update(id: id, patch: ReservationPatch(cancel: true), context: h.ctx())
        XCTAssertEqual(try h.tableStatus("T1"), "open")

        try h.writeDB.pool.read { db in
            let a = try Row.fetchOne(
                db,
                sql: """
                  SELECT * FROM audit_events
                   WHERE entity='dining_tables' AND action='update'
                   ORDER BY id DESC LIMIT 1
                  """
            )
            let payload = try h.payloadJSON(a)
            XCTAssertEqual(payload["from_status"] as? String, "seated")
            XCTAssertEqual(payload["to_status"] as? String, "open")
            XCTAssertEqual(payload["triggered_by"] as? String, "reservation_cancel")
        }
    }

    func testNoShowOnSeatedReservationDoesNotTouchTable() throws {
        let h = try Harness()
        defer { h.cleanup() }

        try h.createTable(id: "T1")
        let id = try h.createRes(tableId: "T1")
        try h.repo.update(id: id, patch: ReservationPatch(seat: true), context: h.ctx())
        XCTAssertEqual(try h.tableStatus("T1"), "seated")

        let before = try h.tableAuditCount()
        try h.repo.update(id: id, patch: ReservationPatch(noShow: true), context: h.ctx())
        XCTAssertEqual(try h.tableStatus("T1"), "seated", "table state unchanged")
        XCTAssertEqual(try h.tableAuditCount(), before, "no new table-side audit event")
    }

    func testCancelOnBookedReservationDoesNotTouchTable() throws {
        let h = try Harness()
        defer { h.cleanup() }

        try h.createTable(id: "T1")
        let id = try h.createRes(tableId: "T1")
        XCTAssertEqual(try h.tableStatus("T1"), "open")

        let before = try h.tableAuditCount()
        try h.repo.update(id: id, patch: ReservationPatch(cancel: true), context: h.ctx())
        XCTAssertEqual(try h.tableStatus("T1"), "open", "table was never taken; no release needed")
        XCTAssertEqual(try h.tableAuditCount(), before)
    }

    func testSeatWithStaleTableIdStillUpdatesReservation() throws {
        let h = try Harness()
        defer { h.cleanup() }

        let id = try h.createRes() // no dining_tables row at all
        try h.repo.update(id: id, patch: ReservationPatch(seat: true, tableId: "GHOST"), context: h.ctx())

        try h.writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM reservations WHERE id=?", arguments: [id])
            XCTAssertEqual(row?["status"], "seated")
            XCTAssertEqual(row?["table_id"], "GHOST")
        }
        XCTAssertEqual(try h.tableAuditCount(), 0, "no table-side audit — no row to mutate")
    }

    // ── DELETE /api/reservations/:id ─────────────────────────────────────

    func testDeleteRemovesRowAndWritesDeleteAudit() throws {
        let h = try Harness()
        defer { h.cleanup() }

        let id = try h.createRes()
        try h.repo.delete(id: id, context: h.ctx())
        try h.writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM reservations WHERE id=?", arguments: [id])
            XCTAssertNil(row)
            let a = try Row.fetchOne(
                db,
                sql: "SELECT * FROM audit_events WHERE entity='reservations' AND entity_id=? AND action='delete'",
                arguments: [id]
            )
            XCTAssertNotNil(a)
        }
    }

    func testDeleteMissingRowThrowsNotFound() throws {
        let h = try Harness()
        defer { h.cleanup() }

        XCTAssertThrowsError(
            try h.repo.delete(id: 99999, context: h.ctx())
        ) { XCTAssertEqual($0 as? ReservationWriteError, .notFound) }
    }

    // ── harness ──────────────────────────────────────────────────────────

    private struct Harness {
        let repo: ReservationsRepository
        let tables: DiningTablesRepository
        let writeDB: LariatWriteDatabase
        let path: String

        init() throws {
            path = try seedFloorDatabase() // same web-schema fixture as the floor board
            let readDB = try LariatDatabase(path: path)
            writeDB = try LariatWriteDatabase(path: path)
            repo = ReservationsRepository(readDB: readDB, writeDB: writeDB)
            tables = DiningTablesRepository(readDB: readDB, writeDB: writeDB)
        }

        func ctx(locationId: String = "default") -> RegulatedWriteContext {
            RegulatedWriteContext.nativeCook(cookId: "alice", locationId: locationId)
        }

        @discardableResult
        func createRes(
            partyName: String = "Smith",
            partySize: Int = 4,
            at: String = "2026-04-25 18:30",
            tableId: String? = nil,
            locationId: String = "default"
        ) throws -> Int64 {
            try repo.create(
                input: ReservationCreateInput(
                    partyName: partyName, partySize: partySize, reservationAt: at,
                    tableId: tableId, cookId: "alice"
                ),
                context: ctx(locationId: locationId)
            )
        }

        func createTable(id: String) throws {
            _ = try tables.create(
                input: DiningTableCreateInput(id: id, name: "Window 1", capacity: 4, cookId: "alice"),
                context: ctx()
            )
        }

        func tableStatus(_ id: String, locationId: String = "default") throws -> String? {
            try writeDB.pool.read { db in
                try String.fetchOne(
                    db,
                    sql: "SELECT status FROM dining_tables WHERE id=? AND location_id=?",
                    arguments: [id, locationId]
                )
            }
        }

        func tableAuditCount() throws -> Int {
            try writeDB.pool.read { db in
                try Int.fetchOne(
                    db,
                    sql: "SELECT COUNT(*) FROM audit_events WHERE entity='dining_tables' AND action='update'"
                ) ?? 0
            }
        }

        func payloadJSON(_ row: Row?) throws -> [String: Any] {
            let raw: String = row?["payload_json"] ?? "{}"
            let obj = try JSONSerialization.jsonObject(with: Data(raw.utf8))
            return obj as? [String: Any] ?? [:]
        }

        func cleanup() {
            let dir = (path as NSString).deletingLastPathComponent
            try? FileManager.default.removeItem(atPath: dir)
        }
    }
}
