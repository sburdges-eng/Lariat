import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Parity tests for `BeoBoardRepository` — the `/api/beo` action surface.
/// Oracles: tests/js/test-beo-worksheet.mjs (GET + all POST actions +
/// FK cascades), test-beo-update-event-partial-patch.mjs (partial patch +
/// min_spend), test-beo-line-location-scope.mjs (Bundle-H T4), plus the
/// behavioral subset of test-beo-get-many-events.mjs. Native divergences
/// asserted here: actor_source native_mac, audit rows in the SAME
/// transaction (web /api/beo posts audit rows too), NO idempotency layer.
final class BeoBoardRepositoryTests: XCTestCase {
    private var fixture: BeoFixture!
    private var repo: BeoBoardRepository!
    private let ctx = RegulatedWriteContext.nativeMac(pinUser: nil)

    override func setUpWithError() throws {
        fixture = try BeoFixture.make()
        repo = BeoBoardRepository(readDB: fixture.readDB, writeDB: fixture.writeDB)
    }

    override func tearDown() {
        fixture.cleanup()
        fixture = nil
        repo = nil
    }

    private func auditRow(entity: String, entityId: Int64, action: String) throws -> Row? {
        try fixture.row(
            "SELECT * FROM audit_events WHERE entity = ? AND entity_id = ? AND action = ?",
            [entity, entityId, action]
        )
    }

    // ── GET /api/beo ─────────────────────────────────────────────────────

    func testLoadReturnsEmptyArraysWhenUntouched() async throws {
        let snap = try await repo.load(locationId: "default")
        XCTAssertEqual(snap.locationId, "default")
        XCTAssertTrue(snap.events.isEmpty)
        XCTAssertTrue(snap.prepTasks.isEmpty)
        XCTAssertTrue(snap.lineItems.isEmpty)
    }

    func testLoadPopulatesLineItemsWhenAnEventHasThem() async throws {
        let eventId = try repo.createEvent(
            BeoEventInput(title: "Clauss party", eventDate: "2026-05-10"),
            locationId: "default", context: ctx)
        try repo.addLine(
            BeoLineInput(eventId: eventId, itemName: "Green Chile Enchiladas",
                         category: "Entree", unitCost: 14.5, quantity: 40),
            locationId: "default", context: ctx)

        let snap = try await repo.load(locationId: "default")
        XCTAssertEqual(snap.events.count, 1)
        XCTAssertEqual(snap.lineItems.count, 1)
        let li = snap.lineItems[0]
        XCTAssertEqual(li.eventId, eventId)
        XCTAssertEqual(li.itemName, "Green Chile Enchiladas")
        XCTAssertEqual(li.category, "Entree")
        XCTAssertEqual(li.unitCost, 14.5)
        XCTAssertEqual(li.quantity, 40)
    }

    func testLoadOrdersEventsByDateDescThenIdDesc() async throws {
        try fixture.seedEvent(title: "older", date: "2026-05-01")
        try fixture.seedEvent(title: "newest", date: "2026-06-01")
        try fixture.seedEvent(title: "same-day-later-id", date: "2026-05-01")
        let snap = try await repo.load(locationId: "default")
        XCTAssertEqual(snap.events.map(\.title), ["newest", "same-day-later-id", "older"])
    }

    func testLoadScopesByLocationIncludingChildLineItems() async throws {
        let mine = try fixture.seedEvent(title: "mine", location: "default")
        let theirs = try fixture.seedEvent(title: "theirs", location: "austin")
        try fixture.seedLineItem(eventId: mine, item: "Mine Item")
        try fixture.seedLineItem(eventId: theirs, item: "Theirs Item")

        let snap = try await repo.load(locationId: "default")
        XCTAssertEqual(snap.events.map(\.title), ["mine"])
        XCTAssertEqual(snap.lineItems.map(\.itemName), ["Mine Item"])
    }

    /// Behavioral subset of test-beo-get-many-events.mjs: 50 events with one
    /// line + one prep task each all come back, correctly associated.
    func testLoadAssociatesFiftyEvents() async throws {
        for i in 1...50 {
            let id = try fixture.seedEvent(title: "Event \(i)", date: "2026-07-01")
            try fixture.seedLineItem(eventId: id, item: "Item \(i)", qty: Double(i))
            try fixture.seed { db in
                try db.execute(
                    sql: "INSERT INTO beo_prep_tasks (event_id, task, location_id) VALUES (?, ?, 'default')",
                    arguments: [id, "Task \(i)"])
            }
        }
        let snap = try await repo.load(locationId: "default")
        XCTAssertEqual(snap.events.count, 50)
        XCTAssertEqual(snap.lineItems.count, 50)
        XCTAssertEqual(snap.prepTasks.count, 50)
        // Spot-check association integrity.
        for li in snap.lineItems {
            let owner = snap.events.first { $0.id == li.eventId }
            XCTAssertNotNil(owner, "line \(li.itemName) must belong to a returned event")
        }
    }

