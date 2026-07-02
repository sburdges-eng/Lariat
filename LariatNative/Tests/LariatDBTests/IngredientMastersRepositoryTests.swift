import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Behavior-parity port of `lib/ingredientMastersRepo.ts` (`listMasters`,
/// `getMaster`, `updateMaster`) against an in-memory (on-disk temp) GRDB
/// fixture seeded with the REAL `ingredient_masters` + `vendor_prices` +
/// `bom_lines` + `audit_events` DDL (mirrors `lib/db.ts`). Parity oracles:
/// `tests/js/test-ingredient-masters-repo.mjs`, `tests/js/test-ingredient-masters-api.mjs`.
final class IngredientMastersRepositoryTests: XCTestCase {

    // ── seed helpers (mirror test-ingredient-masters-repo.mjs L32-60) ──

    private func seedMaster(
        _ db: Database, _ id: String, _ name: String,
        category: String? = nil, vendor: String? = nil, lastReviewed: String? = nil,
        locked: Int = 0, lockReason: String? = nil
    ) throws {
        try db.execute(sql: """
            INSERT INTO ingredient_masters
              (master_id, canonical_name, category, preferred_vendor, quality_locked, quality_lock_reason, last_reviewed)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, arguments: [id, name, category, vendor, locked, lockReason, lastReviewed])
    }

    private func seedVendorPrice(_ db: Database, _ masterId: String) throws {
        try db.execute(sql: """
            INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, location_id, master_id)
            VALUES ('thing','sysco',?,1,'ea',1.0,1.0,'default',?)
            """, arguments: ["sku-\(UUID().uuidString.prefix(6))", masterId])
    }

    private func seedBomLine(_ db: Database, _ masterId: String) throws {
        try db.execute(sql: """
            INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, location_id, master_id)
            VALUES ('recipe-a','thing',1.0,'ea','default',?)
            """, arguments: [masterId])
    }

    private func isoNow() -> String {
        ISO8601DateFormatter().string(from: Date())
    }

    // ── listMasters parity ──────────────────────────────────────────────

    // repo L63: returns empty list when table empty
    func testEmptyListWhenTableEmpty() async throws {
        let (r, _, p) = try makeRepos(); defer { cleanup(p) }
        let rows = try await r.repo.list()
        XCTAssertEqual(rows, [])
    }

    // repo L67-74
    func testZeroCountsWhenNothingMaps() async throws {
        let (r, _, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { try self.seedMaster($0, "ketchup_heinz_1gal", "Ketchup — Heinz 1gal") }
        let rows = try await r.repo.list()
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].masterId, "ketchup_heinz_1gal")
        XCTAssertEqual(rows[0].vendorPriceCount, 0)
        XCTAssertEqual(rows[0].bomLineCount, 0)
    }

    // repo L76-86
    func testCountsVendorPricesAndBomLines() async throws {
        let (r, _, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { db in
            try self.seedMaster(db, "a", "A")
            try self.seedVendorPrice(db, "a"); try self.seedVendorPrice(db, "a"); try self.seedVendorPrice(db, "a")
            try self.seedBomLine(db, "a"); try self.seedBomLine(db, "a")
        }
        let rows = try await r.repo.list()
        XCTAssertEqual(rows[0].vendorPriceCount, 3)
        XCTAssertEqual(rows[0].bomLineCount, 2)
    }

    // repo L88-93: needs-review (NULL last_reviewed) sorts before reviewed
    func testSortsNeedsReviewFirst() async throws {
        let (r, _, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { db in
            try self.seedMaster(db, "reviewed", "B", lastReviewed: "2099-01-01T00:00:00Z")
            try self.seedMaster(db, "unreviewed", "A")
        }
        let ids: [String] = try await r.repo.list().map(\.masterId)
        XCTAssertEqual(ids, ["unreviewed", "reviewed"])
    }

    // repo L95-103: within needs-review, vendor_price_count DESC
    func testWithinNeedsReviewSortsByVendorCountDesc() async throws {
        let (r, _, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { db in
            try self.seedMaster(db, "low", "L"); try self.seedMaster(db, "high", "H")
            try self.seedVendorPrice(db, "high"); try self.seedVendorPrice(db, "high"); try self.seedVendorPrice(db, "low")
        }
        let ids: [String] = try await r.repo.list().map(\.masterId)
        XCTAssertEqual(ids, ["high", "low"])
    }

    // repo L105-110
    func testFilterNeedsReviewExcludesRecentlyReviewed() async throws {
        let (r, _, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { db in
            try self.seedMaster(db, "reviewed", "B", lastReviewed: self.isoNow())
            try self.seedMaster(db, "unreviewed", "A")
        }
        let ids: [String] = try await r.repo.list(filter: .needsReview).map(\.masterId)
        XCTAssertEqual(ids, ["unreviewed"])
    }

    // repo L112-118: reviewed excludes unreviewed(null) AND stale(2020)
    func testFilterReviewedExcludesUnreviewedAndStale() async throws {
        let (r, _, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { db in
            try self.seedMaster(db, "fresh", "F", lastReviewed: self.isoNow())
            try self.seedMaster(db, "stale", "S", lastReviewed: "2020-01-01T00:00:00Z")
            try self.seedMaster(db, "null", "N")
        }
        let ids: [String] = try await r.repo.list(filter: .reviewed).map(\.masterId)
        XCTAssertEqual(ids, ["fresh"])
    }

    // repo L120-127: q matches master_id OR canonical_name, case-insensitive
    func testQMatchesIdAndNameCaseInsensitive() async throws {
        let (r, _, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { db in
            try self.seedMaster(db, "ketchup_heinz_1gal", "Ketchup — Heinz 1gal")
            try self.seedMaster(db, "mayo_kraft_1gal", "Mayonnaise — Kraft 1gal")
        }
        let ketch = try await r.repo.list(q: "ketch").count
        XCTAssertEqual(ketch, 1)
        let ketchUpper = try await r.repo.list(q: "KETCH").count   // id match, upcased
        XCTAssertEqual(ketchUpper, 1)
        let heinz = try await r.repo.list(q: "heinz").count   // name match
        XCTAssertEqual(heinz, 1)
        let xyz = try await r.repo.list(q: "xyz").count
        XCTAssertEqual(xyz, 0)
    }

    // repo L129-136
    func testLimitClampsTo1To1000() async throws {
        let (r, _, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { db in
            try self.seedMaster(db, "a", "A"); try self.seedMaster(db, "b", "B"); try self.seedMaster(db, "c", "C")
        }
        let one = try await r.repo.list(limit: 1).count
        XCTAssertEqual(one, 1)
        let clampedLow = try await r.repo.list(limit: 0).count        // < 1 clamps to 1
        XCTAssertEqual(clampedLow, 1)
        let clampedHigh = try await r.repo.list(limit: 999_999).count  // > 1000 still returns all three
        XCTAssertEqual(clampedHigh, 3)
    }

    // ── getMaster parity ──────────────────────────────────────────────

    // repo L140 (null) + L144 (row with counts)
    func testGetMasterNullThenRow() async throws {
        let (r, _, p) = try makeRepos(); defer { cleanup(p) }
        XCTAssertNil(try r.repo.getMaster("missing"))
        try r.writeSeed { db in
            try self.seedMaster(db, "a", "A", category: "sauce")
            try self.seedVendorPrice(db, "a")
        }
        let row = try r.repo.getMaster("a")
        XCTAssertEqual(row?.canonicalName, "A")
        XCTAssertEqual(row?.category, "sauce")
        XCTAssertEqual(row?.vendorPriceCount, 1)
        XCTAssertEqual(row?.bomLineCount, 0)
    }

    // ── updateMaster — the ONE audited write ────────────────────────────

    private func macContext(locationId: String = "default") -> RegulatedWriteContext {
        RegulatedWriteContext(
            actorCookId: "cook-x",
            actorSource: RegulatedWriteContext.nativeMacActorSource,
            locationId: locationId,
            shiftDate: "2026-07-02"
        )
    }

    // repo L157-163: missing id → found=false, no audit, no write
    func testNotFoundNoWrite() throws {
        let (r, writeDB, p) = try makeRepos(); defer { cleanup(p) }
        var u = IngredientMasterUpdates(); u.category = .set("sauce")
        let res = try r.repo.updateMaster("missing", updates: u, context: macContext())
        XCTAssertFalse(res.found)
        XCTAssertFalse(res.changed)
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? -1, 0)
        }
    }

    // repo L165-172: empty updates → changed=false, no audit
    func testEmptyUpdatesNoAudit() throws {
        let (r, writeDB, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { try self.seedMaster($0, "a", "A") }
        let res = try r.repo.updateMaster("a", updates: IngredientMasterUpdates(), context: macContext())
        XCTAssertTrue(res.found)
        XCTAssertFalse(res.changed)
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? -1, 0)
        }
    }

    // repo L174-188: writes only the named field, preserves others, ONE audit
    // (action=correction), payload {master_id, updates}.
    // DIVERGENCE from api test L191 ('manager_ui'): assert actor_source == 'native_mac'.
    func testWritesNamedFieldAndOneAuditNativeMac() throws {
        let (r, writeDB, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { try self.seedMaster($0, "a", "A", category: "sauce", vendor: "sysco") }
        var u = IngredientMasterUpdates(); u.category = .set("condiment")
        let res = try r.repo.updateMaster("a", updates: u, context: macContext())
        XCTAssertTrue(res.changed)
        XCTAssertEqual(res.after?.category, "condiment")
        XCTAssertEqual(res.after?.preferredVendor, "sysco")   // unspecified preserved
        try writeDB.pool.read { db in
            let action = try String.fetchOne(db, sql: "SELECT action FROM audit_events WHERE entity='ingredient_masters'")
            XCTAssertEqual(action, "correction")
            let actorCookId = try String.fetchOne(db, sql: "SELECT actor_cook_id FROM audit_events LIMIT 1")
            XCTAssertEqual(actorCookId, "cook-x")
            let actorSource = try String.fetchOne(db, sql: "SELECT actor_source FROM audit_events LIMIT 1")
            XCTAssertEqual(actorSource, "native_mac")
            let entityId = try Int64.fetchOne(db, sql: "SELECT entity_id FROM audit_events LIMIT 1")
            XCTAssertNil(entityId)   // master_id is TEXT → entity_id NULL (repo L281)
            let payload = try String.fetchOne(db, sql: "SELECT payload_json FROM audit_events LIMIT 1")
            XCTAssertTrue(payload?.contains("\"master_id\":\"a\"") ?? false, "payload: \(payload ?? "nil")")
            // Lock the nested `updates` shape too (oracle L186-187:
            // deepEqual(payload.updates, {category:'condiment'})) — guards the
            // regulated write's payload encoder against a nested-shape regression.
            XCTAssertTrue(payload?.contains("\"updates\":{\"category\":\"condiment\"}") ?? false, "nested updates payload: \(payload ?? "nil")")
        }
    }

    // repo L190-199: last_reviewed:'now' → datetime('now') within 5s
    func testLastReviewedNowStamps() throws {
        let (r, _, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { try self.seedMaster($0, "a", "A") }
        let before = Date()
        var u = IngredientMasterUpdates(); u.lastReviewed = .set(.now)
        _ = try r.repo.updateMaster("a", updates: u, context: macContext())
        let stampStr = try r.repo.getMaster("a")?.lastReviewed
        XCTAssertNotNil(stampStr)
        let f = ISO8601DateFormatter()
        let normalized = stampStr!.replacingOccurrences(of: " ", with: "T") + "Z"
        let stamped = f.date(from: normalized)
        XCTAssertNotNil(stamped)
        if let stamped {
            XCTAssertLessThan(abs(stamped.timeIntervalSince(before)), 5)
        }
    }

    // repo L201-205: last_reviewed:null clears
    func testLastReviewedClear() throws {
        let (r, _, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { try self.seedMaster($0, "a", "A", lastReviewed: "2024-01-01T00:00:00Z") }
        var u = IngredientMasterUpdates(); u.lastReviewed = .set(.clear)
        _ = try r.repo.updateMaster("a", updates: u, context: macContext())
        XCTAssertNil(try r.repo.getMaster("a")?.lastReviewed)
    }

    // repo L207-221: multi-field → all persisted + ONE audit row
    func testMultiFieldOneAudit() throws {
        let (r, writeDB, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { try self.seedMaster($0, "a", "A") }
        var u = IngredientMasterUpdates()
        u.canonicalName = .set("Better Name"); u.category = .set("sauce"); u.preferredVendor = .set("shamrock")
        _ = try r.repo.updateMaster("a", updates: u, context: macContext())
        let after = try r.repo.getMaster("a")
        XCTAssertEqual(after?.canonicalName, "Better Name")
        XCTAssertEqual(after?.category, "sauce")
        XCTAssertEqual(after?.preferredVendor, "shamrock")
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? -1, 1)
        }
    }

    // DIVERGENCE guard: rule failure throws BEFORE audit — nothing written
    // (repo L234 order; api test L253-258 → 422).
    func testRejectionThrowsBeforeAudit() throws {
        let (r, writeDB, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { db in try self.seedMaster(db, "a", "Chicken Breast", vendor: "sysco", locked: 1) }
        var u = IngredientMasterUpdates(); u.preferredVendor = .set("shamrock")
        XCTAssertThrowsError(try r.repo.updateMaster("a", updates: u, context: macContext())) {
            guard case IngredientMasterWriteError.rejected = $0 else { return XCTFail("wrong error: \($0)") }
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? -1, 0)  // no audit
            let vendor = try String.fetchOne(db, sql: "SELECT preferred_vendor FROM ingredient_masters WHERE master_id='a'")
            XCTAssertEqual(vendor, "sysco")  // unchanged
        }
    }

    // lock with vendor in one request persists (api test L239-251)
    func testLockWithVendorPersists() throws {
        let (r, writeDB, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { try self.seedMaster($0, "a", "Chicken Breast") }
        var u = IngredientMasterUpdates()
        u.preferredVendor = .set("shamrock"); u.qualityLocked = .set(true); u.qualityLockReason = .set("quality")
        _ = try r.repo.updateMaster("a", updates: u, context: macContext())
        try writeDB.pool.read { db in
            let vendor = try String.fetchOne(db, sql: "SELECT preferred_vendor FROM ingredient_masters WHERE master_id='a'")
            XCTAssertEqual(vendor, "shamrock")
            let locked = try Int.fetchOne(db, sql: "SELECT quality_locked FROM ingredient_masters WHERE master_id='a'")
            XCTAssertEqual(locked, 1)
        }
    }

    // Gap-fix: canonical_name empty-after-trim is rejected BEFORE any write
    // (route.js L104-107 folded into the repo write path — see Task 1/3 notes).
    func testCanonicalNameEmptyRejectedNoWrite() throws {
        let (r, writeDB, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { try self.seedMaster($0, "a", "Original Name") }
        var u = IngredientMasterUpdates(); u.canonicalName = .set("   ")
        XCTAssertThrowsError(try r.repo.updateMaster("a", updates: u, context: macContext())) {
            guard case IngredientMasterWriteError.rejected(let m) = $0 else { return XCTFail("wrong error: \($0)") }
            XCTAssertEqual(m, "canonical_name cannot be empty")
        }
        try writeDB.pool.read { db in
            XCTAssertEqual(try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM audit_events") ?? -1, 0)
            let name = try String.fetchOne(db, sql: "SELECT canonical_name FROM ingredient_masters WHERE master_id='a'")
            XCTAssertEqual(name, "Original Name")
        }
    }

    // Gap-fix: category/preferred_vendor/quality_lock_reason clip-to-null —
    // whitespace-only value clears the column (route.js clipOrNull L38-44).
    func testWhitespaceCategoryClipsToNull() throws {
        let (r, _, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { try self.seedMaster($0, "a", "A", category: "sauce") }
        var u = IngredientMasterUpdates(); u.category = .set("   ")
        _ = try r.repo.updateMaster("a", updates: u, context: macContext())
        XCTAssertNil(try r.repo.getMaster("a")?.category)
    }

    // Gap-fix: canonical_name clips to 200 chars.
    func testCanonicalNameClipsTo200() throws {
        let (r, _, p) = try makeRepos(); defer { cleanup(p) }
        try r.writeSeed { try self.seedMaster($0, "a", "A") }
        var u = IngredientMasterUpdates(); u.canonicalName = .set(String(repeating: "z", count: 250))
        _ = try r.repo.updateMaster("a", updates: u, context: macContext())
        XCTAssertEqual(try r.repo.getMaster("a")?.canonicalName.count, 200)
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private struct Repos {
        let repo: IngredientMastersRepository
        let readDB: LariatDatabase
        let writeDB: LariatWriteDatabase

        func writeSeed(_ block: @escaping (Database) throws -> Void) throws {
            try writeDB.pool.write { db in try block(db) }
        }
    }

    private func makeRepos() throws -> (Repos, LariatWriteDatabase, String) {
        let path = try seedIngredientMastersDatabase()
        let readDB = try LariatDatabase(path: path)
        let writeDB = try LariatWriteDatabase(path: path)
        let repo = IngredientMastersRepository(readDB: readDB, writeDB: writeDB)
        return (Repos(repo: repo, readDB: readDB, writeDB: writeDB), writeDB, path)
    }

    private func cleanup(_ path: String) {
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.removeItem(atPath: dir)
    }
}

/// Mirrors the REAL web schema (lib/db.ts:1278 vendor_prices, :1410 bom_lines,
/// :1445 ingredient_masters, :2910 audit_events). `ingredient_masters` has NO
/// `location_id` column (masters are global); `vendor_prices`/`bom_lines` do.
func seedIngredientMastersDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-ingredient-masters-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path

    let dbQueue = try DatabaseQueue(path: path)
    try dbQueue.write { db in
        try db.execute(sql: """
            CREATE TABLE ingredient_masters (
              master_id           TEXT PRIMARY KEY,
              canonical_name      TEXT NOT NULL,
              category            TEXT,
              preferred_vendor    TEXT,
              quality_locked      INTEGER NOT NULL DEFAULT 0,
              quality_lock_reason TEXT,
              last_reviewed       TEXT
            );
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
              imported_at TEXT DEFAULT (datetime('now')),
              master_id TEXT
            );
            CREATE TABLE bom_lines (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              recipe_id TEXT NOT NULL,
              ingredient TEXT,
              qty REAL,
              unit TEXT,
              sub_recipe TEXT,
              vendor_ingredient TEXT,
              map_status TEXT,
              vendor TEXT,
              pack_price REAL,
              pack_size REAL,
              location_id TEXT DEFAULT 'default',
              imported_at TEXT DEFAULT (datetime('now')),
              master_id TEXT
            );
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
              created_at TEXT DEFAULT (datetime('now'))
            );
            """)
    }
    return path
}
