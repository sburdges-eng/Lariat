import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

// Behavior-parity port of tests/js/test-receiving-api.mjs against an on-disk temp
// GRDB fixture seeded with the real receiving_log + inventory_updates +
// audit_events + vendor_prices + ingredient_masters schema. Exercises POST
// (accept + audit), the 400/422 validation ladder (needs_rejection_note vs
// needs_corrective_action), closed-loop inventory crediting (matched/unmatched/
// ambiguous/skip/rollback), the partial-unique double-credit guard, and GET
// (summary tones, vendor grouping, totals, location scoping).
//
// The manager receiving-match resolution (/api/receiving/matches/**) is a
// separate tier and intentionally NOT ported here — these tests assert the
// receiving BOARD POST/GET only. Where the JS test resolves an unmatched/ambiguous
// row via a manager PATCH, the Swift parity assertion stops at "queued without a
// credit" (the board's own responsibility).

final class ReceivingRepositoryTests: XCTestCase {
    private func today() -> String { ShiftDate.todayISO() }

    // ── POST — happy path ──────────────────────────────────────────────

    func testAcceptsInSpecRefrigeratedDelivery() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)

        let result = try repo.record(
            input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated",
                                       invoiceRef: "INV-1001", item: "chicken breast 40lb CS",
                                       readingF: 38, packageOk: true, cookId: "alice"),
            context: .nativeCook(cookId: "alice")
        )
        XCTAssertEqual(result.decision.status, .ok)
        XCTAssertEqual(result.row.status, "accepted")
        XCTAssertEqual(result.row.readingF, 38)
        XCTAssertEqual(result.row.packageOk, 1)

        try writeDB.pool.read { db in
            XCTAssertEqual(try count(db, "receiving_log"), 1)
            XCTAssertEqual(try count(db, "audit_events", entity: "receiving_log"), 1)
        }
    }

    func testAcceptsDryGoodsWithNoReading() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.record(input: ReceivingEntryInput(vendor: "Sysco", category: "dry_goods", item: "canned tomatoes #10"), context: .nativeCook(cookId: nil))
        try writeDB.pool.read { db in XCTAssertEqual(try count(db, "receiving_log"), 1) }
    }

    func testPersistsExpirationAndInvoiceRef() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        let r = try repo.record(
            input: ReceivingEntryInput(vendor: "Shamrock", category: "shell_eggs",
                                       invoiceRef: "INV-2002", item: "15dz flat",
                                       readingF: 42, expirationDate: "2099-05-15"),
            context: .nativeCook(cookId: nil)
        )
        XCTAssertEqual(r.row.invoiceRef, "INV-2002")
        XCTAssertEqual(r.row.expirationDate, "2099-05-15")
    }

    // ── POST — validation / 400 ────────────────────────────────────────

    func testMissingVendorThrowsValidationWritesNothing() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.record(input: ReceivingEntryInput(vendor: "  ", category: "refrigerated", readingF: 38), context: .nativeCook(cookId: nil))) { error in
            XCTAssertTrue(isValidationFailed(error))
        }
        try writeDB.pool.read { db in XCTAssertEqual(try count(db, "receiving_log"), 0) }
    }

    func testUnknownCategoryThrowsValidation() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "specialty_bakery", readingF: 38), context: .nativeCook(cookId: nil))) { error in
            guard case .validationFailed(let msg)? = error as? ReceivingWriteError else { return XCTFail("expected validationFailed") }
            XCTAssertTrue(msg.contains("unknown category"))
        }
    }

    func testMalformedExpirationDateThrows() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", readingF: 38, expirationDate: "05/15/2026"), context: .nativeCook(cookId: nil))) { error in
            XCTAssertTrue(isValidationFailed(error))
        }
    }

    func testNonFiniteReadingThrows() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", readingF: .nan), context: .nativeCook(cookId: nil))) { error in
            XCTAssertTrue(isValidationFailed(error))
        }
    }

    func testOverLongCorrectiveActionThrows() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", readingF: 38, correctiveAction: String(repeating: "x", count: 600)), context: .nativeCook(cookId: nil))) { error in
            guard case .correctiveNoteTooLong? = error as? ReceivingWriteError else { return XCTFail("expected correctiveNoteTooLong") }
        }
    }

    // ── POST — 422 ladder ──────────────────────────────────────────────

    func testDriftBandWithoutNoteThrowsNeedsCorrectiveActionNoRowNoAudit() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", readingF: 43, packageOk: true), context: .nativeCook(cookId: nil))) { error in
            let e = error as? ReceivingWriteError
            XCTAssertTrue(e?.needsCorrectiveAction == true)
            XCTAssertFalse(e?.needsRejectionNote == true)
            if case .needsCorrectiveAction(_, let citation)? = e { XCTAssertTrue(citation?.contains("§") == true) } else { XCTFail() }
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try count(db, "receiving_log"), 0)
            XCTAssertEqual(try count(db, "audit_events", entity: "receiving_log"), 0)
        }
    }

    func testDriftBandWithNoteIsAcceptedWithNoteSavedAndAudited() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        let r = try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", readingF: 43, packageOk: true, correctiveAction: "moved to reach-in, re-checked at 39°F"), context: .nativeCook(cookId: nil))
        XCTAssertEqual(r.row.status, "accepted_with_note")
        XCTAssertTrue(r.row.rejectionReason?.contains("reach-in") == true)
        try writeDB.pool.read { db in
            XCTAssertEqual(try count(db, "receiving_log"), 1)
            XCTAssertEqual(try count(db, "audit_events", entity: "receiving_log"), 1)
        }
    }

    func testTooWarmWithoutNoteThrowsNeedsRejectionNote() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", readingF: 50, packageOk: true), context: .nativeCook(cookId: nil))) { error in
            let e = error as? ReceivingWriteError
            XCTAssertTrue(e?.needsRejectionNote == true)
            XCTAssertFalse(e?.needsCorrectiveAction == true)
            if case .needsRejectionNote(_, let citation)? = e { XCTAssertTrue(citation?.contains("§") == true) } else { XCTFail() }
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try count(db, "receiving_log"), 0)
            XCTAssertEqual(try count(db, "audit_events", entity: "receiving_log"), 0)
        }
    }

    func testTooWarmWithRejectionReasonSavedAsRejected() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        let r = try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", readingF: 50, packageOk: true, correctiveAction: "driver confirmed reefer alarm; full invoice credit"), context: .nativeCook(cookId: nil))
        XCTAssertEqual(r.row.status, "rejected")
        try writeDB.pool.read { db in XCTAssertEqual(try count(db, "audit_events", entity: "receiving_log"), 1) }
    }

    func testPackageFalseWithoutNoteRejectionNoteWithNoteRejected() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", readingF: 38, packageOk: false), context: .nativeCook(cookId: nil))) { error in
            let e = error as? ReceivingWriteError
            XCTAssertTrue(e?.needsRejectionNote == true)
            XCTAssertFalse(e?.needsCorrectiveAction == true)
        }
        try writeDB.pool.read { db in XCTAssertEqual(try count(db, "receiving_log"), 0) }

        let r = try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", readingF: 38, packageOk: false, correctiveAction: "pallet leak, vendor callback SHAMROCK-CB-771"), context: .nativeCook(cookId: nil))
        XCTAssertEqual(r.row.status, "rejected")
        XCTAssertEqual(r.row.packageOk, 0)
    }

    // ── POST — audit trail ─────────────────────────────────────────────

    func testAcceptedDeliveryAuditNoteNullActorNativeCook() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", readingF: 38, cookId: "alice"), context: .nativeCook(cookId: "alice"))
        try writeDB.pool.read { db in
            XCTAssertEqual(try count(db, "audit_events", entity: "receiving_log"), 1)
            let action = try String.fetchOne(db, sql: "SELECT action FROM audit_events WHERE entity='receiving_log' LIMIT 1")
            XCTAssertEqual(action, "insert")
            let actor = try String.fetchOne(db, sql: "SELECT actor_cook_id FROM audit_events WHERE entity='receiving_log' LIMIT 1")
            XCTAssertEqual(actor, "alice")
            let source = try String.fetchOne(db, sql: "SELECT actor_source FROM audit_events WHERE entity='receiving_log' LIMIT 1")
            XCTAssertEqual(source, RegulatedWriteContext.nativeCookActorSource)
            let note = try String.fetchOne(db, sql: "SELECT note FROM audit_events WHERE entity='receiving_log' LIMIT 1")
            XCTAssertNil(note)  // ok status → null note
        }
    }

    func testAuditNoteCarriesStatusColonCategoryForNonOk() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", readingF: 43, packageOk: true, correctiveAction: "moved to reach-in"), context: .nativeCook(cookId: nil))
        try writeDB.pool.read { db in
            let note = try String.fetchOne(db, sql: "SELECT note FROM audit_events WHERE entity='receiving_log' LIMIT 1")
            XCTAssertEqual(note, "accept_with_note:refrigerated")
        }
    }

    // ── GET ─────────────────────────────────────────────────────────────

    func testEmptyDayReturnsFullGraySummary() async throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        let snap = try await repo.load(date: today(), locationId: "default")
        XCTAssertGreaterThanOrEqual(snap.summary.count, 6)
        for s in snap.summary { XCTAssertEqual(s.status, .gray) }
        XCTAssertEqual(snap.totals.accepted, 0)
        XCTAssertEqual(snap.totals.rejected, 0)
        XCTAssertEqual(snap.totals.acceptedWithNote, 0)
    }

    func testGroupsEntriesByVendorWithPerVendorCounts() async throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", readingF: 38), context: .nativeCook(cookId: nil))
        _ = try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "frozen", readingF: -10), context: .nativeCook(cookId: nil))
        _ = try repo.record(input: ReceivingEntryInput(vendor: "Sysco", category: "dry_goods", item: "canned tomatoes"), context: .nativeCook(cookId: nil))
        let snap = try await repo.load(date: today(), locationId: "default")
        XCTAssertEqual(snap.vendors.count, 2)
        XCTAssertEqual(snap.vendors.first(where: { $0.vendor == "Shamrock" })?.entries.count, 2)
        XCTAssertEqual(snap.vendors.first(where: { $0.vendor == "Shamrock" })?.accepted, 2)
        XCTAssertEqual(snap.vendors.first(where: { $0.vendor == "Sysco" })?.entries.count, 1)
    }

    func testSummaryYellowAfterAcceptWithNote() async throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", readingF: 43, packageOk: true, correctiveAction: "pulled down in reach-in"), context: .nativeCook(cookId: nil))
        let snap = try await repo.load(date: today(), locationId: "default")
        let t = snap.summary.first { $0.category == .refrigerated }
        XCTAssertEqual(t?.status, .yellow)
        XCTAssertEqual(t?.acceptedWithNote, 1)
    }

    func testSummaryRedAfterRejected() async throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", readingF: 50, packageOk: true, correctiveAction: "full credit issued"), context: .nativeCook(cookId: nil))
        let snap = try await repo.load(date: today(), locationId: "default")
        let t = snap.summary.first { $0.category == .refrigerated }
        XCTAssertEqual(t?.status, .red)
        XCTAssertEqual(t?.rejected, 1)
    }

    func testLocationScoping() async throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        _ = try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", readingF: 38), context: .nativeCook(cookId: nil, locationId: "downtown"))
        _ = try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", readingF: 38), context: .nativeCook(cookId: nil, locationId: "default"))
        let snap = try await repo.load(date: today(), locationId: "downtown")
        XCTAssertEqual(snap.entries.count, 1)
        XCTAssertEqual(snap.entries.first?.locationId, "downtown")
    }

    // ── POST — closed-loop inventory crediting ─────────────────────────

    func testMatchedHappyPathWritesBothRowsAndTwoAudits() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        try seedIngredientMaster(writeDB, "chicken_breast_40lb_cs")
        try seedVendorPrice(writeDB, vendor: "Shamrock", sku: "CHX-40", ingredient: "chicken breast 40lb CS", masterId: "chicken_breast_40lb_cs")

        let r = try repo.record(
            input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", item: "chicken breast 40lb CS",
                                       readingF: 38, packageOk: true, receivedQty: 40, receivedUnit: "lb", cookId: "alice"),
            context: .nativeCook(cookId: "alice")
        )
        XCTAssertEqual(r.match.status, "matched")
        XCTAssertEqual(r.match.masterId, "chicken_breast_40lb_cs")
        XCTAssertEqual(r.match.reason, "exact_vendor_item")
        XCTAssertEqual(r.row.receivedQty, 40)
        XCTAssertEqual(r.row.receivedUnit, "lb")

        let inv = try XCTUnwrap(r.inventoryUpdate)
        XCTAssertEqual(inv.item, "chicken breast 40lb CS")
        XCTAssertEqual(inv.masterId, "chicken_breast_40lb_cs")
        XCTAssertEqual(inv.delta, "40 lb")
        XCTAssertEqual(inv.direction, "in")
        XCTAssertEqual(inv.cookId, "alice")
        XCTAssertTrue(inv.note?.contains("closed-loop receiving from receiving_log #") == true)
        XCTAssertEqual(inv.receivingLogId, r.row.id)

        try writeDB.pool.read { db in
            XCTAssertEqual(try count(db, "receiving_log"), 1)
            XCTAssertEqual(try count(db, "inventory_updates"), 1)
            XCTAssertEqual(try count(db, "audit_events", entity: "receiving_log"), 1)
            XCTAssertEqual(try count(db, "audit_events", entity: "inventory_updates"), 1)
            let invSource = try String.fetchOne(db, sql: "SELECT actor_source FROM audit_events WHERE entity='inventory_updates' LIMIT 1")
            XCTAssertEqual(invSource, "receiving_closed_loop")
            let invNote = try String.fetchOne(db, sql: "SELECT note FROM audit_events WHERE entity='inventory_updates' LIMIT 1")
            XCTAssertTrue(invNote?.hasPrefix("receiving_log:") == true)
        }
    }

    func testUnmatchedAcceptedDeliveryQueuesWithoutCredit() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        try seedIngredientMaster(writeDB, "heirloom_tomato_case")

        let r = try repo.record(
            input: ReceivingEntryInput(vendor: "Local Farms", category: "produce", item: "heirloom tomato case",
                                       packageOk: true, receivedQty: 2, receivedUnit: "case", cookId: "maria"),
            context: .nativeCook(cookId: "maria")
        )
        XCTAssertEqual(r.match.status, "unmatched")
        XCTAssertEqual(r.match.reason, "no_vendor_price_match")
        XCTAssertNil(r.match.masterId)
        XCTAssertNil(r.inventoryUpdate)
        XCTAssertEqual(r.row.matchStatus, "unmatched")
        XCTAssertNil(r.row.masterId)
        try writeDB.pool.read { db in
            XCTAssertEqual(try count(db, "receiving_log"), 1)
            XCTAssertEqual(try count(db, "inventory_updates"), 0)
            XCTAssertEqual(try count(db, "audit_events", entity: "inventory_updates"), 0)
        }
    }

    func testAmbiguousVendorMatchQueuesWithoutCredit() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        try seedIngredientMaster(writeDB, "shamrock_heirloom_tomato")
        try seedIngredientMaster(writeDB, "local_heirloom_tomato")
        try seedVendorPrice(writeDB, vendor: "Shamrock", sku: "TOM-CASE", ingredient: "heirloom tomato case", masterId: "shamrock_heirloom_tomato")
        try seedVendorPrice(writeDB, vendor: "Shamrock", sku: "TOM-CASE", ingredient: "local heirloom tomato case", masterId: "local_heirloom_tomato")

        let r = try repo.record(
            input: ReceivingEntryInput(vendor: "Shamrock", category: "produce", item: "heirloom tomato case",
                                       vendorSku: "TOM-CASE", packageOk: true, receivedQty: 2, receivedUnit: "case", cookId: "maria"),
            context: .nativeCook(cookId: "maria")
        )
        XCTAssertEqual(r.match.status, "ambiguous")
        XCTAssertEqual(r.match.reason, "multiple_vendor_sku_matches")
        XCTAssertNil(r.match.masterId)
        XCTAssertNil(r.inventoryUpdate)
        XCTAssertEqual(r.row.matchStatus, "ambiguous")
        try writeDB.pool.read { db in
            XCTAssertEqual(try count(db, "receiving_log"), 1)
            XCTAssertEqual(try count(db, "inventory_updates"), 0)
        }
    }

    func testAcceptedWithNotePlusQtyCreditsInventory() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        try seedIngredientMaster(writeDB, "milk_2_gal")
        try seedVendorPrice(writeDB, vendor: "Shamrock", sku: "MILK-2", ingredient: "milk 2% gal", masterId: "milk_2_gal")

        let r = try repo.record(
            input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", item: "milk 2% gal",
                                       readingF: 43, packageOk: true, correctiveAction: "pulled down in reach-in, verified 39°F 20min later",
                                       receivedQty: 6, receivedUnit: "gal"),
            context: .nativeCook(cookId: nil)
        )
        let inv = try XCTUnwrap(r.inventoryUpdate)
        XCTAssertEqual(inv.masterId, "milk_2_gal")
        XCTAssertEqual(inv.delta, "6 gal")
        try writeDB.pool.read { db in
            XCTAssertEqual(try count(db, "receiving_log"), 1)
            XCTAssertEqual(try count(db, "inventory_updates"), 1)
        }
    }

    func testRejectedDeliveryWithQtyDoesNotCredit() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        let r = try repo.record(
            input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", item: "milk 2%",
                                       readingF: 50, packageOk: true, correctiveAction: "reefer alarm — full credit issued",
                                       receivedQty: 6, receivedUnit: "gal"),
            context: .nativeCook(cookId: nil)
        )
        XCTAssertEqual(r.row.status, "rejected")
        XCTAssertNil(r.inventoryUpdate)
        try writeDB.pool.read { db in
            XCTAssertEqual(try count(db, "receiving_log"), 1)
            XCTAssertEqual(try count(db, "inventory_updates"), 0)
            XCTAssertEqual(try count(db, "audit_events", entity: "inventory_updates"), 0)
            XCTAssertEqual(try count(db, "audit_events", entity: "receiving_log"), 1)
        }
    }

    func testAcceptedWithoutQtyUnitGracefulSkip() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        let r = try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", item: "chicken breast 40lb CS", readingF: 38, packageOk: true), context: .nativeCook(cookId: nil))
        XCTAssertNil(r.inventoryUpdate)
        try writeDB.pool.read { db in
            XCTAssertEqual(try count(db, "receiving_log"), 1)
            XCTAssertEqual(try count(db, "inventory_updates"), 0)
        }
    }

    func testAcceptedWithQtyButNoUnitIs400() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", item: "chicken breast", readingF: 38, packageOk: true, receivedQty: 40), context: .nativeCook(cookId: nil))) { error in
            guard case .closedLoopError? = error as? ReceivingWriteError else { return XCTFail("expected closedLoopError") }
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try count(db, "receiving_log"), 0)
            XCTAssertEqual(try count(db, "inventory_updates"), 0)
        }
    }

    func testAcceptedWithItemMissingGracefulSkip() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        let r = try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "dry_goods", receivedQty: 10, receivedUnit: "case"), context: .nativeCook(cookId: nil))
        XCTAssertNil(r.inventoryUpdate)
        try writeDB.pool.read { db in
            XCTAssertEqual(try count(db, "receiving_log"), 1)
            XCTAssertEqual(try count(db, "inventory_updates"), 0)
        }
    }

    func testNegativeQtyIs400() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", item: "chicken breast", readingF: 38, packageOk: true, receivedQty: -5, receivedUnit: "lb"), context: .nativeCook(cookId: nil))) { error in
            guard case .closedLoopError(let msg)? = error as? ReceivingWriteError else { return XCTFail("expected closedLoopError") }
            XCTAssertTrue(msg.contains("received_qty"))
        }
        try writeDB.pool.read { db in XCTAssertEqual(try count(db, "receiving_log"), 0) }
    }

    func testZeroQtyIs400() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", item: "chicken breast", readingF: 38, packageOk: true, receivedQty: 0, receivedUnit: "lb"), context: .nativeCook(cookId: nil))) { error in
            guard case .closedLoopError? = error as? ReceivingWriteError else { return XCTFail("expected closedLoopError") }
        }
        try writeDB.pool.read { db in XCTAssertEqual(try count(db, "receiving_log"), 0) }
    }

    func testTransactionalRollbackForcedInventoryFailureRollsBackReceivingAndAudit() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        try seedIngredientMaster(writeDB, "forced_rollback_chicken_breast")
        try seedVendorPrice(writeDB, vendor: "Shamrock", sku: "FORCED-ROLLBACK", ingredient: "forced rollback chicken breast", masterId: "forced_rollback_chicken_breast")

        try writeDB.pool.write { db in
            try db.execute(sql: """
                CREATE TEMP TRIGGER fail_forced_receiving_inventory_insert
                BEFORE INSERT ON inventory_updates
                WHEN NEW.item = 'forced rollback chicken breast'
                BEGIN
                  SELECT RAISE(ABORT, 'forced inventory update failure');
                END;
                """)
        }
        defer { try? writeDB.pool.write { db in try db.execute(sql: "DROP TRIGGER IF EXISTS fail_forced_receiving_inventory_insert") } }

        XCTAssertThrowsError(try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", item: "forced rollback chicken breast", readingF: 38, packageOk: true, receivedQty: 40, receivedUnit: "lb"), context: .nativeCook(cookId: nil)))
        try writeDB.pool.read { db in
            XCTAssertEqual(try count(db, "receiving_log"), 0)
            XCTAssertEqual(try count(db, "audit_events", entity: "receiving_log"), 0)
            XCTAssertEqual(try count(db, "audit_events", entity: "inventory_updates"), 0)
        }
    }

    func testHaccpRejectionPriorityRejectsEvenWithMalformedQty() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        // package_ok=false forces §3-202.15 reject; received_qty is also malformed.
        XCTAssertThrowsError(try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", item: "milk 2%", readingF: 38, packageOk: false, receivedQty: -5, receivedUnit: "gal"), context: .nativeCook(cookId: nil))) { error in
            let e = error as? ReceivingWriteError
            XCTAssertTrue(e?.needsRejectionNote == true)
            XCTAssertFalse(e?.needsCorrectiveAction == true)
            if case .needsRejectionNote(_, let citation)? = e { XCTAssertTrue(citation?.contains("§3-202.15") == true) } else { XCTFail() }
        }
        try writeDB.pool.read { db in XCTAssertEqual(try count(db, "receiving_log"), 0) }
    }

    func testHaccpTempRejectPriorityWithBadQty() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", item: "milk 2%", readingF: 50, packageOk: true, receivedQty: 0, receivedUnit: "gal"), context: .nativeCook(cookId: nil))) { error in
            XCTAssertTrue((error as? ReceivingWriteError)?.needsRejectionNote == true)
        }
        try writeDB.pool.read { db in XCTAssertEqual(try count(db, "receiving_log"), 0) }
    }

    func testAcceptWithNotePlusBadQtyStill400() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        XCTAssertThrowsError(try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", item: "milk 2%", readingF: 43, packageOk: true, correctiveAction: "pulled down in reach-in", receivedQty: -2, receivedUnit: "gal"), context: .nativeCook(cookId: nil))) { error in
            guard case .closedLoopError? = error as? ReceivingWriteError else { return XCTFail("expected closedLoopError") }
        }
        try writeDB.pool.read { db in XCTAssertEqual(try count(db, "receiving_log"), 0) }
    }

    func testPartialUniqueIndexPreventsDoubleCredit() throws {
        let (readDB, writeDB, path) = try makeRepos(); defer { cleanup(path) }
        let repo = ReceivingRepository(readDB: readDB, writeDB: writeDB)
        try seedIngredientMaster(writeDB, "chicken_breast_40lb_cs")
        try seedVendorPrice(writeDB, vendor: "Shamrock", sku: "CHX-40", ingredient: "chicken breast 40lb CS", masterId: "chicken_breast_40lb_cs")

        let r = try repo.record(input: ReceivingEntryInput(vendor: "Shamrock", category: "refrigerated", item: "chicken breast 40lb CS", readingF: 38, packageOk: true, receivedQty: 40, receivedUnit: "lb"), context: .nativeCook(cookId: nil))
        try writeDB.pool.read { db in XCTAssertEqual(try count(db, "inventory_updates"), 1) }

        let recvId = r.row.id
        XCTAssertThrowsError(try writeDB.pool.write { db in
            try db.execute(
                sql: """
                  INSERT INTO inventory_updates
                    (shift_date, location_id, item, delta, direction, note, cook_id, receiving_log_id)
                  VALUES (?, ?, ?, ?, 'in', ?, ?, ?)
                  """,
                arguments: [r.row.shiftDate, r.row.locationId, r.row.item, "40 lb", "duplicate credit attempt", nil, recvId]
            )
        }) { error in
            XCTAssertTrue(String(describing: error).lowercased().contains("unique"))
        }
        try writeDB.pool.read { db in XCTAssertEqual(try count(db, "inventory_updates"), 1) }
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private func isValidationFailed(_ error: Error) -> Bool {
        if case .validationFailed? = error as? ReceivingWriteError { return true }
        return false
    }

    private func count(_ db: Database, _ table: String, entity: String? = nil) throws -> Int {
        if let entity {
            return try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM \(table) WHERE entity = ?", arguments: [entity]) ?? 0
        }
        return try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM \(table)") ?? 0
    }

    private func seedIngredientMaster(_ writeDB: LariatWriteDatabase, _ masterId: String, canonicalName: String = "Chicken Breast") throws {
        try writeDB.pool.write { db in
            try db.execute(
                sql: """
                  INSERT INTO ingredient_masters (master_id, canonical_name, category, preferred_vendor, last_reviewed)
                  VALUES (?, ?, 'protein', 'shamrock', '2026-05-30')
                  """,
                arguments: [masterId, canonicalName]
            )
        }
    }

    private func seedVendorPrice(_ writeDB: LariatWriteDatabase, vendor: String, sku: String, ingredient: String, masterId: String, location: String = "default") throws {
        try writeDB.pool.write { db in
            try db.execute(
                sql: """
                  INSERT INTO vendor_prices
                    (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, master_id, location_id)
                  VALUES (?, ?, ?, 1, 'case', 10, 10, ?, ?)
                  """,
                arguments: [ingredient, vendor, sku, masterId, location]
            )
        }
    }

    private func makeRepos() throws -> (LariatDatabase, LariatWriteDatabase, String) {
        let path = try seedReceivingDatabase()
        let readDB = try LariatDatabase(path: path)
        let writeDB = try LariatWriteDatabase(path: path)
        return (readDB, writeDB, path)
    }

    private func cleanup(_ path: String) {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.removeItem(atPath: dir)
    }
}