    // ── POST action='event' ──────────────────────────────────────────────

    func testCreateEventStoresInvoiceHeaderFields() throws {
        let id = try repo.createEvent(BeoEventInput(
            title: "Rehearsal dinner", eventDate: "2026-05-15", eventTime: "5-7pm",
            contactName: "Jane Doe", guestCount: 24, notes: "gluten-free bride",
            taxRate: 0.08, serviceFeePct: 22
        ), locationId: "default", context: ctx)

        let row = try XCTUnwrap(fixture.row("SELECT * FROM beo_events WHERE id = ?", [id]))
        XCTAssertEqual(row["title"], "Rehearsal dinner")
        XCTAssertEqual(row["event_date"], "2026-05-15")
        XCTAssertEqual(row["event_time"], "5-7pm")
        XCTAssertEqual(row["contact_name"], "Jane Doe")
        XCTAssertEqual(row["guest_count"], 24)
        XCTAssertEqual(row["notes"], "gluten-free bride")
        XCTAssertEqual(row["tax_rate"], 0.08)
        XCTAssertEqual(row["service_fee_pct"], 22.0)
        XCTAssertEqual(row["status"], "planned")
    }

    func testCreateEventAppliesDefaultRatesWhenOmitted() throws {
        let id = try repo.createEvent(
            BeoEventInput(title: "Default-rates party", eventDate: "2026-06-01"),
            locationId: "default", context: ctx)
        let row = try XCTUnwrap(fixture.row(
            "SELECT tax_rate, service_fee_pct FROM beo_events WHERE id = ?", [id]))
        XCTAssertEqual(row["tax_rate"], 0.0675)
        XCTAssertEqual(row["service_fee_pct"], 20.0)
    }

    func testCreateEventDefaultsDateToTodayAndStatusToPlanned() throws {
        let id = try repo.createEvent(BeoEventInput(title: "Bare"), locationId: "default", context: ctx)
        let row = try XCTUnwrap(fixture.row("SELECT event_date, status FROM beo_events WHERE id = ?", [id]))
        XCTAssertEqual(row["event_date"], ShiftDate.todayISO())
        XCTAssertEqual(row["status"], "planned")
    }

    func testCreateEventThrowsBadRequestWhenTitleMissing() {
        for input in [BeoEventInput(eventDate: "2026-06-01"), BeoEventInput(title: "   ")] {
            XCTAssertThrowsError(try repo.createEvent(input, locationId: "default", context: ctx)) { error in
                guard case BeoWriteError.badRequest(let msg) = error else {
                    return XCTFail("expected badRequest, got \(error)")
                }
                XCTAssertEqual(msg, "title required")
            }
        }
        XCTAssertEqual(try? fixture.count("SELECT COUNT(*) FROM beo_events"), 0)
    }

    func testCreateEventPersistsMinSpend() throws {
        let id = try repo.createEvent(
            BeoEventInput(title: "Gala Dinner", minSpend: 2500),
            locationId: "default", context: ctx)
        let row = try XCTUnwrap(fixture.row("SELECT min_spend FROM beo_events WHERE id = ?", [id]))
        XCTAssertEqual(row["min_spend"], 2500.0)
    }

    func testCreateEventRejectsNegativeMinSpend() {
        XCTAssertThrowsError(try repo.createEvent(
            BeoEventInput(title: "Bad Min", minSpend: -5), locationId: "default", context: ctx)
        ) { error in
            guard case BeoWriteError.badRequest(let msg) = error else {
                return XCTFail("expected badRequest, got \(error)")
            }
            XCTAssertEqual(msg, "min_spend must be a non-negative number")
        }
    }

    func testCreateEventWithoutMinSpendLeavesNull() throws {
        let id = try repo.createEvent(BeoEventInput(title: "No Min"), locationId: "default", context: ctx)
        let row = try XCTUnwrap(fixture.row("SELECT min_spend FROM beo_events WHERE id = ?", [id]))
        XCTAssertTrue(row["min_spend"] == nil)
    }

    func testCreateEventPostsAuditRowInSameTransaction() throws {
        let id = try repo.createEvent(BeoEventInput(title: "Audited"), locationId: "default", context: ctx)
        let audit = try XCTUnwrap(try auditRow(entity: "beo_events", entityId: id, action: "insert"))
        XCTAssertEqual(audit["actor_source"], "native_mac")
        XCTAssertEqual(audit["location_id"], "default")
        let payload: String = try XCTUnwrap(audit["payload_json"])
        XCTAssertTrue(payload.contains("\"title\""))
        XCTAssertTrue(payload.contains("tax_rate"))
        XCTAssertTrue(payload.contains("service_fee_pct"))
    }

