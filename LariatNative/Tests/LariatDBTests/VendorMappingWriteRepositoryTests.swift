import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Behavior-parity port of `lib/vendorMappingRepo.ts` (`pairCatalogRows`,
/// `attachCatalogRow`). Parity oracles: `tests/js/test-vendor-mapping-repo.mjs`
/// (3 cases) + `tests/js/test-vendor-mapping-api.mjs` (3 cases, adapted to
/// repository level — native has no HTTP layer, so the routes' 200 bodies map
/// to return values and their error statuses map to `VendorMappingWriteError`).
///
/// DIVERGENCES asserted here (deliberate, per plan):
///   • actor_source = 'native_mac' (web default 'manager_ui')
///   • typed errors instead of HTTP 422/409/404
final class VendorMappingWriteRepositoryTests: XCTestCase {

    private func macContext(locationId: String = "default") -> RegulatedWriteContext {
        RegulatedWriteContext(
            actorCookId: "cook-x",
            actorSource: RegulatedWriteContext.nativeMacActorSource,
            locationId: locationId,
            shiftDate: "2026-07-02"
        )
    }

    // ── seed helpers (mirror test-vendor-mapping-repo.mjs L21-30) ────────

    private func seedUnlinkedPair(_ db: Database) throws {
        try db.execute(sql: """
            INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, unit_price, location_id)
            VALUES ('CHICKEN BREAST B/S', 'Sysco', 'S123', 1, 'lb', 4.2, 'default');
            INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, unit_price, location_id)
            VALUES ('CHICKEN BRST BNLS', 'Shamrock', 'H456', 1, 'lb', 3.9, 'default');
            """)
    }

    private func seedSingleVendorAvocado(_ db: Database) throws {
        try db.execute(sql: """
            INSERT INTO ingredient_masters (master_id, canonical_name) VALUES ('avocado', 'Avocado');
            INSERT INTO vendor_prices (ingredient, vendor, sku, location_id, master_id, pack_size, pack_unit, unit_price)
            VALUES ('Avocado', 'Sysco', 'S1', 'default', 'avocado', 1, 'each', 1.5);
            INSERT INTO vendor_prices (ingredient, vendor, sku, location_id, pack_size, pack_unit, unit_price)
            VALUES ('Avocado Hass', 'Shamrock', 'H1', 'default', 1, 'each', 1.4);
            """)
    }

    private let chickenPair = PairCatalogInput(
        syscoKey: CatalogKey(vendor: "sysco", sku: "S123", ingredient: "CHICKEN BREAST B/S"),
        shamrockKey: CatalogKey(vendor: "shamrock", sku: "H456", ingredient: "CHICKEN BRST BNLS"),
        canonicalName: "Chicken Breast"
    )

    private func assertNothingWritten(_ f: PurchasingFixture, file: StaticString = #filePath, line: UInt = #line) throws {
        try f.writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? -1, 0, "no audit rows", file: file, line: line)
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM ingredient_maps") ?? -1, 0, "no maps", file: file, line: line)
        }
    }

    // ── Oracle repo 1: 'pair creates master maps and VP links with audit' ─

    func testPairCreatesMasterMapsAndVpLinksWithAudit() throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { try self.seedUnlinkedPair($0) }
        let repo = VendorMappingWriteRepository(readDB: f.readDB, writeDB: f.writeDB)

        let masterId = try repo.pairCatalogRows(chickenPair, context: macContext())
        XCTAssertEqual(masterId, "chicken_breast")

        try f.writeDB.pool.read { db in
            let maps = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM ingredient_maps WHERE status = 'confirmed'") ?? -1
            XCTAssertEqual(maps, 2)
            let vp = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM vendor_prices WHERE master_id = 'chicken_breast'") ?? -1
            XCTAssertEqual(vp, 2)
            let master = try String.fetchOne(db, sql: "SELECT canonical_name FROM ingredient_masters WHERE master_id = 'chicken_breast'")
            XCTAssertEqual(master, "Chicken Breast")

            // Web oracle asserts audits >= 3; we tighten to the EXACT web
            // emission: 4 events (masters, 2× maps, vendor_prices), all
            // action='correction'.
            let audits = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? -1
            XCTAssertEqual(audits, 4)
            let entities = try String.fetchAll(db, sql: "SELECT entity FROM audit_events ORDER BY id")
            XCTAssertEqual(entities, ["ingredient_masters", "ingredient_maps", "ingredient_maps", "vendor_prices"])
            let actions = Set(try String.fetchAll(db, sql: "SELECT DISTINCT action FROM audit_events"))
            XCTAssertEqual(actions, ["correction"])

            // DIVERGENCE: actor_source native_mac (web 'manager_ui').
            let sources = Set(try String.fetchAll(db, sql: "SELECT DISTINCT actor_source FROM audit_events"))
            XCTAssertEqual(sources, ["native_mac"])
            let cook = Set(try String.fetchAll(db, sql: "SELECT DISTINCT actor_cook_id FROM audit_events"))
            XCTAssertEqual(cook, ["cook-x"])
            let locs = Set(try String.fetchAll(db, sql: "SELECT DISTINCT location_id FROM audit_events"))
            XCTAssertEqual(locs, ["default"])
            let shifts = Set(try String.fetchAll(db, sql: "SELECT DISTINCT shift_date FROM audit_events"))
            XCTAssertEqual(shifts, ["2026-07-02"])

            // Payload shapes (snake_case, op tag) — web postAuditEvent parity.
            let masterPayload = try String.fetchOne(db, sql: "SELECT payload_json FROM audit_events WHERE entity='ingredient_masters'") ?? ""
            XCTAssertTrue(masterPayload.contains("\"master_id\":\"chicken_breast\""), masterPayload)
            XCTAssertTrue(masterPayload.contains("\"canonical_name\":\"Chicken Breast\""), masterPayload)
            XCTAssertTrue(masterPayload.contains("\"op\":\"vendor_link_pair\""), masterPayload)
            let vpPayload = try String.fetchOne(db, sql: "SELECT payload_json FROM audit_events WHERE entity='vendor_prices'") ?? ""
            XCTAssertTrue(vpPayload.contains("\"sysco_sku\":\"S123\""), vpPayload)
            XCTAssertTrue(vpPayload.contains("\"shamrock_sku\":\"H456\""), vpPayload)
            let mapPayload = try String.fetchOne(db, sql: "SELECT payload_json FROM audit_events WHERE entity='ingredient_maps' ORDER BY id LIMIT 1") ?? ""
            XCTAssertTrue(mapPayload.contains("\"recipe_ingredient\":\"Chicken Breast\""), mapPayload)
            XCTAssertTrue(mapPayload.contains("\"vendor_ingredient\":\"CHICKEN BREAST B\\/S\"") || mapPayload.contains("\"vendor_ingredient\":\"CHICKEN BREAST B/S\""), mapPayload)
            XCTAssertTrue(mapPayload.contains("\"status\":\"confirmed\""), mapPayload)

            // entity_id NULL on every event (web passes entity_id: null).
            let nonNullIds = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events WHERE entity_id IS NOT NULL") ?? -1
            XCTAssertEqual(nonNullIds, 0)
        }
    }

    // ── Oracle repo 2: 'attach adds missing vendor' ──────────────────────

    func testAttachAddsMissingVendor() throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { try self.seedSingleVendorAvocado($0) }
        let repo = VendorMappingWriteRepository(readDB: f.readDB, writeDB: f.writeDB)

        let masterId = try repo.attachCatalogRow(
            AttachCatalogInput(
                masterId: "avocado",
                catalogKey: CatalogKey(vendor: "shamrock", sku: "H1", ingredient: "Avocado Hass")
            ),
            context: macContext()
        )
        XCTAssertEqual(masterId, "avocado")

        try f.writeDB.pool.read { db in
            let linked = try String.fetchOne(db, sql: "SELECT master_id FROM vendor_prices WHERE sku = 'H1'")
            XCTAssertEqual(linked, "avocado")
            // Exactly the web's 2 audit events: ingredient_maps + vendor_prices.
            let entities = try String.fetchAll(db, sql: "SELECT entity FROM audit_events ORDER BY id")
            XCTAssertEqual(entities, ["ingredient_maps", "vendor_prices"])
            let vpPayload = try String.fetchOne(db, sql: "SELECT payload_json FROM audit_events WHERE entity='vendor_prices'") ?? ""
            XCTAssertTrue(vpPayload.contains("\"op\":\"vendor_link_attach\""), vpPayload)
            XCTAssertTrue(vpPayload.contains("\"vendor\":\"shamrock\""), vpPayload)
            XCTAssertTrue(vpPayload.contains("\"sku\":\"H1\""), vpPayload)
            // The confirmed map uses the master's canonical name.
            let map = try Row.fetchOne(db, sql: "SELECT recipe_ingredient, vendor_ingredient, status FROM ingredient_maps")
            XCTAssertEqual(map?["recipe_ingredient"], "Avocado")
            XCTAssertEqual(map?["vendor_ingredient"], "Avocado Hass")
            XCTAssertEqual(map?["status"], "confirmed")
        }
    }

    // ── Oracle repo 3: 'rejects attach when catalog already linked elsewhere' ─

    func testAttachRejectsWhenLinkedElsewhere() throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { db in
            try db.execute(sql: """
                INSERT INTO ingredient_masters (master_id, canonical_name) VALUES ('avocado', 'Avocado');
                INSERT INTO ingredient_masters (master_id, canonical_name) VALUES ('lime', 'Lime');
                INSERT INTO vendor_prices (ingredient, vendor, sku, location_id, master_id, pack_size, pack_unit, unit_price)
                VALUES ('Avocado', 'Sysco', 'S1', 'default', 'avocado', 1, 'each', 1.5);
                INSERT INTO vendor_prices (ingredient, vendor, sku, location_id, master_id, pack_size, pack_unit, unit_price)
                VALUES ('Lime', 'Shamrock', 'H9', 'default', 'lime', 1, 'each', 0.2);
                """)
        }
        let repo = VendorMappingWriteRepository(readDB: f.readDB, writeDB: f.writeDB)

        XCTAssertThrowsError(try repo.attachCatalogRow(
            AttachCatalogInput(
                masterId: "avocado",
                catalogKey: CatalogKey(vendor: "shamrock", sku: "H9", ingredient: "Lime")
            ),
            context: macContext()
        )) {
            XCTAssertEqual($0 as? VendorMappingWriteError, .conflict("That item is already linked to another staple."))
        }
        try f.writeDB.pool.read { db in
            let lime = try String.fetchOne(db, sql: "SELECT master_id FROM vendor_prices WHERE sku = 'H9'")
            XCTAssertEqual(lime, "lime")   // unchanged
        }
        try assertNothingWritten(f)
    }

    // ── API oracle 1 (adapted): catalog search + coverage in one screen load ─

    func testCatalogSearchAndCoverageTogether() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { try self.seedUnlinkedPair($0) }
        let reads = VendorMappingRepository(database: f.readDB, locationId: "default")
        let rows = try await reads.searchVendorCatalog(vendor: .sysco, q: "chicken")
        XCTAssertGreaterThanOrEqual(rows.count, 1)
        let coverage = try await reads.summarizeMappingCoverage()
        XCTAssertEqual(coverage.unlinkedSysco, 1)
        XCTAssertEqual(coverage.unlinkedShamrock, 1)
    }

    // ── API oracle 2 (adapted): pair then compare sees the new mapped pair ─

    func testPairThenCompareSeesMappedPair() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { try self.seedUnlinkedPair($0) }
        let writes = VendorMappingWriteRepository(readDB: f.readDB, writeDB: f.writeDB)
        _ = try writes.pairCatalogRows(chickenPair, context: macContext())

        let compare = VendorCompareRepository(database: f.readDB, locationId: "default")
        let summary = try await compare.listVendorCompareRows()
        XCTAssertEqual(summary.mastersWithBothVendors, 1)
    }

    // ── API oracle 3 (adapted): attach completes a single-vendor master ──

    func testAttachThenCompareSeesMappedPair() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { try self.seedSingleVendorAvocado($0) }
        let writes = VendorMappingWriteRepository(readDB: f.readDB, writeDB: f.writeDB)
        _ = try writes.attachCatalogRow(
            AttachCatalogInput(
                masterId: "avocado",
                catalogKey: CatalogKey(vendor: "shamrock", sku: "H1", ingredient: "Avocado Hass")
            ),
            context: macContext()
        )

        let compare = VendorCompareRepository(database: f.readDB, locationId: "default")
        let summary = try await compare.listVendorCompareRows()
        XCTAssertEqual(summary.mastersWithBothVendors, 1)
    }

    // ── pair rule failures (throw BEFORE any write/audit) ────────────────

    // web 422: empty canonical name
    func testPairEmptyCanonicalRejected() throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { try self.seedUnlinkedPair($0) }
        let repo = VendorMappingWriteRepository(readDB: f.readDB, writeDB: f.writeDB)
        let input = PairCatalogInput(
            syscoKey: chickenPair.syscoKey, shamrockKey: chickenPair.shamrockKey, canonicalName: "   "
        )
        XCTAssertThrowsError(try repo.pairCatalogRows(input, context: macContext())) {
            XCTAssertEqual($0 as? VendorMappingWriteError, .validation("Enter a staple name."))
        }
        try assertNothingWritten(f)
    }

    // web 422: name normalizes to nothing → 'Staple name is too short.'
    func testPairTooShortNameRejected() throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { try self.seedUnlinkedPair($0) }
        let repo = VendorMappingWriteRepository(readDB: f.readDB, writeDB: f.writeDB)
        let input = PairCatalogInput(
            syscoKey: chickenPair.syscoKey, shamrockKey: chickenPair.shamrockKey, canonicalName: "!!!"
        )
        XCTAssertThrowsError(try repo.pairCatalogRows(input, context: macContext())) {
            XCTAssertEqual($0 as? VendorMappingWriteError, .validation("Staple name is too short."))
        }
        try assertNothingWritten(f)
    }

    // web 422: wrong-vendor key
    func testPairWrongVendorKeyRejected() throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { try self.seedUnlinkedPair($0) }
        let repo = VendorMappingWriteRepository(readDB: f.readDB, writeDB: f.writeDB)
        let input = PairCatalogInput(
            syscoKey: CatalogKey(vendor: "shamrock", sku: "H456", ingredient: "CHICKEN BRST BNLS"),
            shamrockKey: chickenPair.shamrockKey,
            canonicalName: "Chicken Breast"
        )
        XCTAssertThrowsError(try repo.pairCatalogRows(input, context: macContext())) {
            XCTAssertEqual($0 as? VendorMappingWriteError, .validation("Expected sysco catalog row."))
        }
        try assertNothingWritten(f)
    }

    // web 409: slug already holds a DIFFERENT canonical name
    func testPairNameAlreadyLinkedRejected() throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { db in
            try self.seedUnlinkedPair(db)
            try db.execute(sql: "INSERT INTO ingredient_masters (master_id, canonical_name) VALUES ('chicken_breast', 'Different Name')")
        }
        let repo = VendorMappingWriteRepository(readDB: f.readDB, writeDB: f.writeDB)
        XCTAssertThrowsError(try repo.pairCatalogRows(chickenPair, context: macContext())) {
            XCTAssertEqual($0 as? VendorMappingWriteError, .conflict("That staple name is already linked."))
        }
        try assertNothingWritten(f)
        try f.writeDB.pool.read { db in
            let name = try String.fetchOne(db, sql: "SELECT canonical_name FROM ingredient_masters WHERE master_id='chicken_breast'")
            XCTAssertEqual(name, "Different Name")   // untouched
        }
    }

    // Same slug + SAME canonical name is NOT a conflict (web upserts).
    func testPairSameNameReusesMaster() throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { db in
            try self.seedUnlinkedPair(db)
            try db.execute(sql: "INSERT INTO ingredient_masters (master_id, canonical_name) VALUES ('chicken_breast', 'Chicken Breast')")
        }
        let repo = VendorMappingWriteRepository(readDB: f.readDB, writeDB: f.writeDB)
        XCTAssertEqual(try repo.pairCatalogRows(chickenPair, context: macContext()), "chicken_breast")
        try f.writeDB.pool.read { db in
            let masters = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM ingredient_masters") ?? -1
            XCTAssertEqual(masters, 1)   // upsert, not a second row
        }
    }

    // web 404: catalog row missing
    func testPairCatalogRowMissingRejected() throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { try self.seedUnlinkedPair($0) }
        let repo = VendorMappingWriteRepository(readDB: f.readDB, writeDB: f.writeDB)
        let input = PairCatalogInput(
            syscoKey: CatalogKey(vendor: "sysco", sku: "NOPE", ingredient: "Ghost"),
            shamrockKey: chickenPair.shamrockKey,
            canonicalName: "Ghost"
        )
        XCTAssertThrowsError(try repo.pairCatalogRows(input, context: macContext())) {
            XCTAssertEqual($0 as? VendorMappingWriteError, .notFound("Catalog row not found."))
        }
        try assertNothingWritten(f)
    }

    // web 422: latest row's ingredient differs from the key's
    func testPairIngredientMismatchRejected() throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { try self.seedUnlinkedPair($0) }
        let repo = VendorMappingWriteRepository(readDB: f.readDB, writeDB: f.writeDB)
        let input = PairCatalogInput(
            syscoKey: CatalogKey(vendor: "sysco", sku: "S123", ingredient: "Stale Ingredient Name"),
            shamrockKey: chickenPair.shamrockKey,
            canonicalName: "Chicken Breast"
        )
        XCTAssertThrowsError(try repo.pairCatalogRows(input, context: macContext())) {
            XCTAssertEqual($0 as? VendorMappingWriteError, .validation("Catalog ingredient mismatch."))
        }
        try assertNothingWritten(f)
    }

    // web 409: item already linked to ANOTHER master
    func testPairItemLinkedElsewhereRejected() throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { db in
            try self.seedUnlinkedPair(db)
            try db.execute(sql: "UPDATE vendor_prices SET master_id = 'other_master' WHERE sku = 'S123'")
        }
        let repo = VendorMappingWriteRepository(readDB: f.readDB, writeDB: f.writeDB)
        XCTAssertThrowsError(try repo.pairCatalogRows(chickenPair, context: macContext())) {
            XCTAssertEqual($0 as? VendorMappingWriteError, .conflict("That item is already linked to another staple."))
        }
        try assertNothingWritten(f)
    }

    // ── attach rule failures ─────────────────────────────────────────────

    // web 422: no master picked
    func testAttachEmptyMasterRejected() throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { try self.seedSingleVendorAvocado($0) }
        let repo = VendorMappingWriteRepository(readDB: f.readDB, writeDB: f.writeDB)
        XCTAssertThrowsError(try repo.attachCatalogRow(
            AttachCatalogInput(masterId: "  ", catalogKey: CatalogKey(vendor: "shamrock", sku: "H1", ingredient: "Avocado Hass")),
            context: macContext()
        )) {
            XCTAssertEqual($0 as? VendorMappingWriteError, .validation("Pick a staple."))
        }
        try assertNothingWritten(f)
    }

    // web 404: master missing
    func testAttachMasterMissingRejected() throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { try self.seedSingleVendorAvocado($0) }
        let repo = VendorMappingWriteRepository(readDB: f.readDB, writeDB: f.writeDB)
        XCTAssertThrowsError(try repo.attachCatalogRow(
            AttachCatalogInput(masterId: "ghost", catalogKey: CatalogKey(vendor: "shamrock", sku: "H1", ingredient: "Avocado Hass")),
            context: macContext()
        )) {
            XCTAssertEqual($0 as? VendorMappingWriteError, .notFound("Staple not found."))
        }
        try assertNothingWritten(f)
    }

    // web 409: master not in exactly-single-vendor state
    func testAttachBothVendorsMasterRejected() throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { db in
            try self.seedSingleVendorAvocado(db)
            // link the shamrock row too → both vendors present
            try db.execute(sql: "UPDATE vendor_prices SET master_id = 'avocado' WHERE sku = 'H1'")
        }
        let repo = VendorMappingWriteRepository(readDB: f.readDB, writeDB: f.writeDB)
        XCTAssertThrowsError(try repo.attachCatalogRow(
            AttachCatalogInput(masterId: "avocado", catalogKey: CatalogKey(vendor: "shamrock", sku: "H1", ingredient: "Avocado Hass")),
            context: macContext()
        )) {
            XCTAssertEqual($0 as? VendorMappingWriteError, .conflict("Staple already has both vendors or none."))
        }
        try assertNothingWritten(f)
    }

    // web 422: wrong-vendor key ("Pick a shamrock item.")
    func testAttachWrongVendorRejected() throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { try self.seedSingleVendorAvocado($0) }
        let repo = VendorMappingWriteRepository(readDB: f.readDB, writeDB: f.writeDB)
        XCTAssertThrowsError(try repo.attachCatalogRow(
            AttachCatalogInput(masterId: "avocado", catalogKey: CatalogKey(vendor: "sysco", sku: "S1", ingredient: "Avocado")),
            context: macContext()
        )) {
            XCTAssertEqual($0 as? VendorMappingWriteError, .validation("Pick a shamrock item."))
        }
        try assertNothingWritten(f)
    }

    // No write database → persistenceFailed before anything else.
    func testMissingWriteDatabaseFails() throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        let repo = VendorMappingWriteRepository(readDB: f.readDB, writeDB: nil)
        XCTAssertThrowsError(try repo.pairCatalogRows(chickenPair, context: macContext())) {
            XCTAssertEqual($0 as? VendorMappingWriteError, .persistenceFailed)
        }
    }
}
