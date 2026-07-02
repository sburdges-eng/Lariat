import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Behavior-parity port of the purchasing hub read path:
/// `app/purchasing/page.jsx` (order_guide_items LIMIT 200 + COUNT) +
/// `lib/orderGuideEnrichment.ts` (preferred / lock / mismatch badges).
final class PurchasingOrderGuideRepositoryTests: XCTestCase {

    private func seedGuideRow(
        _ db: Database, ingredient: String, vendor: String?,
        baseQty: Double? = 1, unit: String? = "cs", unitPrice: Double? = 10.0
    ) throws {
        try db.execute(sql: """
            INSERT INTO order_guide_items (ingredient, base_qty, unit, vendor, unit_price, location_id)
            VALUES (?, ?, ?, ?, ?, 'default')
            """, arguments: [ingredient, baseQty, unit, vendor, unitPrice])
    }

    func testEmptyGuide() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        let repo = PurchasingOrderGuideRepository(database: f.readDB, locationId: "default")
        let summary = try await repo.fetch()
        XCTAssertEqual(summary.totalCount, 0)
        XCTAssertEqual(summary.rows, [])
    }

    // Rows come back ORDER BY vendor, ingredient with dollars passing through.
    func testOrderingAndDollarsPassThrough() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { db in
            try self.seedGuideRow(db, ingredient: "Zucchini", vendor: "Shamrock", unitPrice: 2.25)
            try self.seedGuideRow(db, ingredient: "Avocado", vendor: "Sysco", unitPrice: 1.5)
            try self.seedGuideRow(db, ingredient: "Butter", vendor: "Shamrock", unitPrice: 3.75)
        }
        let repo = PurchasingOrderGuideRepository(database: f.readDB, locationId: "default")
        let summary = try await repo.fetch()
        XCTAssertEqual(summary.totalCount, 3)
        XCTAssertEqual(summary.rows.map(\.row.ingredient), ["Butter", "Zucchini", "Avocado"])
        XCTAssertEqual(summary.rows.map(\.row.vendor), ["Shamrock", "Shamrock", "Sysco"])
        XCTAssertEqual(summary.rows[2].row.unitPrice, 1.5)   // REAL dollars, no conversion
    }

    // No vendor_prices link → nil enrichment (web `resolveMasterForGuideRow` null).
    func testNoMasterYieldsNilEnrichment() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { try self.seedGuideRow($0, ingredient: "Mystery", vendor: "Sysco") }
        let repo = PurchasingOrderGuideRepository(database: f.readDB, locationId: "default")
        let summary = try await repo.fetch()
        XCTAssertNil(summary.rows[0].enrichment)
    }

    // Blank master_id on the latest vendor_prices row is unresolved (JS falsy).
    func testBlankMasterIdYieldsNilEnrichment() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { db in
            try self.seedGuideRow(db, ingredient: "Chicken Breast", vendor: "Sysco")
            try db.execute(sql: """
                INSERT INTO vendor_prices (ingredient, vendor, sku, location_id, unit_price, master_id)
                VALUES ('Chicken Breast', 'Sysco', 'S1', 'default', 4.2, '')
                """)
        }
        let repo = PurchasingOrderGuideRepository(database: f.readDB, locationId: "default")
        let summary = try await repo.fetch()
        XCTAssertNil(summary.rows[0].enrichment)
    }

    // Preferred vendor + lock + mismatch all surface, resolved via the LATEST
    // vendor_prices row for the guide row's (vendor, ingredient).
    func testEnrichmentPreferredLockMismatch() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { db in
            try self.seedGuideRow(db, ingredient: "Chicken Breast", vendor: "Sysco")
            try db.execute(sql: """
                INSERT INTO ingredient_masters (master_id, canonical_name, preferred_vendor, quality_locked, quality_lock_reason)
                VALUES ('chicken_breast', 'Chicken Breast', 'shamrock', 1, 'quality');
                INSERT INTO vendor_prices (ingredient, vendor, sku, location_id, unit_price, master_id)
                VALUES ('Chicken Breast', 'Sysco', 'S1', 'default', 4.2, 'chicken_breast');
                """)
        }
        let repo = PurchasingOrderGuideRepository(database: f.readDB, locationId: "default")
        let summary = try await repo.fetch()
        let e = try XCTUnwrap(summary.rows[0].enrichment)
        XCTAssertEqual(e.preferredVendor, "shamrock")
        XCTAssertTrue(e.qualityLocked)
        XCTAssertEqual(e.qualityLockReason, "quality")
        XCTAssertTrue(e.vendorMismatch)   // guide says Sysco, preferred is shamrock
    }

    // Guide vendor matching the preferred vendor (case/space-insensitive) is
    // NOT a mismatch.
    func testNoMismatchWhenVendorsAgree() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { db in
            try self.seedGuideRow(db, ingredient: "Chicken Breast", vendor: " SYSCO ")
            try db.execute(sql: """
                INSERT INTO ingredient_masters (master_id, canonical_name, preferred_vendor)
                VALUES ('chicken_breast', 'Chicken Breast', 'Sysco');
                INSERT INTO vendor_prices (ingredient, vendor, sku, location_id, unit_price, master_id)
                VALUES ('Chicken Breast', 'Sysco', 'S1', 'default', 4.2, 'chicken_breast');
                """)
        }
        let repo = PurchasingOrderGuideRepository(database: f.readDB, locationId: "default")
        let summary = try await repo.fetch()
        let e = try XCTUnwrap(summary.rows[0].enrichment)
        XCTAssertFalse(e.vendorMismatch)
        XCTAssertFalse(e.qualityLocked)
    }

    // The LATEST vendor_prices row decides the master (imported_at DESC, id DESC).
    func testLatestVendorPriceRowResolvesMaster() async throws {
        let f = try PurchasingFixture.make(); defer { f.cleanup() }
        try f.seed { db in
            try self.seedGuideRow(db, ingredient: "Butter", vendor: "Shamrock")
            try db.execute(sql: """
                INSERT INTO ingredient_masters (master_id, canonical_name, preferred_vendor) VALUES ('butter_new', 'Butter', 'shamrock');
                INSERT INTO vendor_prices (ingredient, vendor, sku, location_id, unit_price, master_id, imported_at)
                VALUES ('Butter', 'Shamrock', 'H1', 'default', 3.0, 'butter_old', datetime('now', '-2 days')),
                       ('Butter', 'Shamrock', 'H1', 'default', 3.2, 'butter_new', datetime('now'));
                """)
        }
        let repo = PurchasingOrderGuideRepository(database: f.readDB, locationId: "default")
        let summary = try await repo.fetch()
        let e = try XCTUnwrap(summary.rows[0].enrichment)
        XCTAssertEqual(e.preferredVendor, "shamrock")
        XCTAssertFalse(e.vendorMismatch)
    }
}