    /// Divergence assertion: the web route wraps POST in withIdempotency;
    /// natively there is NO idempotency layer — a repeated call inserts again.
    func testCreateEventHasNoIdempotencyLayer() throws {
        _ = try repo.createEvent(BeoEventInput(title: "Twice"), locationId: "default", context: ctx)
        _ = try repo.createEvent(BeoEventInput(title: "Twice"), locationId: "default", context: ctx)
        XCTAssertEqual(try fixture.count("SELECT COUNT(*) FROM beo_events WHERE title = 'Twice'"), 2)
    }

    // ── POST action='update_event' ───────────────────────────────────────

    private func seedFullEvent() throws -> Int64 {
        try repo.createEvent(BeoEventInput(
            title: "Seeded party", eventDate: "2026-05-20", eventTime: "5-7pm",
            contactName: "Casey Original", guestCount: 40, notes: "seed notes",
            taxRate: 0.0675, serviceFeePct: 20
        ), locationId: "default", context: ctx)
    }

    func testUpdateEventUpdatesInvoiceHeaderFields() throws {
        let id = try repo.createEvent(
            BeoEventInput(title: "Before", eventDate: "2026-05-20"),
            locationId: "default", context: ctx)
        try repo.updateEvent(id: id, patch: BeoEventPatch(
            title: "After", eventDate: "2026-05-21", eventTime: "6pm",
            contactName: "Bob Clauss", guestCount: 12, notes: "two vegetarians",
            status: nil, taxRate: 0.09, serviceFeePct: 18
        ), locationId: "default", context: ctx)

        let row = try XCTUnwrap(fixture.row("SELECT * FROM beo_events WHERE id = ?", [id]))
        XCTAssertEqual(row["title"], "After")
        XCTAssertEqual(row["event_date"], "2026-05-21")
        XCTAssertEqual(row["event_time"], "6pm")
        XCTAssertEqual(row["contact_name"], "Bob Clauss")
        XCTAssertEqual(row["guest_count"], 12)
        XCTAssertEqual(row["notes"], "two vegetarians")
        XCTAssertEqual(row["tax_rate"], 0.09)
        XCTAssertEqual(row["service_fee_pct"], 18.0)
    }

    func testPatchingOnlyEventTimeLeavesAllOtherColumnsIntact() throws {
        let id = try seedFullEvent()
        let before = try XCTUnwrap(fixture.row("SELECT * FROM beo_events WHERE id = ?", [id]))

        try repo.updateEvent(id: id, patch: BeoEventPatch(eventTime: "7-10pm"),
                             locationId: "default", context: ctx)

        let after = try XCTUnwrap(fixture.row("SELECT * FROM beo_events WHERE id = ?", [id]))
        XCTAssertEqual(after["event_time"], "7-10pm")
        for col in ["title", "event_date", "contact_name", "guest_count", "notes",
                    "status", "tax_rate", "service_fee_pct"] {
            XCTAssertEqual(after[col] as DatabaseValue?, before[col] as DatabaseValue?, "\(col) must survive")
        }
    }

    func testPatchingOnlyTaxRateLeavesOtherColumnsIntact() throws {
        let id = try seedFullEvent()
        let before = try XCTUnwrap(fixture.row("SELECT * FROM beo_events WHERE id = ?", [id]))

        try repo.updateEvent(id: id, patch: BeoEventPatch(taxRate: 0.095),
                             locationId: "default", context: ctx)

        let after = try XCTUnwrap(fixture.row("SELECT * FROM beo_events WHERE id = ?", [id]))
        XCTAssertEqual(after["tax_rate"], 0.095)
        for col in ["event_time", "contact_name", "notes", "service_fee_pct", "guest_count"] {
            XCTAssertEqual(after[col] as DatabaseValue?, before[col] as DatabaseValue?, "\(col) must survive")
        }
    }

    func testPatchingOnlyContactNameLeavesNumericAndTimeColumnsIntact() throws {
        let id = try seedFullEvent()
        let before = try XCTUnwrap(fixture.row("SELECT * FROM beo_events WHERE id = ?", [id]))

        try repo.updateEvent(id: id, patch: BeoEventPatch(contactName: "Marie Wallace-Hodge"),
                             locationId: "default", context: ctx)

        let after = try XCTUnwrap(fixture.row("SELECT * FROM beo_events WHERE id = ?", [id]))
        XCTAssertEqual(after["contact_name"], "Marie Wallace-Hodge")
        for col in ["event_time", "event_date", "guest_count", "notes", "tax_rate", "service_fee_pct"] {
            XCTAssertEqual(after[col] as DatabaseValue?, before[col] as DatabaseValue?, "\(col) must survive")
        }
    }

