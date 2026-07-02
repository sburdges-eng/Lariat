import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Parity port of the LLM-action validation ladders:
///   tests/js/test-kitchen-assistant-action-hardening.mjs (all cases)
///   tests/js/test-kitchen-assistant-beo-add-prep-scope.mjs (all cases)
///   tests/js/test-kitchen-assistant-haccp-receiving-throw-path.mjs (contract)
///   tests/js/test-kitchen-assistant-undo.mjs §1/§6 (undo metadata presence)
/// against an on-disk GRDB fixture with the real web schema.
final class AssistantActionRepositoryTests: XCTestCase {
    private let LOC = "default"

    private func makeRepo(
        calculator: RecipeCalculating? = nil
    ) throws -> (AssistantActionRepository, LariatWriteDatabase, String) {
        let path = try seedAssistantDatabase()
        let writeDB = try LariatWriteDatabase(path: path)
        return (AssistantActionRepository(writeDB: writeDB, calculator: calculator), writeDB, path)
    }

    private func payload(_ action: String, _ fields: [String: AssistantJSONValue]) -> AssistantActionPayload {
        AssistantActionPayload(action: action, fields: fields)
    }

    private func count(_ writeDB: LariatWriteDatabase, _ table: String) throws -> Int {
        try inspect(writeDB) { db in
            try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM \(table)") ?? -1
        }
    }

    /// Sync read helper — keeps async test bodies on GRDB's sync `read`.
    private func inspect<T>(_ writeDB: LariatWriteDatabase, _ block: (Database) throws -> T) throws -> T {
        try writeDB.pool.read(block)
    }

    private func seedEquipment(_ writeDB: LariatWriteDatabase, _ name: String) throws {
        _ = try writeDB.write { db in
            try db.execute(
                sql: "INSERT INTO equipment (location_id, name, category) VALUES (?, ?, 'cooking')",
                arguments: [self.LOC, name]
            )
        }
    }

    private func seedEmployee(_ writeDB: LariatWriteDatabase, _ displayName: String, active: Int = 1) throws {
        _ = try writeDB.write { db in
            try db.execute(
                sql: "INSERT INTO entities_employees (uuid, display_name, active) VALUES (?, ?, ?)",
                arguments: ["uuid-\(displayName)", displayName, active]
            )
        }
    }

    // ── PIN defense-in-depth ────────────────────────────────────────

