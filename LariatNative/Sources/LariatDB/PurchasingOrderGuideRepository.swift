import Foundation
import GRDB
import LariatModel

/// READ-ONLY repository for the purchasing hub (`app/purchasing/page.jsx`):
/// the `order_guide_items` table (LIMIT 200, `ORDER BY vendor, ingredient`)
/// plus the un-limited COUNT(*) headline, each row enriched per
/// `lib/orderGuideEnrichment.ts` (preferred / lock / mismatch badges).
///
/// Parity notes:
///   • The web page does NOT filter `is_placeholder` — neither do we.
///   • Enrichment resolves the master via the LATEST `vendor_prices` row for
///     the guide row's (vendor, ingredient) — blank master_id is unresolved
///     (JS falsy), yielding a nil enrichment.
public struct PurchasingOrderGuideRepository {
    /// The web page's hard-coded LIMIT 200.
    public static let rowLimit = 200

    private let database: LariatDatabase
    private let locationId: String

    public init(database: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.database = database
        self.locationId = locationId
    }

    public func fetch() async throws -> OrderGuideSummary {
        let locationId = self.locationId
        return try await database.pool.read { db in
            let raw = try OrderGuideItemRow.fetchAll(db, sql: """
                SELECT ingredient, base_qty, unit, vendor, unit_price
                  FROM order_guide_items
                 WHERE location_id = ?
                 ORDER BY vendor, ingredient
                 LIMIT \(Self.rowLimit)
                """, arguments: [locationId])

            let totalCount = try Int.fetchOne(
                db,
                sql: "SELECT COUNT(*) FROM order_guide_items WHERE location_id = ?",
                arguments: [locationId]
            ) ?? 0

            let rows = try raw.enumerated().map { index, row in
                EnrichedOrderGuideRow(
                    id: index,
                    row: row,
                    enrichment: try Self.enrichOrderGuideRow(db: db, row: row, locationId: locationId)
                )
            }
            return OrderGuideSummary(totalCount: totalCount, rows: rows)
        }
    }

    // ── enrichOrderGuideRow (orderGuideEnrichment.ts L72-90) ────────────

    static func enrichOrderGuideRow(
        db: Database, row: OrderGuideItemRow, locationId: String
    ) throws -> OrderGuideEnrichment? {
        guard let master = try resolveMasterForGuideRow(db: db, row: row, locationId: locationId) else {
            return nil
        }
        let guideVendor = VendorMappingCompute.normVendor(row.vendor)
        let preferred = VendorMappingCompute.normVendor(master.preferredVendor)
        let vendorMismatch = !preferred.isEmpty && !guideVendor.isEmpty && preferred != guideVendor
        return OrderGuideEnrichment(
            preferredVendor: master.preferredVendor,
            qualityLocked: master.qualityLocked != 0,
            qualityLockReason: master.qualityLockReason,
            vendorMismatch: vendorMismatch
        )
    }

    // ── resolveMasterForGuideRow (orderGuideEnrichment.ts L24-70) ───────

    struct GuideMaster {
        let masterId: String
        let preferredVendor: String?
        let qualityLocked: Int
        let qualityLockReason: String?
    }

    static func resolveMasterForGuideRow(
        db: Database, row: OrderGuideItemRow, locationId: String
    ) throws -> GuideMaster? {
        let vendor = VendorMappingCompute.normVendor(row.vendor)
        let ingredient = row.ingredient.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !vendor.isEmpty, !ingredient.isEmpty else { return nil }

        let masterId: String? = try String.fetchOne(db, sql: """
            SELECT master_id FROM vendor_prices
             WHERE location_id = ?
               AND lower(trim(vendor)) = ?
               AND ingredient = ?
             ORDER BY imported_at DESC, id DESC
             LIMIT 1
            """, arguments: [locationId, vendor, ingredient])

        // JS: `if (!vp?.master_id) return null` — NULL and '' are both falsy.
        guard let masterId, !masterId.isEmpty else { return nil }

        guard let m = try Row.fetchOne(db, sql: """
            SELECT master_id, preferred_vendor, quality_locked, quality_lock_reason
              FROM ingredient_masters WHERE master_id = ?
            """, arguments: [masterId]) else { return nil }

        return GuideMaster(
            masterId: m["master_id"],
            preferredVendor: m["preferred_vendor"],
            qualityLocked: m["quality_locked"] ?? 0,
            qualityLockReason: m["quality_lock_reason"]
        )
    }
}