    func testUpdatePatchesOnlyMinSpendPreservingOtherColumns() throws {
        let id = try seedFullEvent()
        let before = try XCTUnwrap(fixture.row("SELECT * FROM beo_events WHERE id = ?", [id]))
        try repo.updateEvent(id: id, patch: BeoEventPatch(minSpend: .set(1800)),
                             locationId: "default", context: ctx)
        let after = try XCTUnwrap(fixture.row("SELECT * FROM beo_events WHERE id = ?", [id]))
        XCTAssertEqual(after["min_spend"], 1800.0)
        for col in ["title", "tax_rate", "service_fee_pct", "event_time"] {
            XCTAssertEqual(after[col] as DatabaseValue?, before[col] as DatabaseValue?, "\(col) must survive")
        }
    }

    func testUpdatePreservesMinSpendWhenPatchOmitsIt() throws {
        let id = try seedFullEvent()
        try repo.updateEvent(id: id, patch: BeoEventPatch(minSpend: .set(1800)),
                             locationId: "default", context: ctx)
        try repo.updateEvent(id: id, patch: BeoEventPatch(eventTime: "6-9pm"),
                             locationId: "default", context: ctx)
        let row = try XCTUnwrap(fixture.row("SELECT min_spend, event_time FROM beo_events WHERE id = ?", [id]))
        XCTAssertEqual(row["min_spend"], 1800.0)
        XCTAssertEqual(row["event_time"], "6-9pm")
    }

    func testUpdateClearsMinSpendOnExplicitClear() throws {
        let id = try seedFullEvent()
        try repo.updateEvent(id: id, patch: BeoEventPatch(minSpend: .set(2000)),
                             locationId: "default", context: ctx)
        try repo.updateEvent(id: id, patch: BeoEventPatch(minSpend: .set(nil)),
                             locationId: "default", context: ctx)
        let row = try XCTUnwrap(fixture.row("SELECT min_spend FROM beo_events WHERE id = ?", [id]))
        XCTAssertTrue(row["min_spend"] == nil)
    }

    func testUpdateRejectsNegativeMinSpend() throws {
        let id = try seedFullEvent()
        XCTAssertThrowsError(try repo.updateEvent(
            id: id, patch: BeoEventPatch(minSpend: .set(-1)),
            locationId: "default", context: ctx)
        ) { error in
            guard case BeoWriteError.badRequest = error else {
                return XCTFail("expected badRequest, got \(error)")
            }
        }
    }

    func testUpdateEventIsScopedByLocation() throws {
        let id = try seedFullEvent()
        try repo.updateEvent(id: id, patch: BeoEventPatch(title: "HIJACKED"),
                             locationId: "austin", context: ctx)
        let row = try XCTUnwrap(fixture.row("SELECT title FROM beo_events WHERE id = ?", [id]))
        XCTAssertEqual(row["title"], "Seeded party")
    }

    func testUpdateEventPostsAuditRow() throws {
        let id = try seedFullEvent()
        try repo.updateEvent(id: id, patch: BeoEventPatch(title: "Renamed"),
                             locationId: "default", context: ctx)
        XCTAssertNotNil(try auditRow(entity: "beo_events", entityId: id, action: "update"))
    }

    // ── POST action='line' ───────────────────────────────────────────────

    func testAddLineInsertsWithCostAndQuantity() throws {
        let eventId = try fixture.seedEvent(title: "Line host", date: "2026-05-25")
        let id = try repo.addLine(BeoLineInput(
            eventId: eventId, itemName: "Queso", category: "Starter",
            unitCost: 6.5, quantity: 30, sortOrder: 1
        ), locationId: "default", context: ctx)

        let row = try XCTUnwrap(fixture.row("SELECT * FROM beo_line_items WHERE id = ?", [id]))
        XCTAssertEqual(row["event_id"], eventId)
        XCTAssertEqual(row["item_name"], "Queso")
        XCTAssertEqual(row["category"], "Starter")
        XCTAssertEqual(row["unit_cost"], 6.5)
        XCTAssertEqual(row["quantity"], 30.0)
        XCTAssertEqual(row["sort_order"], 1)
    }

    func testAddLineDefaultsCostZeroQuantityOne() throws {
        let eventId = try fixture.seedEvent(title: "Defaults party", date: "2026-05-26")
        let id = try repo.addLine(BeoLineInput(eventId: eventId, itemName: "Napkins"),
                                  locationId: "default", context: ctx)
        let row = try XCTUnwrap(fixture.row("SELECT unit_cost, quantity FROM beo_line_items WHERE id = ?", [id]))
        XCTAssertEqual(row["unit_cost"], 0.0)
        XCTAssertEqual(row["quantity"], 1.0)
    }

