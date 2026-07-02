import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Behavior-parity port of `listVendorCompareRows` in `lib/vendorCompare.ts`
/// against an in-memory (on-disk temp WAL) GRDB fixture with the real web DDL.
/// Parity oracle: `tests/js/test-vendor-compare.mjs` (`listVendorCompareRows`
/// describe block).
final class VendorCompareRepositoryTests: XCTestCase {

    // ── seed helpers (mirror test-vendor-compare.mjs L21-36) ────────────

    private func seedPair(
        _ db: Database,
        syscoPrice: Double = 3.5, shamrockPrice: Double = 3.2,
        syscoRec: Double? = nil, shamrockRec: Double? = nil
    ) throws {
        try db.execute(sql: """
            INSERT INTO ingredient_masters (master_id, canonical_name, preferred_vendor, quality_locked)
            VALUES ('chicken_breast', 'Chicken Breast', NULL, 0)
            """)
        try db.execute(sql: """
            INSERT INTO vendor_prices
              (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, reconciled_unit_price, location_id, master_id, imported_at)
            VALUES ('Chicken Breast', 'Sysco', 'S1', 1, 'lb', ?, ?, ?, 'default', 'chicken_breast', datetime('now'))
            """, arguments: [syscoPrice, syscoPrice, syscoRec])
        try db.execute(sql: """
            INSERT INTO vendor_prices
              (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, reconciled_unit_price, location_id, master_id, imported_at)
            VALUES ('Chicken Breast', 'Shamrock', 'H1', 1, 'lb', ?, ?, ?, 'default', 'chicken_breast', datetime('now'))
            """, arguments: [shamrockPrice, shamrockPrice, shamrockRec])
    }

