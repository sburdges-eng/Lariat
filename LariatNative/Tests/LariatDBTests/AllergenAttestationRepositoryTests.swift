import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Behavior parity with `tests/js/test-allergen-attestations.mjs` against a
/// temp fixture DB (web `lib/db.ts` DDL for `allergen_attestations` +
/// `audit_events`). Recipes are injected fixtures — the same QUESO/SALSA
/// docs the web test writes to its cache dir.
final class AllergenAttestationRepositoryTests: XCTestCase {
    private var dir: String!
    private var readDB: LariatDatabase!
    private var writeDB: LariatWriteDatabase!

    private let salsa = AllergenRecipe(
        slug: "salsa", name: "Blackened Tomato Salsa",
        ingredients: [.init(item: "Tomato"), .init(item: "Worcestershire")],
        allergens: ["fish", "wheat"])

    private let queso = AllergenRecipe(
        slug: "queso", name: "Queso",
        ingredients: [.init(item: "Milk"), .init(item: "Cheddar")],
        allergens: ["fish", "milk", "wheat"],
        subRecipes: ["salsa"])

    private var baseline: [AllergenRecipe] { [queso, salsa] }

    private var quesoWithFlour: [AllergenRecipe] {
        [AllergenRecipe(slug: "queso", name: "Queso",
                        ingredients: queso.ingredients + [.init(item: "Flour")],
                        allergens: queso.allergens, subRecipes: queso.subRecipes),
         salsa]
    }

    override func setUpWithError() throws {
        dir = NSTemporaryDirectory() + "lariat-allergen-" + UUID().uuidString
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let path = (dir as NSString).appendingPathComponent("lariat.db")
        let bootstrap = try DatabasePool(path: path)
        try bootstrap.write { db in
            try db.execute(sql: """
                CREATE TABLE allergen_attestations (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  recipe_slug TEXT NOT NULL,
                  location_id TEXT NOT NULL DEFAULT 'default',
                  allergens_json TEXT NOT NULL DEFAULT '[]',
                  recipe_fingerprint TEXT NOT NULL,
                  attested_by TEXT NOT NULL,
                  note TEXT,
                  created_at TEXT NOT NULL DEFAULT (datetime('now')));
                CREATE TABLE audit_events (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  shift_date TEXT NOT NULL,
                  location_id TEXT DEFAULT 'default',
                  actor_cook_id TEXT,
                  actor_source TEXT NOT NULL,
                  entity TEXT NOT NULL,
                  entity_id INTEGER,
                  action TEXT NOT NULL
                    CHECK(action IN ('insert','update','delete','correction','view')),
                  replaces_id INTEGER,
                  payload_json TEXT,
                  note TEXT,
                  created_at TEXT DEFAULT (datetime('now')));
                """)
        }
        readDB = try LariatDatabase(path: path)
        writeDB = try LariatWriteDatabase(path: path)
    }

    override func tearDownWithError() throws {
        readDB = nil
        writeDB = nil
        try? FileManager.default.removeItem(atPath: dir)
    }

    private var repo: AllergenAttestationRepository {
        AllergenAttestationRepository(readDB: readDB, writeDB: writeDB)
    }

    private var context: RegulatedWriteContext {
        RegulatedWriteContext(
            actorCookId: "7", actorSource: "native_mac",
            locationId: "default", shiftDate: "2026-07-02")
    }

    private func count(_ sql: String) throws -> Int {
        try readDB.pool.read { db in try Int.fetchOne(db, sql: sql) ?? -1 }
    }

    // ── Status ──────────────────────────────────────────────────────────

    func testUnattestedBeforeAnySignoff() async throws {
        let s = try await repo.status(slug: "queso", locationId: "default", recipes: baseline)
        XCTAssertEqual(s.status, .unattested)
        XCTAssertNil(s.latest)
        XCTAssertEqual(s.name, "Queso")
        XCTAssertEqual(s.heuristicAllergens, ["fish", "milk", "wheat"])
    }

    func testFlipsToAttestedWithMetadataAndNormalizedAllergens() async throws {
        let row = try repo.record(
            .init(recipeSlug: "queso",
                  allergens: ["Milk", "fish", "wheat", "milk "],
                  attestedBy: "Dana",
                  note: "verified against spec book"),
            recipes: baseline, locationId: "default", context: context)
        XCTAssertGreaterThan(row.id, 0)

        let s = try await repo.status(slug: "queso", locationId: "default", recipes: baseline)
        XCTAssertEqual(s.status, .attested)
        XCTAssertEqual(s.latest?.attestedBy, "Dana")
        XCTAssertEqual(s.latest?.note, "verified against spec book")
        XCTAssertEqual(s.latest?.allergens, ["fish", "milk", "wheat"])
    }