    func testWriteActionsBlockedWithoutPin() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        let out = try await repo.execute(
            payload: payload("eighty_six", ["item": .string("salmon")]),
            hasPin: false, locationId: LOC
        )
        XCTAssertTrue(out.actionExecuted)
        XCTAssertTrue(out.actionMsg.contains("manager PIN required"))
        XCTAssertEqual(try count(writeDB, "eighty_six"), 0)
        XCTAssertEqual(try count(writeDB, "audit_events"), 0)
    }

    // ── eighty_six ──────────────────────────────────────────────────

    func testEightySixWritesRowAuditAndUndoMeta() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        let t0 = Date()
        let out = try await repo.execute(
            payload: payload("eighty_six", ["item": .string("salmon"), "reason": .string("sold out")]),
            hasPin: true, locationId: LOC
        )
        let t1 = Date()

        XCTAssertTrue(out.actionExecuted)
        XCTAssertEqual(out.actionMsg, "Marked salmon as 86'd.")
        try inspect(writeDB) { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM eighty_six")!
            XCTAssertEqual(row["item"], "salmon")
            XCTAssertEqual(row["reason"], "sold out")
            XCTAssertNil(row["resolved_at"] as String?)
            let audit = try Row.fetchOne(db, sql: "SELECT * FROM audit_events WHERE entity='eighty_six'")!
            XCTAssertEqual(audit["action"], "insert")
            XCTAssertEqual(audit["actor_source"], "kitchen_assistant",
                           "web literal — load-bearing for undo eligibility")
            XCTAssertEqual(audit["entity_id"] as Int64?, row["id"] as Int64?)
        }
        // undo metadata: audit + entity ids, 30s expiry window
        let undo = try XCTUnwrap(out.undo)
        XCTAssertEqual(undo.entity, .eightySix)
        XCTAssertGreaterThan(undo.entityId, 0)
        XCTAssertEqual(undo.label, "Marked salmon as 86'd.")
        let expires = try XCTUnwrap(LariConversationMemoryCompute.parseIsoDate(undo.expiresAt))
        XCTAssertGreaterThanOrEqual(expires.timeIntervalSince1970 + 0.001, t0.timeIntervalSince1970 + 30)
        XCTAssertLessThanOrEqual(expires.timeIntervalSince1970, t1.timeIntervalSince1970 + 30 + 0.001)
    }

    func testEightySixDefaultsReasonToAiUpdate() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        _ = try await repo.execute(
            payload: payload("eighty_six", ["item": .string("brisket")]),
            hasPin: true, locationId: LOC
        )
        try inspect(writeDB) { db in
            XCTAssertEqual(try String.fetchOne(db, sql: "SELECT reason FROM eighty_six"), "AI Update")
        }
    }

    // ── update_inventory hardening ──────────────────────────────────

    func testUpdateInventoryRejectsNonNumericDelta() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        let out = try await repo.execute(
            payload: payload("update_inventory", [
                "item": .string("cilantro"), "delta": .string("5 lbs"), "direction": .string("out"),
            ]),
            hasPin: true, locationId: LOC
        )
        XCTAssertTrue(out.actionExecuted, "soft-reject pattern: handled + blocked message")
        XCTAssertTrue(out.actionMsg.lowercased().contains("update blocked"))
        XCTAssertTrue(out.actionMsg.contains("\"5 lbs\""))
        XCTAssertEqual(try count(writeDB, "inventory_updates"), 0, "no inventory_updates row landed")
        XCTAssertNil(out.undo)
    }

    func testUpdateInventoryAcceptsFiniteDelta() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        let out = try await repo.execute(
            payload: payload("update_inventory", [
                "item": .string("cilantro"), "delta": .number(3),
                "unit": .string("bunch"), "direction": .string("out"),
            ]),
            hasPin: true, locationId: LOC
        )
        XCTAssertEqual(try count(writeDB, "inventory_updates"), 1)
        try inspect(writeDB) { db in
            XCTAssertEqual(try String.fetchOne(db, sql: "SELECT delta FROM inventory_updates"), "3 bunch")
        }
        XCTAssertEqual(out.undo?.entity, .inventoryUpdates)
    }

    // ── update_order_guide hardening ────────────────────────────────

    func testUpdateOrderGuideRejectsNonNumericQty() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        let out = try await repo.execute(
            payload: payload("update_order_guide", [
                "item": .string("shallots"), "qty": .string("5 lbs"), "unit": .string("lb"),
            ]),
            hasPin: true, locationId: LOC
        )
        XCTAssertTrue(out.actionMsg.lowercased().contains("update blocked"))
        XCTAssertEqual(try count(writeDB, "order_guide_items"), 0)
    }

    func testUpdateOrderGuideRejectsZeroQty() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        _ = try await repo.execute(
            payload: payload("update_order_guide", ["item": .string("shallots"), "qty": .number(0)]),
            hasPin: true, locationId: LOC
        )
        XCTAssertEqual(try count(writeDB, "order_guide_items"), 0)
    }

    func testUpdateOrderGuideAcceptsPositiveQty() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        let out = try await repo.execute(
            payload: payload("update_order_guide", [
                "item": .string("shallots"), "qty": .number(5), "unit": .string("lb"),
            ]),
            hasPin: true, locationId: LOC
        )
        try inspect(writeDB) { db in
            let row = try Row.fetchOne(db, sql: "SELECT base_qty, unit FROM order_guide_items")!
            XCTAssertEqual(row["base_qty"], 5.0)
            XCTAssertEqual(row["unit"], "lb")
        }
        XCTAssertEqual(out.undo?.entity, .orderGuideItems)
    }

    // ── maintenance LIKE partial match ──────────────────────────────

    func testMaintenanceMatchesEquipmentNameAsSubstring() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        try seedEquipment(writeDB, "Henny Penny Pressure Fryer")
        let out = try await repo.execute(
            payload: payload("maintenance", [
                "equipment": .string("Pressure Fryer"), "issue": .string("oil temp not reaching set point"),
            ]),
            hasPin: true, locationId: LOC
        )
        XCTAssertEqual(try count(writeDB, "equipment_maintenance"), 1, "row landed via partial match")
        try inspect(writeDB) { db in
            let notes = try String.fetchOne(db, sql: "SELECT notes FROM equipment_maintenance")
            XCTAssertTrue(notes?.lowercased().contains("oil temp") == true)
        }
        XCTAssertEqual(out.undo?.entity, .equipmentMaintenance)
    }

    func testMaintenanceSoftRejectsWhenNoEquipmentMatches() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        let out = try await repo.execute(
            payload: payload("maintenance", [
                "equipment": .string("imaginary widget"), "issue": .string("broken"),
            ]),
            hasPin: true, locationId: LOC
        )
        XCTAssertTrue(out.actionMsg.lowercased().contains("could not find equipment"))
        XCTAssertEqual(try count(writeDB, "equipment_maintenance"), 0)
    }

    // ── give_gold_star roster + stars guards ────────────────────────

    func testGoldStarRejectsUnknownCook() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        try seedEmployee(writeDB, "Alice")
        try seedEmployee(writeDB, "Bob")
        let out = try await repo.execute(
            payload: payload("give_gold_star", [
                "cook_name": .string("Chuck"), "stars": .number(2), "reason": .string("invented by the model"),
            ]),
            hasPin: true, locationId: LOC
        )
        XCTAssertTrue(out.actionMsg.lowercased().contains("not on the active roster"))
        XCTAssertEqual(try count(writeDB, "gold_stars"), 0)
    }

    func testGoldStarAcceptsRosterMatchCaseInsensitive() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        try seedEmployee(writeDB, "Alice")
        let out = try await repo.execute(
            payload: payload("give_gold_star", [
                "cook_name": .string("alice"), "stars": .number(1), "reason": .string("crushed Saturday brunch"),
            ]),
            hasPin: true, locationId: LOC
        )
        XCTAssertEqual(try count(writeDB, "gold_stars"), 1)
        try inspect(writeDB) { db in
            XCTAssertEqual(
                try String.fetchOne(db, sql: "SELECT cook_name FROM gold_stars"), "alice",
                "stored as the LLM emitted it (clipped)"
            )
        }
        XCTAssertEqual(out.undo?.entity, .goldStars)
    }

    func testGoldStarRejectsInactiveRosterMember() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        try seedEmployee(writeDB, "Alice")
        try seedEmployee(writeDB, "Carol", active: 0)
        let out = try await repo.execute(
            payload: payload("give_gold_star", ["cook_name": .string("Carol"), "stars": .number(1)]),
            hasPin: true, locationId: LOC
        )
        XCTAssertTrue(out.actionMsg.lowercased().contains("not on the active roster"))
        XCTAssertEqual(try count(writeDB, "gold_stars"), 0)
    }

    func testGoldStarAllowsThroughWhenRosterEmpty() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        _ = try await repo.execute(
            payload: payload("give_gold_star", ["cook_name": .string("Whoever"), "stars": .number(1)]),
            hasPin: true, locationId: LOC
        )
        XCTAssertEqual(try count(writeDB, "gold_stars"), 1, "fresh-DB fallback wrote the recognition row")
    }

    func testGoldStarRejectsNullStars() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        try seedEmployee(writeDB, "Alice")
        let out = try await repo.execute(
            payload: payload("give_gold_star", [
                "cook_name": .string("Alice"), "stars": .null, "reason": .string("crushed Saturday brunch"),
            ]),
            hasPin: true, locationId: LOC
        )
        // JS Number(null) = 0 → < 1 → reject (pre-fix coerced to 1 silently).
        XCTAssertTrue(out.actionMsg.lowercased().contains("must be a number"))
        XCTAssertEqual(try count(writeDB, "gold_stars"), 0)
    }

    func testGoldStarRejectsNonNumericStringStars() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        try seedEmployee(writeDB, "Alice")
        let out = try await repo.execute(
            payload: payload("give_gold_star", [
                "cook_name": .string("Alice"), "stars": .string("three"),
            ]),
            hasPin: true, locationId: LOC
        )
        XCTAssertTrue(out.actionMsg.lowercased().contains("must be a number"))
        XCTAssertEqual(try count(writeDB, "gold_stars"), 0)
    }

    func testGoldStarClampsStarsToThree() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        _ = try await repo.execute(
            payload: payload("give_gold_star", ["cook_name": .string("Alice"), "stars": .number(9)]),
            hasPin: true, locationId: LOC
        )
        try inspect(writeDB) { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT stars FROM gold_stars"), 3)
        }
    }

    // ── line_check reading_f type guard ─────────────────────────────

    func testLineCheckObjectReadingDoesNotTripValidateTempBranch() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        let out = try await repo.execute(
            payload: payload("line_check", [
                "station": .string("grill"),
                "item": .string("walk-in cooler probe"),
                "reading_f": .object(["foo": .number(1)]),   // garbage object payload
                "temp_point_id": .string("walk_in_cooler"),
            ]),
            hasPin: true, locationId: LOC
        )
        XCTAssertTrue(out.actionExecuted, "must not crash on garbage reading_f")
        XCTAssertEqual(try count(writeDB, "line_check_entries"), 1, "row still writes")
        try inspect(writeDB) { db in
            let row = try Row.fetchOne(db, sql: "SELECT status, item FROM line_check_entries")!
            XCTAssertEqual(row["status"], "na", "no usable reading → no validate-temp branch")
            XCTAssertEqual(row["item"], "walk-in cooler probe")
        }
    }

    func testLineCheckServerComputesPassFromTempPoint() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        // walk_in_cooler requires <= 41F — 38 passes; the LLM's status is ignored.
        let out = try await repo.execute(
            payload: payload("line_check", [
                "station": .string("grill"),
                "item": .string("walk-in"),
                "reading_f": .number(38),
                "temp_point_id": .string("walk_in_cooler"),
                "status": .string("fail"),
            ]),
            hasPin: true, locationId: LOC
        )
        try inspect(writeDB) { db in
            XCTAssertEqual(try String.fetchOne(db, sql: "SELECT status FROM line_check_entries"), "pass")
        }
        XCTAssertTrue(out.actionMsg.contains("at 38°F"))
        XCTAssertTrue(out.actionMsg.contains("(pass)"))
    }

    func testLineCheckUnknownTempPointFallsBackToUnvalidatedNa() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        _ = try await repo.execute(
            payload: payload("line_check", [
                "station": .string("grill"),
                "item": .string("mystery probe"),
                "reading_f": .number(50),
                "temp_point_id": .string("not_a_point"),
            ]),
            hasPin: true, locationId: LOC
        )
        try inspect(writeDB) { db in
            let row = try Row.fetchOne(db, sql: "SELECT status, note FROM line_check_entries")!
            XCTAssertEqual(row["status"], "na")
            XCTAssertTrue((row["note"] as String? ?? "").contains("[Unvalidated Temp: 50°F]"))
        }
    }

    // ── action-engine exception surfaces (CHECK-constraint path) ────

    func testHandlerExceptionRollsBackAndPropagates() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        // status CHECK(status IN ('pass','fail','na')) → INSERT throws inside
        // the transaction; the engine maps this to actionError + generic copy.
        do {
            _ = try await repo.execute(
                payload: payload("line_check", [
                    "station": .string("grill"),
                    "item": .string("walk-in cooler probe"),
                    "status": .string("INVALID_STATUS"),
                ]),
                hasPin: true, locationId: LOC
            )
            XCTFail("expected the CHECK-constraint violation to propagate")
        } catch {
            // expected
        }
        XCTAssertEqual(try count(writeDB, "line_check_entries"), 0, "transaction rolled back; no row")
        XCTAssertEqual(try count(writeDB, "audit_events"), 0, "audit row rolled back with the source row")
    }

    // ── beo_add_prep cross-location guard ───────────────────────────

    private func seedEvent(_ writeDB: LariatWriteDatabase, location: String, title: String, guests: Int = 50) throws -> Int64 {
        try writeDB.write { db in
            try db.execute(
                sql: "INSERT INTO beo_events (title, event_date, guest_count, location_id) VALUES (?, '2026-08-15', ?, ?)",
                arguments: [title, guests, location]
            )
            return db.lastInsertedRowID
        }
    }

    private func beoPrepPayload(eventId: Int64) -> AssistantActionPayload {
        payload("beo_add_prep", [
            "event_id": .number(Double(eventId)),
            "tasks": .array([.string("Slice 5 lb of onions"), .string("Portion 60 brisket plates")]),
        ])
    }

    func testBeoAddPrepRejectsForeignLocationEvent() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        let eventA = try seedEvent(writeDB, location: "site-a", title: "Site A Wedding")

        let out = try await repo.execute(
            payload: beoPrepPayload(eventId: eventA),
            hasPin: true, locationId: "site-b"
        )
        XCTAssertTrue(out.actionExecuted, "soft-reject pattern")
        XCTAssertTrue(out.actionMsg.lowercased().contains("blocked"))
        XCTAssertTrue(out.actionMsg.lowercased().contains("different location")
                      || out.actionMsg.lowercased().contains("cross-location"))
        XCTAssertEqual(try count(writeDB, "beo_prep_tasks"), 0,
                       "cross-location beo_add_prep MUST NOT insert into beo_prep_tasks")
    }

    func testBeoAddPrepRejectsUnknownEventId() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        _ = try seedEvent(writeDB, location: "site-a", title: "Site A Wedding")

        let out = try await repo.execute(
            payload: beoPrepPayload(eventId: 999_999),
            hasPin: true, locationId: "site-a"
        )
        XCTAssertTrue(out.actionMsg.lowercased().contains("blocked"))
        XCTAssertTrue(out.actionMsg.lowercased().contains("does not exist"))
        XCTAssertEqual(try count(writeDB, "beo_prep_tasks"), 0)
    }

    func testBeoAddPrepHappyPathInsertsWithRequestingLocation() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        let eventA = try seedEvent(writeDB, location: "site-a", title: "Site A Wedding")

        let out = try await repo.execute(
            payload: beoPrepPayload(eventId: eventA),
            hasPin: true, locationId: "site-a"
        )
        try inspect(writeDB) { db in
            let rows = try Row.fetchAll(
                db, sql: "SELECT location_id, event_id, task FROM beo_prep_tasks WHERE event_id = ? ORDER BY id",
                arguments: [eventA]
            )
            XCTAssertEqual(rows.count, 2, "both tasks land for a same-location request")
            for r in rows {
                XCTAssertEqual(r["location_id"], "site-a")
                XCTAssertEqual(r["event_id"] as Int64?, eventA)
            }
        }
        XCTAssertTrue(out.actionMsg.contains("Added 2 scaled side-prep tasks to BEO ID \(eventA)."))
        XCTAssertNil(out.undo, "batch actions never offer undo")
    }

    func testBeoAddPrepUsesCalculatorWhenRecipesSupplied() async throws {
        let calc = StubRecipeCalculator()
        calc.beoResult = .success([
            RecipeExpandResult(
                recipeSlug: "focaccia", targetQty: 50, targetUnit: "portion", scaleFactor: 2,
                leafRows: [RecipeLeafRow(ingredient: "flour", qty: 10, unit: "lb")]
            ),
        ])
        let (repo, writeDB, path) = try makeRepo(calculator: calc)
        defer { cleanupAssistantDatabase(path) }
        let eventA = try seedEvent(writeDB, location: LOC, title: "Wedding", guests: 50)

        let out = try await repo.execute(
            payload: payload("beo_add_prep", [
                "event_id": .number(Double(eventA)),
                "tasks": .array([.string("model task — must be discarded")]),
                "recipes": .array([.object([
                    "recipe_slug": .string("focaccia"), "portions_per_guest": .number(1),
                ])]),
            ]),
            hasPin: true, locationId: LOC
        )
        XCTAssertEqual(calc.beoCalls.count, 1)
        XCTAssertEqual(calc.beoCalls.first?.guestCount, 50)
        try inspect(writeDB) { db in
            let tasks = try String.fetchAll(db, sql: "SELECT task FROM beo_prep_tasks ORDER BY id")
            XCTAssertEqual(tasks, ["[focaccia] 10 lb flour"], "calculator output replaces model tasks")
        }
        XCTAssertTrue(out.actionMsg.contains("calculator-scaled"))
        XCTAssertTrue(out.actionMsg.contains("Calculator produced 1 scaled prep lines for 50 guests."))
    }

    func testBeoAddPrepCalculatorErrorFallsBackToModelTasks() async throws {
        let calc = StubRecipeCalculator()
        calc.beoResult = .failure(RecipeCalculatorError("recipe not found", code: "cli_error"))
        let (repo, writeDB, path) = try makeRepo(calculator: calc)
        defer { cleanupAssistantDatabase(path) }
        let eventA = try seedEvent(writeDB, location: LOC, title: "Wedding", guests: 50)

        let out = try await repo.execute(
            payload: payload("beo_add_prep", [
                "event_id": .number(Double(eventA)),
                "tasks": .array([.string("Sheet trays of focaccia")]),
                "recipes": .array([.object(["recipe_slug": .string("ghost"), "portions_per_guest": .number(1)])]),
            ]),
            hasPin: true, locationId: LOC
        )
        try inspect(writeDB) { db in
            let tasks = try String.fetchAll(db, sql: "SELECT task FROM beo_prep_tasks")
            XCTAssertEqual(tasks, ["Sheet trays of focaccia"], "model tasks are the fallback")
        }
        XCTAssertTrue(out.actionMsg.contains("Calculator error (cli_error): recipe not found. Falling back to model-provided tasks."))
    }

    // ── scale_recipe ────────────────────────────────────────────────

    func testScaleRecipeRejectsNonPositiveMultiplier() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        let out = try await repo.execute(
            payload: payload("scale_recipe", ["recipe": .string("focaccia"), "multiplier": .number(0)]),
            hasPin: true, locationId: LOC
        )
        XCTAssertTrue(out.actionExecuted)
        XCTAssertTrue(out.actionMsg.contains("Scale Recipe blocked — multiplier 0 is not a positive number."))
        XCTAssertNil(out.undo, "scale_recipe never offers undo")
        XCTAssertEqual(try count(writeDB, "line_check_entries"), 0)
    }

    func testScaleRecipeInsertsCalculatorLeavesAtomicallyWithAudit() async throws {
        let calc = StubRecipeCalculator()
        calc.scaleResult = .success(RecipeExpandResult(
            recipeSlug: "focaccia", targetQty: 6, targetUnit: "sheet", scaleFactor: 2,
            leafRows: [
                RecipeLeafRow(ingredient: "flour", qty: 10, unit: "lb"),
                RecipeLeafRow(ingredient: "olive oil", qty: 0.5, unit: "qt"),
            ]
        ))
        let (repo, writeDB, path) = try makeRepo(calculator: calc)
        defer { cleanupAssistantDatabase(path) }

        let out = try await repo.execute(
            payload: payload("scale_recipe", ["recipe": .string("focaccia"), "multiplier": .number(2)]),
            hasPin: true, locationId: LOC
        )
        XCTAssertEqual(calc.scaleCalls.first?.multiplier, 2)
        try inspect(writeDB) { db in
            let rows = try Row.fetchAll(db, sql: "SELECT station_id, item, status, need FROM line_check_entries ORDER BY id")
            XCTAssertEqual(rows.count, 2)
            XCTAssertEqual(rows[0]["station_id"], "scaled:focaccia")
            XCTAssertEqual(rows[0]["item"], "flour")
            XCTAssertEqual(rows[0]["need"], "10 lb")
            XCTAssertEqual(rows[1]["need"], "0.5 qt")
            let audit = try Row.fetchOne(db, sql: "SELECT * FROM audit_events WHERE note LIKE 'scale_recipe%'")!
            XCTAssertEqual(audit["entity"], "line_check_entries")
            XCTAssertTrue((audit["payload_json"] as String? ?? "").contains("\"leafCount\":2"))
        }
        XCTAssertTrue(out.actionMsg.contains("Scaled focaccia to 6 sheet (×2). 2 ingredient lines — values from deterministic calculator."))
    }

    func testScaleRecipeCalculatorErrorSurfacesCode() async throws {
        let calc = StubRecipeCalculator()
        calc.scaleResult = .failure(RecipeCalculatorError("boom", code: "timeout"))
        let (repo, writeDB, path) = try makeRepo(calculator: calc)
        defer { cleanupAssistantDatabase(path) }
        let out = try await repo.execute(
            payload: payload("scale_recipe", ["recipe": .string("focaccia"), "multiplier": .number(2)]),
            hasPin: true, locationId: LOC
        )
        XCTAssertEqual(out.actionMsg, "Scale Recipe failed (timeout): boom")
        XCTAssertEqual(try count(writeDB, "line_check_entries"), 0)
    }

    // ── generate_prep ───────────────────────────────────────────────

    func testGeneratePrepInsertsModelTasksWithoutRecipes() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        let out = try await repo.execute(
            payload: payload("generate_prep", [
                "station": .string("grill"),
                "tasks": .array([
                    .object(["item": .string("dice onions"), "need": .string("2 qt")]),
                    .object(["item": .string("pickle shallots"), "need": .string("1 qt")]),
                ]),
            ]),
            hasPin: true, locationId: LOC
        )
        XCTAssertEqual(try count(writeDB, "line_check_entries"), 2, "prep rows landed — success path")
        XCTAssertNil(out.undo, "no undo metadata for generate_prep")
        XCTAssertTrue(out.actionMsg.contains("Generated 2 dynamic prep tasks for grill."))
    }

    func testGeneratePrepSwapsCalculatorLeavesPerRecipeTask() async throws {
        let calc = StubRecipeCalculator()
        calc.scaleResult = .success(RecipeExpandResult(
            recipeSlug: "brine", targetQty: 4, targetUnit: "gal", scaleFactor: 2,
            leafRows: [RecipeLeafRow(ingredient: "salt", qty: 2, unit: "lb")]
        ))
        let (repo, writeDB, path) = try makeRepo(calculator: calc)
        defer { cleanupAssistantDatabase(path) }
        let out = try await repo.execute(
            payload: payload("generate_prep", [
                "station": .string("prep"),
                "tasks": .array([
                    .object(["item": .string("brine"), "recipe_slug": .string("brine"), "multiplier": .number(2)]),
                    .object(["item": .string("hand task"), "need": .string("1 ea")]),
                ]),
            ]),
            hasPin: true, locationId: LOC
        )
        try inspect(writeDB) { db in
            let items = try String.fetchAll(db, sql: "SELECT item FROM line_check_entries ORDER BY id")
            XCTAssertEqual(items, ["salt", "hand task"])
        }
        XCTAssertTrue(out.actionMsg.contains("(1 scaled by calculator)"))
    }

    // ── haccp_receive validator + throw path ────────────────────────

    func testHaccpReceiveColdOverTempFails() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        // refrigerated over 41F → rejected → status 'fail' (server validates,
        // never the model).
        let out = try await repo.execute(
            payload: payload("haccp_receive", [
                "item": .string("chicken"), "category": .string("refrigerated"),
                "reading_f": .number(50), "package_ok": .bool(true),
            ]),
            hasPin: true, locationId: LOC
        )
        try inspect(writeDB) { db in
            let row = try Row.fetchOne(db, sql: "SELECT station_id, status, note FROM line_check_entries")!
            XCTAssertEqual(row["station_id"], "haccp_receiving")
            XCTAssertEqual(row["status"], "fail")
            XCTAssertNotNil(row["note"] as String?, "rejection reason rides in the note")
        }
        XCTAssertTrue(out.actionMsg.contains("(fail)"))
        XCTAssertEqual(out.undo?.entity, .lineCheckEntries)
    }

    func testHaccpReceiveInRangePasses() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        let out = try await repo.execute(
            payload: payload("haccp_receive", [
                "item": .string("chicken"), "category": .string("refrigerated"),
                "reading_f": .number(38), "package_ok": .bool(true),
            ]),
            hasPin: true, locationId: LOC
        )
        try inspect(writeDB) { db in
            XCTAssertEqual(try String.fetchOne(db, sql: "SELECT status FROM line_check_entries"), "pass")
        }
        XCTAssertTrue(out.actionMsg.contains("(pass)"))
    }

    func testHaccpValidatorThrowMapsToFailNeverNa() throws {
        // The 2026-05-01 breaker-audit contract: a thrown validator is a HACCP
        // signal a manager must see — status='fail' (red marker), NEVER 'na'.
        let (repo, _, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        struct Boom: Error, LocalizedError { var errorDescription: String? { "validator exploded" } }
        let out = repo.haccpStatusAndNote(
            category: "refrigerated", readingF: 38, packageOk: true, note: "supplier note",
            validator: { _ in throw Boom() }
        )
        XCTAssertEqual(out.status, "fail")
        XCTAssertTrue(out.note?.contains("[Validation Error: validator exploded]") == true,
                      "validator error preserved in the note for manager triage")
        XCTAssertNotEqual(out.status, "na")
    }

    // ── unknown action ──────────────────────────────────────────────

    func testUnknownActionIsUnhandled() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        let out = try await repo.execute(
            payload: payload("launch_rockets", ["target": .string("moon")]),
            hasPin: true, locationId: LOC
        )
        XCTAssertEqual(out, .init(actionExecuted: false, actionMsg: "", undo: nil))
        XCTAssertEqual(try count(writeDB, "audit_events"), 0)
    }

    func testGuardFieldMissingIsUnhandled() async throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        // eighty_six with no item — web's `payload.item` truthy guard fails and
        // no branch runs.
        let out = try await repo.execute(
            payload: payload("eighty_six", [:]),
            hasPin: true, locationId: LOC
        )
        XCTAssertFalse(out.actionExecuted)
        XCTAssertEqual(try count(writeDB, "eighty_six"), 0)
    }
}