    func testAddLineThrowsWhenEventIdOrItemNameMissing() throws {
        let eventId = try fixture.seedEvent(title: "host-missing-fields", date: "2026-05-27")
        XCTAssertThrowsError(try repo.addLine(BeoLineInput(itemName: "x"), locationId: "default", context: ctx)) {
            guard case BeoWriteError.badRequest(let msg) = $0 else { return XCTFail("expected badRequest") }
            XCTAssertEqual(msg, "event_id and item_name required")
        }
        XCTAssertThrowsError(try repo.addLine(BeoLineInput(eventId: eventId), locationId: "default", context: ctx)) {
            guard case BeoWriteError.badRequest = $0 else { return XCTFail("expected badRequest") }
        }
    }

    func testAddLinePostsAuditRow() throws {
        let eventId = try fixture.seedEvent()
        let id = try repo.addLine(BeoLineInput(eventId: eventId, itemName: "Audited item"),
                                  locationId: "default", context: ctx)
        let audit = try XCTUnwrap(try auditRow(entity: "beo_line_items", entityId: id, action: "insert"))
        let payload: String = try XCTUnwrap(audit["payload_json"])
        XCTAssertTrue(payload.contains("item_name"))
        XCTAssertTrue(payload.contains("event_id"))
    }

    // ── POST action='update_line' ────────────────────────────────────────

    func testUpdateLineMutatesNameCostQtyCategory() throws {
        let eventId = try fixture.seedEvent(title: "Update host", date: "2026-06-02")
        let id = try repo.addLine(BeoLineInput(
            eventId: eventId, itemName: "Taco bar", category: "Entree",
            unitCost: 9, quantity: 20
        ), locationId: "default", context: ctx)

        try repo.updateLine(id: id, patch: BeoLinePatch(
            itemName: "Taco bar (deluxe)", unitCost: 11.5, quantity: 25,
            category: "Entree (Featured)"
        ), locationId: "default", context: ctx)

        let row = try XCTUnwrap(fixture.row("SELECT * FROM beo_line_items WHERE id = ?", [id]))
        XCTAssertEqual(row["item_name"], "Taco bar (deluxe)")
        XCTAssertEqual(row["unit_cost"], 11.5)
        XCTAssertEqual(row["quantity"], 25.0)
        XCTAssertEqual(row["category"], "Entree (Featured)")
    }

    func testUpdateLineTextFieldsClearVersusPreserve() throws {
        let eventId = try fixture.seedEvent()
        let id = try repo.addLine(BeoLineInput(
            eventId: eventId, itemName: "Brisket", prepNotes: "trim fat",
            orderTime: "5:30pm"
        ), locationId: "default", context: ctx)

        // Absent key → preserved.
        try repo.updateLine(id: id, patch: BeoLinePatch(itemName: "Brisket 2"),
                            locationId: "default", context: ctx)
        var row = try XCTUnwrap(fixture.row("SELECT prep_notes, order_time FROM beo_line_items WHERE id = ?", [id]))
        XCTAssertEqual(row["prep_notes"], "trim fat")
        XCTAssertEqual(row["order_time"], "5:30pm")

        // Explicit clear ('' / null on web) → NULL.
        try repo.updateLine(id: id, patch: BeoLinePatch(prepNotes: .set(nil)),
                            locationId: "default", context: ctx)
        row = try XCTUnwrap(fixture.row("SELECT prep_notes, order_time FROM beo_line_items WHERE id = ?", [id]))
        XCTAssertTrue(row["prep_notes"] == nil)
        XCTAssertEqual(row["order_time"], "5:30pm")

        // Empty string behaves like clear (web clip('') → null).
        try repo.updateLine(id: id, patch: BeoLinePatch(orderTime: .set("  ")),
                            locationId: "default", context: ctx)
        row = try XCTUnwrap(fixture.row("SELECT order_time FROM beo_line_items WHERE id = ?", [id]))
        XCTAssertTrue(row["order_time"] == nil)
    }

    func testUpdateLineBindsCourse() throws {
        let eventId = try fixture.seedEvent()
        let lineId = try fixture.seedLineItem(eventId: eventId)
        let courseId = try fixture.seedCourse(eventId: eventId, fireAt: "2026-05-04T19:30:00.000Z")

        try repo.updateLine(id: lineId, patch: BeoLinePatch(courseId: .set(courseId)),
                            locationId: "default", context: ctx)
        let row = try XCTUnwrap(fixture.row("SELECT course_id FROM beo_line_items WHERE id = ?", [lineId]))
        XCTAssertEqual(row["course_id"], courseId)
    }

    func testUpdateLineClearsCourseOnExplicitNull() throws {
        let eventId = try fixture.seedEvent()
        let courseId = try fixture.seedCourse(eventId: eventId, fireAt: "2026-05-04T19:30:00.000Z")
        let lineId = try fixture.seedLineItem(eventId: eventId, courseId: courseId)

        try repo.updateLine(id: lineId, patch: BeoLinePatch(courseId: .set(nil)),
                            locationId: "default", context: ctx)
        let row = try XCTUnwrap(fixture.row("SELECT course_id FROM beo_line_items WHERE id = ?", [lineId]))
        XCTAssertTrue(row["course_id"] == nil)
    }