    func testGoesStaleWhenOwnCompositionChanges() async throws {
        _ = try repo.record(.init(recipeSlug: "queso", attestedBy: "Dana"),
                            recipes: baseline, locationId: "default", context: context)
        var s = try await repo.status(slug: "queso", locationId: "default", recipes: baseline)
        XCTAssertEqual(s.status, .attested)

        s = try await repo.status(slug: "queso", locationId: "default", recipes: quesoWithFlour)
        XCTAssertEqual(s.status, .stale)
        XCTAssertEqual(s.latest?.attestedBy, "Dana")   // metadata survives staleness
    }

    func testGoesStaleWhenSubRecipeChanges() async throws {
        _ = try repo.record(.init(recipeSlug: "queso", attestedBy: "Dana"),
                            recipes: baseline, locationId: "default", context: context)
        let changedSalsa = [
            queso,
            AllergenRecipe(slug: "salsa", name: "Blackened Tomato Salsa",
                           ingredients: salsa.ingredients + [.init(item: "Peanut oil")],
                           allergens: salsa.allergens),
        ]
        let quesoStatus = try await repo.status(slug: "queso", locationId: "default", recipes: changedSalsa)
        XCTAssertEqual(quesoStatus.status, .stale)
        // Unchanged-but-unattested sub-recipe stays unattested, not stale.
        let salsaStatus = try await repo.status(slug: "salsa", locationId: "default", recipes: changedSalsa)
        XCTAssertEqual(salsaStatus.status, .unattested)
    }

    func testNewAttestationSupersedesOldAppendOnly() async throws {
        _ = try repo.record(.init(recipeSlug: "queso", attestedBy: "Dana"),
                            recipes: baseline, locationId: "default", context: context)
        let stale = try await repo.status(slug: "queso", locationId: "default", recipes: quesoWithFlour)
        XCTAssertEqual(stale.status, .stale)

        _ = try repo.record(.init(recipeSlug: "queso", attestedBy: "Marco"),
                            recipes: quesoWithFlour, locationId: "default", context: context)
        let s = try await repo.status(slug: "queso", locationId: "default", recipes: quesoWithFlour)
        XCTAssertEqual(s.status, .attested)
        XCTAssertEqual(s.latest?.attestedBy, "Marco")

        // Both rows persist — corrections never UPDATE/DELETE.
        XCTAssertEqual(
            try count("SELECT COUNT(*) FROM allergen_attestations WHERE recipe_slug = 'queso'"), 2)
    }

    func testIsolatesAttestationsPerLocation() async throws {
        _ = try repo.record(.init(recipeSlug: "queso", attestedBy: "Dana"),
                            recipes: baseline, locationId: "kitchen-a", context: context)
        let a = try await repo.status(slug: "queso", locationId: "kitchen-a", recipes: baseline)
        XCTAssertEqual(a.status, .attested)
        let b = try await repo.status(slug: "queso", locationId: "kitchen-b", recipes: baseline)
        XCTAssertEqual(b.status, .unattested)
        let d = try await repo.status(slug: "queso", locationId: "default", recipes: baseline)
        XCTAssertEqual(d.status, .unattested)
    }

    func testAttestationOutlivesRecipeAsStale() async throws {
        _ = try repo.record(.init(recipeSlug: "queso", attestedBy: "Dana"),
                            recipes: baseline, locationId: "default", context: context)
        // Recipe removed from the cache: explicit slug lookup still returns
        // a row — status stale, name falls back to the slug. NEVER attested.
        let statuses = try await repo.statuses(
            slugs: ["queso"], locationId: "default", recipes: [salsa])
        XCTAssertEqual(statuses.count, 1)
        XCTAssertEqual(statuses[0].status, .stale)
        XCTAssertEqual(statuses[0].name, "queso")
        XCTAssertEqual(statuses[0].heuristicAllergens, [])
    }

    func testStatusListCoversEveryRecipe() async throws {
        _ = try repo.record(.init(recipeSlug: "salsa", attestedBy: "Dana"),
                            recipes: baseline, locationId: "default", context: context)
        let all = try await repo.statuses(locationId: "default", recipes: baseline)
        let bySlug = Dictionary(uniqueKeysWithValues: all.map { ($0.recipeSlug, $0) })
        XCTAssertEqual(bySlug["queso"]?.status, .unattested)
        XCTAssertEqual(bySlug["salsa"]?.status, .attested)
        XCTAssertEqual(bySlug["salsa"]?.latest?.attestedBy, "Dana")
    }

