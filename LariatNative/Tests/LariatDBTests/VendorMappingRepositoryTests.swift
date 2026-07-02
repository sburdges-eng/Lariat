import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Behavior-parity port of the read layer in `lib/vendorMapping.ts`.
/// Parity oracle: `tests/js/test-vendor-mapping.mjs` ('vendorMapping read layer').
final class VendorMappingRepositoryTests: XCTestCase {

    // ── seedCatalog (mirror test-vendor-mapping.mjs L25-48) ─────────────

    private func seedCatalog(_ db: Database) throws {
        try db.execute(sql: """
            INSERT INTO ingredient_masters (master_id, canonical_name) VALUES ('chicken_breast', 'Chicken Breast');
            INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, unit_price, location_id, master_id)
            VALUES ('CHICKEN BREAST B/S', 'Sysco', 'S123', 1, 'lb', 4.2, 'default', NULL);
            INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, unit_price, location_id, master_id)
            VALUES ('CHICKEN BRST BNLS', 'Shamrock', 'H456', 1, 'lb', 3.9, 'default', NULL);
            INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, unit_price, location_id, master_id)
            VALUES ('Avocado', 'Sysco', 'S99', 1, 'each', 1.5, 'default', 'avocado');
            INSERT INTO ingredient_masters (master_id, canonical_name) VALUES ('avocado', 'Avocado');
            INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, unit_price, location_id, master_id)
            VALUES ('Avocado Hass', 'Shamrock', 'H99', 1, 'each', 1.4, 'default', 'avocado');
            """)
    }