    func testUpdateLineLeavesCourseAloneWhenKeyAbsent() throws {
        let eventId = try fixture.seedEvent()
        let courseId = try fixture.seedCourse(eventId: eventId, fireAt: "2026-05-04T19:30:00.000Z")
        let lineId = try fixture.seedLineItem(eventId: eventId, courseId: courseId)

        try repo.updateLine(id: lineId, patch: BeoLinePatch(itemName: "Renamed"),
                            locationId: "default", context: ctx)
        let row = try XCTUnwrap(fixture.row("SELECT course_id, item_name FROM beo_line_items WHERE id = ?", [lineId]))
        XCTAssertEqual(row["course_id"], courseId, "course binding should be preserved when key not in patch")
        XCTAssertEqual(row["item_name"], "Renamed")
    }

    func testUpdateLineRejectsMalformedCourseIdBeforeAnyWrite() throws {
        let eventId = try fixture.seedEvent()
        let lineId = try fixture.seedLineItem(eventId: eventId)

        XCTAssertThrowsError(try repo.updateLine(
            id: lineId, patch: BeoLinePatch(itemName: "Should not land", courseId: .set(0)),
            locationId: "default", context: ctx)
        ) { error in
            guard case BeoWriteError.unprocessable = error else {
                return XCTFail("expected unprocessable (web 422), got \(error)")
            }
        }
        // Rule failure BEFORE any write: row untouched, no audit row.
        let row = try XCTUnwrap(fixture.row("SELECT item_name FROM beo_line_items WHERE id = ?", [lineId]))
        XCTAssertEqual(row["item_name"], "Smoked Brisket")
        XCTAssertNil(try auditRow(entity: "beo_line_items", entityId: lineId, action: "update"))
    }

    func testUpdateLinePostsAuditRow() throws {
        let eventId = try fixture.seedEvent()
        let lineId = try fixture.seedLineItem(eventId: eventId)
        try repo.updateLine(id: lineId, patch: BeoLinePatch(itemName: "Renamed"),
                            locationId: "default", context: ctx)
        let audit = try XCTUnwrap(try auditRow(entity: "beo_line_items", entityId: lineId, action: "update"))
        XCTAssertEqual(audit["actor_source"], "native_mac")
    }

    // ── location scoping via the parent event (Bundle-H T4) ─────────────

    private func setupTwoLocations() throws -> (locA: String, lineA: Int64, lineB: Int64) {
        let locA = "site-a", locB = "site-b"
        let evA = try fixture.seedEvent(title: "Site A Party", location: locA)
        let evB = try fixture.seedEvent(title: "Site B Party", location: locB)
        let lineA = try fixture.seed2LineItem(eventId: evA, item: "Site A Brisket", cost: 18.0, qty: 50)
        let lineB = try fixture.seed2LineItem(eventId: evB, item: "Site B Salmon", cost: 22.0, qty: 30)
        return (locA, lineA, lineB)
    }

    func testDeleteLineDeletesWhenLocationMatchesParentEvent() throws {
        let (locA, lineA, _) = try setupTwoLocations()
        try repo.deleteLine(id: lineA, locationId: locA, context: ctx)
        XCTAssertNil(try fixture.row("SELECT * FROM beo_line_items WHERE id = ?", [lineA]))
    }

    func testDeleteLineDoesNotDeleteForeignLocationLine() throws {
        let (locA, _, lineB) = try setupTwoLocations()
        try repo.deleteLine(id: lineB, locationId: locA, context: ctx)
        let row = try XCTUnwrap(fixture.row("SELECT * FROM beo_line_items WHERE id = ?", [lineB]),
                                "foreign-location line must NOT be deleted")
        XCTAssertEqual(row["item_name"], "Site B Salmon")
        XCTAssertEqual(row["unit_cost"], 22.0)
        XCTAssertEqual(row["quantity"], 30.0)
    }

    func testUpdateLineUpdatesWhenLocationMatchesParentEvent() throws {
        let (locA, lineA, _) = try setupTwoLocations()
        try repo.updateLine(id: lineA, patch: BeoLinePatch(
            itemName: "Site A Brisket (deluxe)", unitCost: 21.5, quantity: 55
        ), locationId: locA, context: ctx)
        let row = try XCTUnwrap(fixture.row("SELECT * FROM beo_line_items WHERE id = ?", [lineA]))
        XCTAssertEqual(row["item_name"], "Site A Brisket (deluxe)")
        XCTAssertEqual(row["unit_cost"], 21.5)
        XCTAssertEqual(row["quantity"], 55.0)
    }

