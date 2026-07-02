import Foundation
import GRDB
import LariatModel

/// READ-ONLY repository for the vendor-compare board — behavior parity with
/// `listVendorCompareRows` in `lib/vendorCompare.ts` (the pure math lives in
/// `VendorCompareCompute`).
///
/// `ingredient_masters` is GLOBAL (no location_id column); `vendor_prices` and
/// `ingredient_densities` lookups are per the web queries (`vendor_prices`
/// location-scoped, densities keyed by `normalizeIngredientKey`).
///
/// The compare board's WRITE (preferred_vendor / quality_locked /
/// quality_lock_reason) is `IngredientMastersRepository.updateMaster` — the
/// same path the web `CompareActions.jsx` PATCHes — deliberately NOT
/// duplicated here.
public struct VendorCompareRepository {
    private let database: LariatDatabase
    private let locationId: String

    public init(database: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.database = database
        self.locationId = locationId
    }

    /// `listVendorCompareRows(db, opts)` — masters (alphabetical, LIMIT clamped
    /// [1,1000] default 200) → latest sysco+shamrock price per master →
    /// normalized offers → cheaper flag.
    public func listVendorCompareRows(limit: Int? = nil) async throws -> VendorCompareSummary {
        let capped = VendorCompareCompute.clampLimit(limit)
        let locationId = self.locationId
        return try await database.pool.read { db in
            try Self.listVendorCompareRows(db: db, locationId: locationId, limit: capped)
        }
    }

    static func listVendorCompareRows(db: Database, locationId: String, limit: Int) throws -> VendorCompareSummary {
        let masters = try Row.fetchAll(db, sql: """
            SELECT master_id, canonical_name, preferred_vendor, quality_locked, quality_lock_reason
              FROM ingredient_masters
             ORDER BY canonical_name ASC
             LIMIT ?
            """, arguments: [limit])

        var rows: [VendorCompareRow] = []
        var singleVendorOnly = 0

        for m in masters {
            let masterId: String = m["master_id"]
            let byVendor = try latestPricesByVendor(db: db, masterId: masterId, locationId: locationId)
            guard let syscoRow = byVendor[.sysco], let shamrockRow = byVendor[.shamrock] else {
                if !byVendor.isEmpty { singleVendorOnly += 1 }
                continue
            }

            let targetUnit = VendorCompareCompute.pickTargetUnit([syscoRow, shamrockRow])

            // JS: normalizeIngredientKey(syscoRow.ingredient || shamrockRow.ingredient || '')
            let ingredientForKey = !syscoRow.ingredient.isEmpty ? syscoRow.ingredient : shamrockRow.ingredient
            let key = IngredientKey.normalize(ingredientForKey)
            let density: Double? = key.isEmpty ? nil : try Double.fetchOne(
                db,
                sql: "SELECT g_per_ml FROM ingredient_densities WHERE ingredient_key = ?",
                arguments: [key]
            )

            let sysco = VendorCompareCompute.buildOffer(vendor: .sysco, row: syscoRow, targetUnit: targetUnit, density: density)
            let shamrock = VendorCompareCompute.buildOffer(vendor: .shamrock, row: shamrockRow, targetUnit: targetUnit, density: density)
            let comparable = sysco.status == .ok && shamrock.status == .ok
            let lockedInt: Int = m["quality_locked"] ?? 0
            let locked = lockedInt != 0
            let preferredVendor: String? = m["preferred_vendor"]

            rows.append(VendorCompareRow(
                masterId: masterId,
                canonicalName: m["canonical_name"],
                preferredVendor: preferredVendor,
                qualityLocked: locked,
                qualityLockReason: m["quality_lock_reason"],
                sysco: sysco,
                shamrock: shamrock,
                compareStatus: comparable ? .comparable : .cannotCompare,
                cheaperVendor: VendorCompareCompute.pickCheaper(
                    sysco: sysco, shamrock: shamrock, preferred: preferredVendor, locked: locked
                )
            ))
        }

        return VendorCompareSummary(
            mappedPairCount: masters.count,
            mastersWithBothVendors: rows.count,
            mastersSingleVendorOnly: singleVendorOnly,
            rows: rows
        )
    }

    /// `latestPricesByVendor` (vendorCompare.ts L165-191) — newest row per
    /// compare vendor by `imported_at DESC, id DESC`.
    static func latestPricesByVendor(
        db: Database, masterId: String, locationId: String
    ) throws -> [CompareVendor: VendorPriceOfferRow] {
        let fetched = try VendorPriceOfferRow.fetchAll(db, sql: """
            SELECT vendor, sku, ingredient, pack_size, pack_unit, pack_price, unit_price,
                   reconciled_unit_price, master_id
              FROM vendor_prices
             WHERE location_id = ?
               AND master_id = ?
               AND lower(trim(vendor)) IN ('sysco', 'shamrock')
             ORDER BY lower(trim(vendor)), imported_at DESC, id DESC
            """, arguments: [locationId, masterId])

        var out: [CompareVendor: VendorPriceOfferRow] = [:]
        for row in fetched {
            guard let v = VendorMappingCompute.compareVendor(row.vendor), out[v] == nil else { continue }
            out[v] = row
        }
        return out
    }
}