    // Oracle: 'search returns unlinked chicken when unlinkedOnly'
    func testSearchUnlinkedChicken() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { try self.seedCatalog($0) }
        let repo = VendorMappingRepository(database: f.readDB, locationId: "default")
        let rows = try await repo.searchVendorCatalog(vendor: .sysco, q: "chicken", unlinkedOnly: true)
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].sku, "S123")
        XCTAssertNil(rows[0].masterId)
        XCTAssertEqual(rows[0].vendor, .sysco)
        XCTAssertEqual(rows[0].packLabel, "1 lb")
        XCTAssertEqual(rows[0].unitPrice, 4.2)   // REAL dollars pass through
    }

    // Oracle: 'linked sysco avocado excluded when unlinkedOnly'
    func testLinkedRowExcludedWhenUnlinkedOnly() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { try self.seedCatalog($0) }
        let repo = VendorMappingRepository(database: f.readDB, locationId: "default")
        let rows = try await repo.searchVendorCatalog(vendor: .sysco, q: "avocado", unlinkedOnly: true)
        XCTAssertEqual(rows.count, 0)
    }

    // Oracle: 'lists single-vendor master missing shamrock'
    func testSingleVendorMasterMissingShamrock() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { db in
            try db.execute(sql: "INSERT INTO ingredient_masters (master_id, canonical_name) VALUES ('lime', 'Lime')")
            try db.execute(sql: """
                INSERT INTO vendor_prices (ingredient, vendor, sku, location_id, master_id, pack_size, pack_unit, unit_price)
                VALUES ('Lime', 'Sysco', 'S1', 'default', 'lime', 1, 'each', 0.25)
                """)
        }
        let repo = VendorMappingRepository(database: f.readDB, locationId: "default")
        let singles = try await repo.listSingleVendorMasters()
        XCTAssertEqual(singles.count, 1)
        XCTAssertEqual(singles[0].masterId, "lime")
        XCTAssertEqual(singles[0].linkedVendor, .sysco)
        XCTAssertEqual(singles[0].missingVendor, .shamrock)
    }

    // Oracle: 'coverage counts match fixture'
    func testCoverageCountsMatchFixture() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { try self.seedCatalog($0) }
        let repo = VendorMappingRepository(database: f.readDB, locationId: "default")
        let c = try await repo.summarizeMappingCoverage()
        XCTAssertEqual(c.mappedPairs, 1)       // avocado has both vendors linked
        XCTAssertEqual(c.unlinkedSysco, 1)     // S123
        XCTAssertEqual(c.unlinkedShamrock, 1)  // H456
        XCTAssertEqual(c.singleVendor, 0)
    }

    // Dedup by (vendor, sku): the LATEST imported_at row wins.
    func testSearchDedupesByVendorSkuKeepingLatest() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { db in
            try db.execute(sql: """
                INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, unit_price, location_id, imported_at)
                VALUES ('Old Name', 'Sysco', 'S777', 1, 'lb', 5.0, 'default', datetime('now', '-2 days')),
                       ('New Name', 'Sysco', 'S777', 2, 'lb', 5.5, 'default', datetime('now'))
                """)
        }
        let repo = VendorMappingRepository(database: f.readDB, locationId: "default")
        let rows = try await repo.searchVendorCatalog(vendor: .sysco)
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].ingredient, "New Name")
        XCTAssertEqual(rows[0].packLabel, "2 lb")
        XCTAssertEqual(rows[0].unitPrice, 5.5)
    }

    // Blank/NULL SKUs are excluded (web `sku IS NOT NULL AND TRIM(sku) != ''`).
    func testSearchExcludesBlankSkus() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { db in
            try db.execute(sql: """
                INSERT INTO vendor_prices (ingredient, vendor, sku, location_id, unit_price)
                VALUES ('No Sku', 'Sysco', NULL, 'default', 1.0),
                       ('Blank Sku', 'Sysco', '  ', 'default', 1.0),
                       ('Has Sku', 'Sysco', 'S1', 'default', 1.0)
                """)
        }
        let repo = VendorMappingRepository(database: f.readDB, locationId: "default")
        let rows = try await repo.searchVendorCatalog(vendor: .sysco)
        XCTAssertEqual(rows.map(\.sku), ["S1"])
    }

    // Blank master_id counts as unlinked (web `TRIM(master_id) = ''`).
    func testBlankMasterIdCountsAsUnlinked() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { db in
            try db.execute(sql: """
                INSERT INTO vendor_prices (ingredient, vendor, sku, location_id, unit_price, master_id)
                VALUES ('Thing', 'Shamrock', 'H1', 'default', 1.0, ' ')
                """)
        }
        let repo = VendorMappingRepository(database: f.readDB, locationId: "default")
        let rows = try await repo.searchVendorCatalog(vendor: .shamrock, unlinkedOnly: true)
        XCTAssertEqual(rows.count, 1)
        let counts = try await repo.countUnlinkedCatalog()
        XCTAssertEqual(counts.shamrock, 1)
        XCTAssertEqual(counts.sysco, 0)
    }

    // limit clamps [1, 200] with default 50 (clamp math unit-tested in
    // VendorMappingComputeTests; here just the SQL-side effect for a small n).
    func testSearchLimit() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { db in
            for i in 0..<3 {
                try db.execute(sql: """
                    INSERT INTO vendor_prices (ingredient, vendor, sku, location_id, unit_price)
                    VALUES ('Item \(i)', 'Sysco', 'SKU-\(i)', 'default', 1.0)
                    """)
            }
        }
        let repo = VendorMappingRepository(database: f.readDB, locationId: "default")
        let two = try await repo.searchVendorCatalog(vendor: .sysco, limit: 2)
        XCTAssertEqual(two.count, 2)
        let clampedLow = try await repo.searchVendorCatalog(vendor: .sysco, limit: 0)
        XCTAssertEqual(clampedLow.count, 1)
    }

    // q is trimmed and case-insensitive (web `lower(ingredient) LIKE lower(@q)`).
    func testSearchQueryTrimAndCase() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { try self.seedCatalog($0) }
        let repo = VendorMappingRepository(database: f.readDB, locationId: "default")
        let rows = try await repo.searchVendorCatalog(vendor: .sysco, q: "  ChIcKeN  ")
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].sku, "S123")
    }
}
