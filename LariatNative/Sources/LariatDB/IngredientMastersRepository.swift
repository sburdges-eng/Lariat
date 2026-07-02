import Foundation
import GRDB
import LariatModel

/// Reads/writes the `ingredient_masters` table — behavior parity with
/// `lib/ingredientMastersRepo.ts` (`listMasters`, `getMaster`, `updateMaster`).
/// `ingredient_masters` is a GLOBAL table (no `location_id` column — db.ts
/// L1445-1453); `vendor_prices`/`bom_lines` DO carry `location_id` + `master_id`,
/// used only for the count joins here (not location-filtered — the web repo
/// doesn't filter by location either).
///
/// Reads go through `LariatDatabase` (read-only pool). The ONE regulated write
/// (`updateMaster`) goes through `AuditedWriteRunner` so the `ingredient_masters`
/// UPDATE and its `audit_events` row (action='correction') commit — or roll
/// back — in ONE transaction. Writes are tagged `actor_source = native_mac`
/// (web PATCH passes `manager_ui` — a deliberate native divergence).
///
/// NOT ported: the web wraps its PATCH route in `withIdempotency` (an
/// `idempotency_keys`-table dedupe layer). Native has no idempotency layer —
/// deferred, documented here per the plan's Global Constraints.
public struct IngredientMastersRepository {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase?

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase? = nil) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    // ── GET — listMasters (repo L80-130) ────────────────────────────────

    public func list(q: String? = nil, filter: IngredientMasterFilter = .all, limit: Int = 200) async throws -> [IngredientMasterRow] {
        // clampLimit (repo L64-69 / route.js L26-31): default 200, clamp to [1, 1000].
        let capped = max(1, min(1000, limit))

        var wheres: [String] = []
        var args: [DatabaseValueConvertible] = []
        if let t = q?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty {
            wheres.append("(lower(im.master_id) LIKE lower(?) OR lower(im.canonical_name) LIKE lower(?))")
            args.append("%\(t)%")
            args.append("%\(t)%")
        }
        switch filter {
        case .needsReview:
            wheres.append("(im.last_reviewed IS NULL OR julianday('now') - julianday(im.last_reviewed) > \(IngredientMastersCompute.staleAfterDays))")
        case .reviewed:
            wheres.append("(im.last_reviewed IS NOT NULL AND julianday('now') - julianday(im.last_reviewed) <= \(IngredientMastersCompute.staleAfterDays))")
        case .all:
            break
        }
        let whereSql = wheres.isEmpty ? "" : "WHERE \(wheres.joined(separator: " AND "))"

        let sql = """
          SELECT im.master_id, im.canonical_name, im.category, im.preferred_vendor,
                 im.quality_locked, im.quality_lock_reason, im.last_reviewed,
                 COALESCE(vp.cnt,0) AS vendor_price_count,
                 COALESCE(bl.cnt,0) AS bom_line_count,
                 CASE WHEN im.last_reviewed IS NULL THEN 1
                      WHEN julianday('now') - julianday(im.last_reviewed) > \(IngredientMastersCompute.staleAfterDays) THEN 1
                      ELSE 0 END AS needs_review
            FROM ingredient_masters im
            LEFT JOIN (SELECT master_id, COUNT(*) AS cnt FROM vendor_prices WHERE master_id IS NOT NULL GROUP BY master_id) vp
              ON vp.master_id = im.master_id
            LEFT JOIN (SELECT master_id, COUNT(*) AS cnt FROM bom_lines WHERE master_id IS NOT NULL GROUP BY master_id) bl
              ON bl.master_id = im.master_id
            \(whereSql)
           ORDER BY needs_review DESC, vendor_price_count DESC, im.canonical_name ASC
           LIMIT ?
        """
        args.append(capped)

        return try await readDB.pool.read { db in
            let rows = try Row.fetchAll(db, sql: sql, arguments: StatementArguments(args))
            return rows.map(Self.mapRow)
        }
    }

    // ── GET — getMaster (repo L132-160) ─────────────────────────────────

    /// Sync — reused inside the write txn's read leg + by list callers.
    public func getMaster(_ masterId: String) throws -> IngredientMasterRow? {
        try readDB.pool.read { db in try Self.getMaster(db: db, masterId: masterId) }
    }

    static func getMaster(db: Database, masterId: String) throws -> IngredientMasterRow? {
        let sql = """
          SELECT im.master_id, im.canonical_name, im.category, im.preferred_vendor,
                 im.quality_locked, im.quality_lock_reason, im.last_reviewed,
                 COALESCE(vp.cnt,0) AS vendor_price_count,
                 COALESCE(bl.cnt,0) AS bom_line_count
            FROM ingredient_masters im
            LEFT JOIN (SELECT master_id, COUNT(*) AS cnt FROM vendor_prices WHERE master_id IS NOT NULL GROUP BY master_id) vp
              ON vp.master_id = im.master_id
            LEFT JOIN (SELECT master_id, COUNT(*) AS cnt FROM bom_lines WHERE master_id IS NOT NULL GROUP BY master_id) bl
              ON bl.master_id = im.master_id
           WHERE im.master_id = ?
        """
        guard let row = try Row.fetchOne(db, sql: sql, arguments: [masterId]) else { return nil }
        return mapRow(row)
    }

    /// Explicit column mapping so `needs_review` (present only in `list`'s SQL)
    /// never needs to round-trip through `IngredientMasterRow`'s `Decodable`
    /// conformance — keeps the record type clean for both call sites.
    private static func mapRow(_ r: Row) -> IngredientMasterRow {
        IngredientMasterRow(
            masterId: r["master_id"],
            canonicalName: r["canonical_name"],
            category: r["category"],
            preferredVendor: r["preferred_vendor"],
            qualityLocked: r["quality_locked"],
            qualityLockReason: r["quality_lock_reason"],
            lastReviewed: r["last_reviewed"],
            vendorPriceCount: r["vendor_price_count"],
            bomLineCount: r["bom_line_count"]
        )
    }
}
