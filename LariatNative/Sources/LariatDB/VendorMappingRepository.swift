import Foundation
import GRDB
import LariatModel

/// READ layer for the link-vendors boards — behavior parity with
/// `lib/vendorMapping.ts` (`searchVendorCatalog`, `countUnlinkedCatalog`,
/// `listSingleVendorMasters`, `summarizeMappingCoverage`,
/// `getLatestVendorPriceRow`). Writes live in `VendorMappingWriteRepository`.
///
/// The `db:`-level static functions exist so the write repository can run the
/// same reads for its pre-write rule checks (web calls these helpers with the
/// same better-sqlite3 handle).
public struct VendorMappingRepository {
    private let database: LariatDatabase
    private let locationId: String

    public init(database: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.database = database
        self.locationId = locationId
    }

    // ── searchVendorCatalog (vendorMapping.ts L80-139) ──────────────────

    /// Newest-first catalog rows for one vendor, deduped by (vendor, sku)
    /// keeping the latest `imported_at DESC, id DESC` row. Blank SKUs are
    /// excluded; `unlinkedOnly` keeps rows with NULL/blank `master_id`;
    /// `q` is a case-insensitive ingredient substring; limit clamps [1,200]
    /// (default 50).
    public func searchVendorCatalog(
        vendor: CompareVendor,
        q: String? = nil,
        unlinkedOnly: Bool = false,
        limit: Int? = nil
    ) async throws -> [CatalogRow] {
        let locationId = self.locationId
        return try await database.pool.read { db in
            try Self.searchVendorCatalog(
                db: db, vendor: vendor, q: q, unlinkedOnly: unlinkedOnly,
                locationId: locationId, limit: limit
            )
        }
    }

    static func searchVendorCatalog(
        db: Database,
        vendor: CompareVendor,
        q: String?,
        unlinkedOnly: Bool,
        locationId: String,
        limit: Int?
    ) throws -> [CatalogRow] {
        let capped = VendorMappingCompute.clampLimit(limit)
        let trimmedQ = q?.trimmingCharacters(in: .whitespacesAndNewlines)

        var wheres = [
            "location_id = ?",
            "lower(trim(vendor)) = ?",
            "sku IS NOT NULL AND TRIM(sku) != ''",
        ]
        var args: [DatabaseValueConvertible] = [locationId, vendor.rawValue]
        if let trimmedQ, !trimmedQ.isEmpty {
            wheres.append("lower(ingredient) LIKE lower(?)")
            args.append("%\(trimmedQ)%")
        }
        if unlinkedOnly {
            wheres.append("(master_id IS NULL OR TRIM(master_id) = '')")
        }

        let rows = try Row.fetchAll(db, sql: """
            SELECT vendor, sku, ingredient, pack_size, pack_unit, unit_price, master_id
              FROM vendor_prices
             WHERE \(wheres.joined(separator: " AND "))
             ORDER BY imported_at DESC, id DESC
            """, arguments: StatementArguments(args))

        var seen = Set<String>()
        var out: [CatalogRow] = []
        for row in rows {
            guard let v = VendorMappingCompute.compareVendor(row["vendor"]) else { continue }
            let sku: String = row["sku"]
            let dedupe = "\(v.rawValue)\u{1F}\(sku)"
            if seen.contains(dedupe) { continue }
            seen.insert(dedupe)
            out.append(CatalogRow(
                vendor: v,
                sku: sku,
                ingredient: row["ingredient"],
                packLabel: VendorMappingCompute.packLabel(packSize: row["pack_size"], packUnit: row["pack_unit"]),
                unitPrice: row["unit_price"],
                masterId: row["master_id"]
            ))
            if out.count >= capped { break }
        }
        return out
    }

    // ── countUnlinkedCatalog (vendorMapping.ts L141-157) ────────────────

    public func countUnlinkedCatalog() async throws -> (sysco: Int, shamrock: Int) {
        let locationId = self.locationId
        return try await database.pool.read { db in
            try Self.countUnlinkedCatalog(db: db, locationId: locationId)
        }
    }

