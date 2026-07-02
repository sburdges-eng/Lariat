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

    // ── PATCH — updateMaster (repo L222-292) — the ONE audited write ─────

    /// Partial update + one `audit_events` row (`action='correction'`,
    /// `actor_source='native_mac'`) in ONE transaction. `validateMasterUpdates`
    /// throws BEFORE the transaction opens — a rejected update leaves neither
    /// a row change nor an audit row. Empty `updates` -> `changed=false`, no
    /// audit (repo L268-270). Missing `masterId` -> `found=false`, no write
    /// (repo L229-232) — this is a return, not a throw, matching the web
    /// `UpdateMasterResult` shape.
    public func updateMaster(
        _ masterId: String,
        updates: IngredientMasterUpdates,
        context: RegulatedWriteContext
    ) throws -> UpdateMasterResult {
        guard let writeDB else { throw IngredientMasterWriteError.persistenceFailed }

        guard let before = try getMaster(masterId) else {
            return UpdateMasterResult(found: false, changed: false, before: nil, after: nil)
        }

        // Rule-failure MUST throw before any write (audited-write ordering contract).
        try IngredientMastersCompute.validateMasterUpdates(before: before, updates: updates)

        // Field-shape parity with route.js L84-144, folded into the write path
        // since native has no separate HTTP layer: canonical_name non-empty +
        // clip 200; category/preferred_vendor/quality_lock_reason clip-to-null 80.
        var canonicalNameValue: String?
        if case .set(let v) = updates.canonicalName {
            canonicalNameValue = try IngredientMastersCompute.validateCanonicalName(v, max: 200)
        }

        var sets: [String] = []
        var args: [DatabaseValueConvertible?] = []
        if let canonicalNameValue {
            sets.append("canonical_name = ?")
            args.append(canonicalNameValue)
        }
        if case .set(let v) = updates.category {
            sets.append("category = ?")
            args.append(IngredientMastersCompute.clipOrNull(v, max: 80))
        }
        if case .set(let v) = updates.preferredVendor {
            sets.append("preferred_vendor = ?")
            args.append(IngredientMastersCompute.clipOrNull(v, max: 80))
        }
        if case .set(let b) = updates.qualityLocked {
            sets.append("quality_locked = ?")
            args.append(b ? 1 : 0)
        }
        if case .set(let v) = updates.qualityLockReason {
            sets.append("quality_lock_reason = ?")
            args.append(IngredientMastersCompute.clipOrNull(v, max: 80))
        }
        if case .set(let lr) = updates.lastReviewed {
            switch lr {
            case .now:
                sets.append("last_reviewed = datetime('now')")   // repo L261-262 — literal SQL, not bound
            case .clear:
                sets.append("last_reviewed = ?")
                args.append(nil)
            case .iso(let s):
                sets.append("last_reviewed = ?")
                args.append(s)
            }
        }

        if sets.isEmpty {
            return UpdateMasterResult(found: true, changed: false, before: before, after: before)
        }

        let locationId = context.locationId
        try AuditedWriteRunner.perform(db: writeDB) { db in
            var updateArgs = args
            updateArgs.append(masterId)
            try db.execute(
                sql: "UPDATE ingredient_masters SET \(sets.joined(separator: ", ")) WHERE master_id = ?",
                arguments: StatementArguments(updateArgs)
            )
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "ingredient_masters",
                    entityId: nil,   // repo L281 — master_id is TEXT, not int; payload carries it
                    action: .correction,
                    actorCookId: context.actorCookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(
                        IngredientMasterAuditPayload(masterId: masterId, updates: updates)
                    ),
                    shiftDate: context.shiftDate,
                    locationId: locationId
                )
            )
        }

        let after = try getMaster(masterId)
        return UpdateMasterResult(found: true, changed: true, before: before, after: after)
    }
}

/// Mirrors `UpdateMasterResult` in `lib/ingredientMastersRepo.ts:172-177`.
public struct UpdateMasterResult: Sendable, Equatable {
    public let found: Bool
    public let changed: Bool
    public let before: IngredientMasterRow?
    public let after: IngredientMasterRow?
}

/// Structured `{master_id, updates}` payload — parity with repo L285-286
/// (`payload: { master_id: masterId, updates }`). Only fields PRESENT in the
/// update are encoded (mirrors JS forwarding only own-property fields);
/// `FieldChange.absent` fields are omitted entirely, not encoded as null.
private struct IngredientMasterAuditPayload: Encodable {
    let masterId: String
    let updates: IngredientMasterUpdates

    enum CodingKeys: String, CodingKey { case masterId = "master_id", updates }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(masterId, forKey: .masterId)
        try container.encode(UpdatesPayload(updates), forKey: .updates)
    }

    /// Nested `updates` object — one key per PRESENT field, using snake_case
    /// keys to match the web payload's field names exactly.
    private struct UpdatesPayload: Encodable {
        let updates: IngredientMasterUpdates
        init(_ updates: IngredientMasterUpdates) { self.updates = updates }

        enum CodingKeys: String, CodingKey {
            case canonicalName = "canonical_name", category, preferredVendor = "preferred_vendor",
                 qualityLocked = "quality_locked", qualityLockReason = "quality_lock_reason",
                 lastReviewed = "last_reviewed"
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            if case .set(let v) = updates.canonicalName {
                try container.encode(v, forKey: .canonicalName)
            }
            if case .set(let v) = updates.category {
                try container.encode(v, forKey: .category)
            }
            if case .set(let v) = updates.preferredVendor {
                try container.encode(v, forKey: .preferredVendor)
            }
            if case .set(let v) = updates.qualityLocked {
                try container.encode(v, forKey: .qualityLocked)
            }
            if case .set(let v) = updates.qualityLockReason {
                try container.encode(v, forKey: .qualityLockReason)
            }
            if case .set(let lr) = updates.lastReviewed {
                switch lr {
                case .now: try container.encode("now", forKey: .lastReviewed)
                case .clear: try container.encodeNil(forKey: .lastReviewed)
                case .iso(let s): try container.encode(s, forKey: .lastReviewed)
                }
            }
        }
    }
}