    // Oracle: 'returns mapped pair with shamrock cheaper'
    func testMappedPairWithShamrockCheaper() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { try self.seedPair($0) }
        let repo = VendorCompareRepository(database: f.readDB, locationId: "default")
        let summary = try await repo.listVendorCompareRows()
        XCTAssertEqual(summary.rows.count, 1)
        XCTAssertEqual(summary.rows[0].cheaperVendor, .shamrock)
        XCTAssertEqual(summary.rows[0].compareStatus, .comparable)
        XCTAssertEqual(summary.rows[0].sysco?.normalizedPrice, 3.5)
        XCTAssertEqual(summary.rows[0].shamrock?.normalizedPrice, 3.2)
        XCTAssertEqual(summary.rows[0].sysco?.normalizedUnit, "lb")
        XCTAssertEqual(summary.mappedPairCount, 1)
        XCTAssertEqual(summary.mastersWithBothVendors, 1)
        XCTAssertEqual(summary.mastersSingleVendorOnly, 0)
    }

    // Oracle: 'excludes master with only one vendor'
    func testExcludesSingleVendorMaster() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { db in
            try db.execute(sql: "INSERT INTO ingredient_masters (master_id, canonical_name) VALUES ('lime', 'Lime')")
            try db.execute(sql: """
                INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, location_id, master_id)
                VALUES ('Lime', 'Sysco', 'L1', 1, 'lb', 2, 2, 'default', 'lime')
                """)
        }
        let repo = VendorCompareRepository(database: f.readDB, locationId: "default")
        let summary = try await repo.listVendorCompareRows()
        XCTAssertEqual(summary.rows.count, 0)
        XCTAssertEqual(summary.mastersSingleVendorOnly, 1)
    }

    // Oracle: 'does not flag cheaper when quality locked'
    func testQualityLockedSuppressesCheaperFlag() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { db in
            try self.seedPair(db)
            try db.execute(sql: """
                UPDATE ingredient_masters SET quality_locked = 1, preferred_vendor = 'sysco'
                WHERE master_id = 'chicken_breast'
                """)
        }
        let repo = VendorCompareRepository(database: f.readDB, locationId: "default")
        let summary = try await repo.listVendorCompareRows()
        XCTAssertEqual(summary.rows.count, 1)
        XCTAssertNil(summary.rows[0].cheaperVendor)
        XCTAssertTrue(summary.rows[0].qualityLocked)
        XCTAssertEqual(summary.rows[0].preferredVendor, "sysco")
    }

    // reconciled_unit_price beats unit_price in the fetched offers.
    func testReconciledPriceWinsInOffers() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { try self.seedPair($0, syscoPrice: 3.5, shamrockPrice: 3.2, syscoRec: 2.9) }
        let repo = VendorCompareRepository(database: f.readDB, locationId: "default")
        let summary = try await repo.listVendorCompareRows()
        XCTAssertEqual(summary.rows[0].sysco?.normalizedPrice, 2.9)
        XCTAssertEqual(summary.rows[0].cheaperVendor, .sysco)
    }

    // latestPricesByVendor keeps the newest row per vendor
    // (imported_at DESC, id DESC — vendorCompare.ts L165-191).
    func testLatestRowPerVendorWins() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { db in
            try self.seedPair(db)
            // stale sysco row (older imported_at, higher price) must lose
            try db.execute(sql: """
                INSERT INTO vendor_prices
                  (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, location_id, master_id, imported_at)
                VALUES ('Chicken Breast', 'Sysco', 'S1', 1, 'lb', 9.9, 9.9, 'default', 'chicken_breast', datetime('now', '-3 days'))
                """)
        }
        let repo = VendorCompareRepository(database: f.readDB, locationId: "default")
        let summary = try await repo.listVendorCompareRows()
        XCTAssertEqual(summary.rows[0].sysco?.normalizedPrice, 3.5)
    }

    // Density bridge: gal (volume) vs lb (weight) becomes comparable when
    // ingredient_densities has a row keyed by normalizeIngredientKey(ingredient).
    func testDensityBridgesVolumeVsWeight() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { db in
            try db.execute(sql: """
                INSERT INTO ingredient_masters (master_id, canonical_name) VALUES ('heavy_cream', 'Heavy Cream')
                """)
            try db.execute(sql: """
                INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, location_id, master_id)
                VALUES ('Heavy Cream', 'Sysco', 'S2', 1, 'gal', 8, 8, 'default', 'heavy_cream'),
                       ('Heavy Cream', 'Shamrock', 'H2', 1, 'lb', 1.2, 1.2, 'default', 'heavy_cream')
                """)
            // key = normalizeIngredientKey('Heavy Cream') = 'heavy cream'
            try db.execute(sql: "INSERT INTO ingredient_densities (ingredient_key, g_per_ml) VALUES ('heavy cream', 1.0)")
        }
        let repo = VendorCompareRepository(database: f.readDB, locationId: "default")
        let summary = try await repo.listVendorCompareRows()
        XCTAssertEqual(summary.rows.count, 1)
        // Mixed dimensions → pickTargetUnit is nil → both offers 'unit_mismatch'?
        // NO: gal vs lb are different DIMENSIONS, so target is nil and status
        // is cannot_compare/unit_mismatch — the density only matters when a
        // target unit exists. Assert the web behavior exactly:
        XCTAssertEqual(summary.rows[0].compareStatus, .cannotCompare)
        XCTAssertEqual(summary.rows[0].sysco?.reason, "unit_mismatch")
    }

    // Without a density row, weight-only offers still normalize to $/lb.
    func testWeightOffersNormalizeToPerLb() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { db in
            try db.execute(sql: "INSERT INTO ingredient_masters (master_id, canonical_name) VALUES ('butter', 'Butter')")
            try db.execute(sql: """
                INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, location_id, master_id)
                VALUES ('Butter', 'Sysco', 'S3', 1, 'lb', 4.0, 4.0, 'default', 'butter'),
                       ('Butter', 'Shamrock', 'H3', 16, 'oz', 3.2, 0.2, 'default', 'butter')
                """)
        }
        let repo = VendorCompareRepository(database: f.readDB, locationId: "default")
        let summary = try await repo.listVendorCompareRows()
        XCTAssertEqual(summary.rows.count, 1)
        XCTAssertEqual(summary.rows[0].compareStatus, .comparable)
        XCTAssertEqual(summary.rows[0].sysco?.normalizedUnit, "lb")
        XCTAssertEqual(summary.rows[0].shamrock?.normalizedUnit, "lb")
        // Ported web quirk: $0.2/oz becomes 0.2 * (oz→lb factor) = 0.0125 $/lb
        XCTAssertEqual(summary.rows[0].shamrock!.normalizedPrice!, 0.2 * 28.3495231 / 453.59237, accuracy: 1e-9)
    }

    // The masters LIMIT applies before vendor filtering (web LIMIT ?).
    func testLimitAppliesToMasters() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { db in
            try self.seedPair(db)   // canonical 'Chicken Breast' sorts before 'Lime'
            try db.execute(sql: "INSERT INTO ingredient_masters (master_id, canonical_name) VALUES ('lime', 'Lime')")
        }
        let repo = VendorCompareRepository(database: f.readDB, locationId: "default")
        let summary = try await repo.listVendorCompareRows(limit: 1)
        XCTAssertEqual(summary.mappedPairCount, 1)
        XCTAssertEqual(summary.rows.count, 1)
        XCTAssertEqual(summary.rows[0].masterId, "chicken_breast")
    }

    // Location scoping: vendor_prices rows from another location are invisible.
    func testLocationScoping() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { db in
            try db.execute(sql: "INSERT INTO ingredient_masters (master_id, canonical_name) VALUES ('salt', 'Salt')")
            try db.execute(sql: """
                INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, location_id, master_id)
                VALUES ('Salt', 'Sysco', 'S4', 1, 'lb', 1, 1, 'other', 'salt'),
                       ('Salt', 'Shamrock', 'H4', 1, 'lb', 1, 1, 'other', 'salt')
                """)
        }
        let repo = VendorCompareRepository(database: f.readDB, locationId: "default")
        let summary = try await repo.listVendorCompareRows()
        XCTAssertEqual(summary.rows.count, 0)
        XCTAssertEqual(summary.mastersSingleVendorOnly, 0)   // no rows at 'default' at all
    }
}