    func testUpdateLineDoesNotMutateForeignLocationLine() throws {
        let (locA, _, lineB) = try setupTwoLocations()
        try repo.updateLine(id: lineB, patch: BeoLinePatch(
            itemName: "HIJACKED", unitCost: 0.01, quantity: 999
        ), locationId: locA, context: ctx)
        let row = try XCTUnwrap(fixture.row("SELECT * FROM beo_line_items WHERE id = ?", [lineB]))
        XCTAssertEqual(row["item_name"], "Site B Salmon")
        XCTAssertEqual(row["unit_cost"], 22.0)
        XCTAssertEqual(row["quantity"], 30.0)
    }

    func testOwnLocationDeleteLeavesForeignDataAlone() throws {
        let (locA, lineA, lineB) = try setupTwoLocations()
        try repo.deleteLine(id: lineA, locationId: locA, context: ctx)
        let stillB = try XCTUnwrap(fixture.row("SELECT * FROM beo_line_items WHERE id = ?", [lineB]))
        XCTAssertEqual(stillB["item_name"], "Site B Salmon")
    }

    // ── POST action='delete_line' ────────────────────────────────────────

    func testDeleteLineRemovesRowAndAudits() throws {
        let eventId = try fixture.seedEvent(title: "Delete host", date: "2026-06-03")
        let id = try repo.addLine(BeoLineInput(eventId: eventId, itemName: "Ephemeral"),
                                  locationId: "default", context: ctx)
        try repo.deleteLine(id: id, locationId: "default", context: ctx)
        XCTAssertNil(try fixture.row("SELECT * FROM beo_line_items WHERE id = ?", [id]))
        XCTAssertNotNil(try auditRow(entity: "beo_line_items", entityId: id, action: "delete"))
    }

    // ── POST action='prep' / 'prep_done' ─────────────────────────────────

    func testAddPrepTaskInsertsAndAudits() throws {
        let eventId = try fixture.seedEvent()
        let id = try repo.addPrepTask(eventId: eventId, task: "Brine birds",
                                      locationId: "default", context: ctx)
        let row = try XCTUnwrap(fixture.row("SELECT * FROM beo_prep_tasks WHERE id = ?", [id]))
        XCTAssertEqual(row["task"], "Brine birds")
        XCTAssertEqual(row["done"], 0)
        XCTAssertEqual(row["location_id"], "default")
        XCTAssertNotNil(try auditRow(entity: "beo_prep_tasks", entityId: id, action: "insert"))
    }

    func testAddPrepTaskThrowsWhenEventIdOrTaskMissing() throws {
        let eventId = try fixture.seedEvent()
        XCTAssertThrowsError(try repo.addPrepTask(eventId: nil, task: "x", locationId: "default", context: ctx)) {
            guard case BeoWriteError.badRequest(let msg) = $0 else { return XCTFail("expected badRequest") }
            XCTAssertEqual(msg, "event_id and task required")
        }
        XCTAssertThrowsError(try repo.addPrepTask(eventId: eventId, task: "  ", locationId: "default", context: ctx)) {
            guard case BeoWriteError.badRequest = $0 else { return XCTFail("expected badRequest") }
        }
    }

    func testSetPrepDoneTogglesAndAudits() throws {
        let eventId = try fixture.seedEvent()
        let id = try repo.addPrepTask(eventId: eventId, task: "Portion sauce",
                                      locationId: "default", context: ctx)
        try repo.setPrepDone(id: id, done: true, locationId: "default", context: ctx)
        var row = try XCTUnwrap(fixture.row("SELECT done FROM beo_prep_tasks WHERE id = ?", [id]))
        XCTAssertEqual(row["done"], 1)
        try repo.setPrepDone(id: id, done: false, locationId: "default", context: ctx)
        row = try XCTUnwrap(fixture.row("SELECT done FROM beo_prep_tasks WHERE id = ?", [id]))
        XCTAssertEqual(row["done"], 0)
        XCTAssertNotNil(try auditRow(entity: "beo_prep_tasks", entityId: id, action: "update"))
    }

    // ── POST action='delete_event' + FK cascades ─────────────────────────

    func testDeleteEventCascadesLineItems() throws {
        let eventId = try fixture.seedEvent(title: "Cascade host", date: "2026-06-05")
        for name in ["Line A", "Line B", "Line C"] {
            _ = try repo.addLine(BeoLineInput(eventId: eventId, itemName: name),
                                 locationId: "default", context: ctx)
        }
        XCTAssertEqual(try fixture.count(
            "SELECT COUNT(*) FROM beo_line_items WHERE event_id = ?", [eventId]), 3)

        try repo.deleteEvent(id: eventId, locationId: "default", context: ctx)

        XCTAssertEqual(try fixture.count("SELECT COUNT(*) FROM beo_events WHERE id = ?", [eventId]), 0)
        XCTAssertEqual(try fixture.count(
            "SELECT COUNT(*) FROM beo_line_items WHERE event_id = ?", [eventId]), 0,
            "child beo_line_items rows should be cascade-deleted")
        XCTAssertNotNil(try auditRow(entity: "beo_events", entityId: eventId, action: "delete"))
    }