private func seedReceivingDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-receiving-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path

    let dbQueue = try DatabaseQueue(path: path)
    try dbQueue.write { db in
        try db.execute(sql: """
            CREATE TABLE receiving_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              location_id TEXT DEFAULT 'default',
              vendor TEXT NOT NULL,
              invoice_ref TEXT,
              category TEXT NOT NULL,
              item TEXT,
              vendor_sku TEXT,
              master_id TEXT,
              match_status TEXT DEFAULT 'not_attempted',
              match_reason TEXT,
              reading_f REAL,
              required_max_f REAL,
              package_ok INTEGER,
              expiration_date TEXT,
              status TEXT NOT NULL
                CHECK(status IN ('accepted','rejected','accepted_with_note')),
              rejection_reason TEXT,
              shellstock_tag_ref TEXT,
              cook_id TEXT,
              received_qty REAL,
              received_unit TEXT,
              created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE inventory_updates (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              station_id TEXT,
              item TEXT NOT NULL,
              master_id TEXT,
              delta TEXT,
              direction TEXT,
              note TEXT,
              cook_id TEXT,
              created_at TEXT DEFAULT (datetime('now')),
              location_id TEXT DEFAULT 'default',
              receiving_log_id INTEGER REFERENCES receiving_log(id)
            );
            CREATE UNIQUE INDEX idx_inventory_updates_receiving_log_id
              ON inventory_updates(receiving_log_id)
              WHERE receiving_log_id IS NOT NULL;
            CREATE TABLE vendor_prices (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              ingredient TEXT NOT NULL,
              vendor TEXT,
              sku TEXT,
              pack_size REAL,
              pack_unit TEXT,
              pack_price REAL,
              unit_price REAL,
              category TEXT,
              location_id TEXT DEFAULT 'default',
              master_id TEXT,
              imported_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE ingredient_masters (
              master_id TEXT PRIMARY KEY,
              canonical_name TEXT NOT NULL,
              category TEXT,
              preferred_vendor TEXT,
              quality_locked INTEGER NOT NULL DEFAULT 0,
              quality_lock_reason TEXT,
              last_reviewed TEXT
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
    return path
}