    static func countUnlinkedCatalog(db: Database, locationId: String) throws -> (sysco: Int, shamrock: Int) {
        func countVendor(_ vendor: CompareVendor) throws -> Int {
            try Int.fetchOne(db, sql: """
                SELECT COUNT(DISTINCT sku) FROM vendor_prices
                 WHERE location_id = ?
                   AND lower(trim(vendor)) = ?
                   AND sku IS NOT NULL AND TRIM(sku) != ''
                   AND (master_id IS NULL OR TRIM(master_id) = '')
                """, arguments: [locationId, vendor.rawValue]) ?? 0
        }
        return (sysco: try countVendor(.sysco), shamrock: try countVendor(.shamrock))
    }

    // ── listSingleVendorMasters (vendorMapping.ts L159-194) ─────────────

    /// Masters linked to EXACTLY one compare vendor, alphabetical by
    /// canonical_name, with the missing vendor derived.
    public func listSingleVendorMasters() async throws -> [SingleVendorMaster] {
        let locationId = self.locationId
        return try await database.pool.read { db in
            try Self.listSingleVendorMasters(db: db, locationId: locationId)
        }
    }

    static func listSingleVendorMasters(db: Database, locationId: String) throws -> [SingleVendorMaster] {
        let masters = try Row.fetchAll(
            db,
            sql: "SELECT master_id, canonical_name FROM ingredient_masters ORDER BY canonical_name ASC"
        )

        var out: [SingleVendorMaster] = []
        for m in masters {
            let masterId: String = m["master_id"]
            let vendorRows = try String.fetchAll(db, sql: """
                SELECT DISTINCT lower(trim(vendor)) AS vendor
                  FROM vendor_prices
                 WHERE location_id = ?
                   AND master_id = ?
                   AND lower(trim(vendor)) IN ('sysco', 'shamrock')
                """, arguments: [locationId, masterId])

            let vendors = Set(vendorRows.compactMap { VendorMappingCompute.compareVendor($0) })
            guard vendors.count == 1, let linked = vendors.first else { continue }
            out.append(SingleVendorMaster(
                masterId: masterId,
                canonicalName: m["canonical_name"],
                linkedVendor: linked,
                missingVendor: linked.counterpart
            ))
        }
        return out
    }

    // ── summarizeMappingCoverage (vendorMapping.ts L196-223) ────────────

    public func summarizeMappingCoverage() async throws -> MappingCoverageSummary {
        let locationId = self.locationId
        return try await database.pool.read { db in
            try Self.summarizeMappingCoverage(db: db, locationId: locationId)
        }
    }

    static func summarizeMappingCoverage(db: Database, locationId: String) throws -> MappingCoverageSummary {
        let pairs = try Int.fetchOne(db, sql: """
            SELECT COUNT(*) FROM (
              SELECT im.master_id
                FROM ingredient_masters im
               WHERE EXISTS (
                 SELECT 1 FROM vendor_prices vp
                  WHERE vp.master_id = im.master_id AND vp.location_id = ? AND lower(trim(vp.vendor)) = 'sysco'
               )
               AND EXISTS (
                 SELECT 1 FROM vendor_prices vp
                  WHERE vp.master_id = im.master_id AND vp.location_id = ? AND lower(trim(vp.vendor)) = 'shamrock'
               )
            )
            """, arguments: [locationId, locationId]) ?? 0

        let unlinked = try countUnlinkedCatalog(db: db, locationId: locationId)
        let singles = try listSingleVendorMasters(db: db, locationId: locationId)
        return MappingCoverageSummary(
            mappedPairs: pairs,
            singleVendor: singles.count,
            unlinkedSysco: unlinked.sysco,
            unlinkedShamrock: unlinked.shamrock
        )
    }

    // ── getLatestVendorPriceRow (vendorMapping.ts L225-245) ─────────────

    struct LatestVendorPriceRow {
        let id: Int64
        let masterId: String?
        let ingredient: String
    }

    static func getLatestVendorPriceRow(
        db: Database, key: CatalogKey, locationId: String
    ) throws -> LatestVendorPriceRow? {
        guard let row = try Row.fetchOne(db, sql: """
            SELECT id, master_id, ingredient FROM vendor_prices
             WHERE location_id = ?
               AND lower(trim(vendor)) = ?
               AND sku = ?
             ORDER BY imported_at DESC, id DESC
             LIMIT 1
            """, arguments: [locationId, VendorMappingCompute.normVendor(key.vendor), key.sku])
        else { return nil }
        return LatestVendorPriceRow(id: row["id"], masterId: row["master_id"], ingredient: row["ingredient"])
    }
}