    func testDeleteEventCascadesPrepTasksViaFkAlone() throws {
        let eventId = try fixture.seedEvent(title: "Prep cascade host", date: "2026-07-04")
        for task in ["Brine birds", "Portion sauce", "Set up buffet"] {
            _ = try repo.addPrepTask(eventId: eventId, task: task, locationId: "default", context: ctx)
        }
        XCTAssertEqual(try fixture.count(
            "SELECT COUNT(*) FROM beo_prep_tasks WHERE event_id = ?", [eventId]), 3)

        try repo.deleteEvent(id: eventId, locationId: "default", context: ctx)

        XCTAssertEqual(try fixture.count("SELECT COUNT(*) FROM beo_events WHERE id = ?", [eventId]), 0)
        XCTAssertEqual(try fixture.count(
            "SELECT COUNT(*) FROM beo_prep_tasks WHERE event_id = ?", [eventId]), 0,
            "child beo_prep_tasks rows should be cascade-deleted by the FK alone")
    }

    func testForeignKeyEnforcementIsOnForThisConnection() throws {
        // Lock in the connection setup (LariatWriteDatabase sets
        // foreignKeysEnabled) so a config refactor surfaces here, not as a
        // silent cascade regression — web parity with PRAGMA foreign_keys=ON.
        let fk = try fixture.writeDB.pool.read { db in
            try Int.fetchOne(db, sql: "PRAGMA foreign_keys") ?? 0
        }
        XCTAssertEqual(fk, 1, "PRAGMA foreign_keys must be ON")
    }

    // ── location scoping on delete_event + prep_done ─────────────────────
    // Web parity: both mutations carry `AND location_id = ?`
    // (app/api/beo/route.js) so a caller scoped to one location cannot
    // delete/toggle another location's rows by id.

    func testDeleteEventDeletesWhenLocationMatches() throws {
        let evA = try fixture.seedEvent(title: "Site A Party", location: "site-a")
        try repo.deleteEvent(id: evA, locationId: "site-a", context: ctx)
        XCTAssertNil(try fixture.row("SELECT * FROM beo_events WHERE id = ?", [evA]))
    }

    func testDeleteEventDoesNotDeleteForeignLocationEvent() throws {
        let evB = try fixture.seedEvent(title: "Site B Party", location: "site-b")
        try repo.deleteEvent(id: evB, locationId: "site-a", context: ctx)
        let row = try XCTUnwrap(
            fixture.row("SELECT title FROM beo_events WHERE id = ?", [evB]),
            "a site-a-scoped delete must NOT remove a site-b event")
        XCTAssertEqual(row["title"], "Site B Party")
    }

    func testSetPrepDoneTogglesWhenLocationMatches() throws {
        let ev = try fixture.seedEvent(location: "site-a")
        let taskId = try fixture.seed2PrepTask(eventId: ev, task: "Brine turkey", location: "site-a")
        try repo.setPrepDone(id: taskId, done: true, locationId: "site-a", context: ctx)
        let row = try XCTUnwrap(fixture.row("SELECT done FROM beo_prep_tasks WHERE id = ?", [taskId]))
        XCTAssertEqual(row["done"], 1)
    }

    func testSetPrepDoneDoesNotTouchForeignLocationTask() throws {
        let ev = try fixture.seedEvent(location: "site-b")
        let taskId = try fixture.seed2PrepTask(eventId: ev, task: "Brine turkey", location: "site-b")
        try repo.setPrepDone(id: taskId, done: true, locationId: "site-a", context: ctx)
        let row = try XCTUnwrap(
            fixture.row("SELECT done FROM beo_prep_tasks WHERE id = ?", [taskId]),
            "foreign-location prep task must survive")
        XCTAssertEqual(row["done"], 0, "a site-a-scoped toggle must NOT flip a site-b prep task")
    }
}

private extension BeoFixture {
    @discardableResult
    func seed2PrepTask(eventId: Int64, task: String, done: Bool = false, location: String) throws -> Int64 {
        try writeDB.pool.write { db in
            try db.execute(
                sql: "INSERT INTO beo_prep_tasks (event_id, task, done, location_id) VALUES (?, ?, ?, ?)",
                arguments: [eventId, task, done ? 1 : 0, location]
            )
            return db.lastInsertedRowID
        }
    }

    @discardableResult
    func seed2LineItem(eventId: Int64, item: String, cost: Double, qty: Double) throws -> Int64 {
        try writeDB.pool.write { db in
            try db.execute(
                sql: "INSERT INTO beo_line_items (event_id, item_name, unit_cost, quantity) VALUES (?, ?, ?, ?)",
                arguments: [eventId, item, cost, qty]
            )
            return db.lastInsertedRowID
        }
    }
}