    // ── Record — rule failures throw BEFORE write ───────────────────────

    func testUnknownRecipeThrowsAndWritesNothing() throws {
        XCTAssertThrowsError(try repo.record(
            .init(recipeSlug: "nope", attestedBy: "Dana"),
            recipes: baseline, locationId: "default", context: context)
        ) {
            XCTAssertEqual($0 as? AllergenAttestationWriteError, .unknownRecipe("nope"))
        }
        XCTAssertEqual(try count("SELECT COUNT(*) FROM allergen_attestations"), 0)
        XCTAssertEqual(try count("SELECT COUNT(*) FROM audit_events"), 0)
    }

    func testMissingSlugAndAttestedByThrowBeforeWrite() throws {
        XCTAssertThrowsError(try repo.record(
            .init(recipeSlug: "  ", attestedBy: "Dana"),
            recipes: baseline, locationId: "default", context: context)
        ) {
            XCTAssertEqual($0 as? AllergenAttestationWriteError, .missingSlug)
        }
        XCTAssertThrowsError(try repo.record(
            .init(recipeSlug: "queso", attestedBy: "   "),
            recipes: baseline, locationId: "default", context: context)
        ) {
            XCTAssertEqual($0 as? AllergenAttestationWriteError, .missingAttestedBy)
        }
        XCTAssertEqual(try count("SELECT COUNT(*) FROM allergen_attestations"), 0)
        XCTAssertEqual(try count("SELECT COUNT(*) FROM audit_events"), 0)
    }

    // ── Audit row — same transaction, full-row payload ──────────────────

    func testWritesAuditEventsRowInSameTransaction() throws {
        let row = try repo.record(
            .init(recipeSlug: "queso", attestedBy: "Dana", note: "spot check"),
            recipes: baseline, locationId: "kitchen-a", context: context)

        let audits = try readDB.pool.read { db in
            try Row.fetchAll(db, sql: "SELECT * FROM audit_events WHERE entity = 'allergen_attestation'")
        }
        XCTAssertEqual(audits.count, 1)
        XCTAssertEqual(audits[0]["entity_id"] as Int64, row.id)
        XCTAssertEqual(audits[0]["action"] as String, "insert")
        XCTAssertEqual(audits[0]["actor_cook_id"] as String, "Dana")
        XCTAssertEqual(audits[0]["actor_source"] as String, "native_mac")
        XCTAssertEqual(audits[0]["location_id"] as String, "kitchen-a")
        let payload = try JSONSerialization.jsonObject(
            with: Data((audits[0]["payload_json"] as String).utf8)) as! [String: Any]
        XCTAssertEqual(payload["recipe_slug"] as? String, "queso")
        XCTAssertEqual(payload["recipe_fingerprint"] as? String, row.recipeFingerprint)
    }

    func testDefaultsAllergensToHeuristicSet() throws {
        let row = try repo.record(
            .init(recipeSlug: "queso", attestedBy: "Dana"),
            recipes: baseline, locationId: "default", context: context)
        XCTAssertEqual(row.allergens, ["fish", "milk", "wheat"])
        XCTAssertEqual(row.allergensJson, #"["fish","milk","wheat"]"#)
    }

    /// Cross-client parity: a row recorded on native must carry the exact
    /// fingerprint the web computes for the same fixtures (oracle hash from
    /// node) so the WEB shows it as attested too.
    func testRecordedFingerprintMatchesWebOracle() throws {
        let row = try repo.record(
            .init(recipeSlug: "queso", attestedBy: "Dana"),
            recipes: baseline, locationId: "default", context: context)
        XCTAssertEqual(row.recipeFingerprint,
                       "2c7effd28593aff32b16a2612a8891d90f3e50c8856445cd104ee2c49c10a86c")
    }

    /// Native has NO idempotency replay layer — two identical records are two
    /// append-only rows. Deliberate, documented divergence.
    func testNoIdempotencyLayerTwoRecordsAppendTwoRows() throws {
        _ = try repo.record(.init(recipeSlug: "queso", attestedBy: "Dana"),
                            recipes: baseline, locationId: "default", context: context)
        _ = try repo.record(.init(recipeSlug: "queso", attestedBy: "Dana"),
                            recipes: baseline, locationId: "default", context: context)
        XCTAssertEqual(try count("SELECT COUNT(*) FROM allergen_attestations"), 2)
        XCTAssertEqual(try count("SELECT COUNT(*) FROM audit_events"), 2)
    }
}
