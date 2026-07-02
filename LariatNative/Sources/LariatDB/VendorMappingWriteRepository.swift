import Foundation
import GRDB
import LariatModel

/// WRITE layer for the link-vendors boards — behavior parity with
/// `lib/vendorMappingRepo.ts` (`pairCatalogRows`, `attachCatalogRow`).
///
/// Audited-write contract (parity with the web transaction):
///   • ALL rule failures throw `VendorMappingWriteError` BEFORE any write or
///     audit row (422 → .validation, 409 → .conflict, 404 → .notFound).
///   • The mutations and their `audit_events` rows commit — or roll back —
///     in ONE transaction via `AuditedWriteRunner` + `AuditEventWriter`.
///   • `pairCatalogRows` emits 4 audit events (ingredient_masters,
///     2× ingredient_maps, vendor_prices); `attachCatalogRow` emits 2
///     (ingredient_maps, vendor_prices) — same count + payload shapes as the
///     web `postAuditEvent` calls.
///   • The vendor_prices UPDATE affecting 0 rows throws `.notFound` INSIDE
///     the transaction, rolling back the master/map inserts (web L199-201).
///
/// Deliberate divergences (asserted in tests, not "fixed"):
///   • `actor_source` comes from `RegulatedWriteContext` (`native_mac`);
///     the web default is `manager_ui`.
///   • Typed errors instead of HTTP status codes.
///   • PIN gating happens in the ViewModel (`ManagementWrite.requireSession`),
///     the native analog of the route-level `requirePin`.
public struct VendorMappingWriteRepository {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase?

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase? = nil) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    // ── pairCatalogRows (vendorMappingRepo.ts L126-220) ─────────────────

    /// Link one Sysco + one Shamrock catalog row into a (possibly new) master.
    /// Returns the derived `master_id`.
    public func pairCatalogRows(_ input: PairCatalogInput, context: RegulatedWriteContext) throws -> String {
        guard let writeDB else { throw VendorMappingWriteError.persistenceFailed }
        let locationId = context.locationId

        // 422 — empty canonical (web L128-131).
        let canonical = input.canonicalName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !canonical.isEmpty else {
            throw VendorMappingWriteError.validation("Enter a staple name.")
        }

        // 422 — wrong-vendor keys (web L133-134).
        try Self.assertCatalogVendor(input.syscoKey, expected: .sysco)
        try Self.assertCatalogVendor(input.shamrockKey, expected: .shamrock)

        // 422 — name normalizes to nothing (web L136-139).
        guard let masterId = VendorMappingCompute.deriveMasterId(canonical) else {
            throw VendorMappingWriteError.validation("Staple name is too short.")
        }

        // Pre-write rule checks — throw BEFORE any write/audit.
        try readDB.pool.read { db in
            // 409 — same slug already holds a DIFFERENT canonical name (web L141-146).
            if let existingName = try String.fetchOne(
                db,
                sql: "SELECT canonical_name FROM ingredient_masters WHERE master_id = ?",
                arguments: [masterId]
            ), existingName != canonical {
                throw VendorMappingWriteError.conflict("That staple name is already linked.")
            }
            // 404 / 422 / 409 per key (web L148-149).
            try Self.assertNotLinkedElsewhere(db: db, key: input.syscoKey, masterId: masterId, locationId: locationId)
            try Self.assertNotLinkedElsewhere(db: db, key: input.shamrockKey, masterId: masterId, locationId: locationId)
        }

        // ONE transaction: master upsert + 2 maps + 2 VP updates + 4 audits (web L153-217).
        try AuditedWriteRunner.perform(db: writeDB) { db in
            try Self.upsertMaster(db: db, masterId: masterId, canonicalName: canonical)
            try Self.postAudit(
                db: db, context: context, entity: "ingredient_masters",
                payload: MasterPairPayload(masterId: masterId, canonicalName: canonical, op: "vendor_link_pair")
            )

            try Self.insertConfirmedMap(
                db: db, recipeIngredient: canonical,
                vendorIngredient: input.syscoKey.ingredient, locationId: locationId
            )
            try Self.postAudit(
                db: db, context: context, entity: "ingredient_maps",
                payload: MapPayload(
                    recipeIngredient: canonical, vendorIngredient: input.syscoKey.ingredient,
                    status: "confirmed", op: "vendor_link_pair"
                )
            )

            try Self.insertConfirmedMap(
                db: db, recipeIngredient: canonical,
                vendorIngredient: input.shamrockKey.ingredient, locationId: locationId
            )
            try Self.postAudit(
                db: db, context: context, entity: "ingredient_maps",
                payload: MapPayload(
                    recipeIngredient: canonical, vendorIngredient: input.shamrockKey.ingredient,
                    status: "confirmed", op: "vendor_link_pair"
                )
            )

            let syscoChanges = try Self.setVpMasterId(db: db, key: input.syscoKey, masterId: masterId, locationId: locationId)
            let shamChanges = try Self.setVpMasterId(db: db, key: input.shamrockKey, masterId: masterId, locationId: locationId)
            if syscoChanges == 0 || shamChanges == 0 {
                // Throws inside the txn → everything above rolls back (web L199-201).
                throw VendorMappingWriteError.notFound("Catalog row not found.")
            }

            try Self.postAudit(
                db: db, context: context, entity: "vendor_prices",
                payload: VpPairPayload(
                    masterId: masterId, syscoSku: input.syscoKey.sku,
                    shamrockSku: input.shamrockKey.sku, op: "vendor_link_pair"
                )
            )
        }

        return masterId
    }

    // ── attachCatalogRow (vendorMappingRepo.ts L222-289) ────────────────

    /// Attach the missing vendor's catalog row to an existing single-vendor
    /// master. Returns the `master_id`.
    public func attachCatalogRow(_ input: AttachCatalogInput, context: RegulatedWriteContext) throws -> String {
        guard let writeDB else { throw VendorMappingWriteError.persistenceFailed }
        let locationId = context.locationId

        // 422 — no master picked (web L224-227).
        let masterId = input.masterId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !masterId.isEmpty else {
            throw VendorMappingWriteError.validation("Pick a staple.")
        }

        // Pre-write rule checks — throw BEFORE any write/audit.
        let canonicalName: String = try readDB.pool.read { db in
            // 404 — master missing (web L229-234).
            guard let name = try String.fetchOne(
                db,
                sql: "SELECT canonical_name FROM ingredient_masters WHERE master_id = ?",
                arguments: [masterId]
            ) else {
                throw VendorMappingWriteError.notFound("Staple not found.")
            }
            // 409 — must be in exactly-single-vendor state (web L236-240).
            let singles = try VendorMappingRepository.listSingleVendorMasters(db: db, locationId: locationId)
            guard let single = singles.first(where: { $0.masterId == masterId }) else {
                throw VendorMappingWriteError.conflict("Staple already has both vendors or none.")
            }
            // 422 — wrong-vendor key (web L242-244).
            guard VendorMappingCompute.normVendor(input.catalogKey.vendor) == single.missingVendor.rawValue else {
                throw VendorMappingWriteError.validation("Pick a \(single.missingVendor.rawValue) item.")
            }
            // 404 / 422 / 409 (web L246).
            try Self.assertNotLinkedElsewhere(db: db, key: input.catalogKey, masterId: masterId, locationId: locationId)
            return name
        }

        // ONE transaction: 1 map + 1 VP update + 2 audits (web L250-286).
        try AuditedWriteRunner.perform(db: writeDB) { db in
            try Self.insertConfirmedMap(
                db: db, recipeIngredient: canonicalName,
                vendorIngredient: input.catalogKey.ingredient, locationId: locationId
            )
            try Self.postAudit(
                db: db, context: context, entity: "ingredient_maps",
                payload: MapPayload(
                    recipeIngredient: canonicalName, vendorIngredient: input.catalogKey.ingredient,
                    status: "confirmed", op: "vendor_link_attach"
                )
            )

            let changes = try Self.setVpMasterId(db: db, key: input.catalogKey, masterId: masterId, locationId: locationId)
            if changes == 0 {
                throw VendorMappingWriteError.notFound("Catalog row not found.")
            }

            try Self.postAudit(
                db: db, context: context, entity: "vendor_prices",
                payload: VpAttachPayload(
                    masterId: masterId, vendor: input.catalogKey.vendor,   // raw vendor, like web L281
                    sku: input.catalogKey.sku, op: "vendor_link_attach"
                )
            )
        }

        return masterId
    }

    // ── rule-check helpers (web L43-70) ─────────────────────────────────

    /// `assertCatalogVendor` — 422 unless the key's vendor normalizes to the
    /// expected compare vendor.
    static func assertCatalogVendor(_ key: CatalogKey, expected: CompareVendor) throws {
        guard VendorMappingCompute.normVendor(key.vendor) == expected.rawValue else {
            throw VendorMappingWriteError.validation("Expected \(expected.rawValue) catalog row.")
        }
    }

    /// `assertRowExists` — 404 when the (vendor, sku) has no row; 422 when the
    /// latest row's ingredient string differs from the key's.
    static func assertRowExists(
        db: Database, key: CatalogKey, locationId: String
    ) throws -> VendorMappingRepository.LatestVendorPriceRow {
        guard let row = try VendorMappingRepository.getLatestVendorPriceRow(db: db, key: key, locationId: locationId) else {
            throw VendorMappingWriteError.notFound("Catalog row not found.")
        }
        guard row.ingredient == key.ingredient else {
            throw VendorMappingWriteError.validation("Catalog ingredient mismatch.")
        }
        return row
    }

    /// `assertNotLinkedElsewhere` — 409 when the row is already linked to a
    /// DIFFERENT master (blank master_id counts as unlinked, JS falsy).
    static func assertNotLinkedElsewhere(
        db: Database, key: CatalogKey, masterId: String, locationId: String
    ) throws {
        let row = try assertRowExists(db: db, key: key, locationId: locationId)
        if let existing = row.masterId, !existing.isEmpty, existing != masterId {
            throw VendorMappingWriteError.conflict("That item is already linked to another staple.")
        }
    }

    // ── mutation helpers (web L72-124) ──────────────────────────────────

    static func upsertMaster(db: Database, masterId: String, canonicalName: String) throws {
        try db.execute(sql: """
            INSERT INTO ingredient_masters (master_id, canonical_name)
            VALUES (?, ?)
            ON CONFLICT(master_id) DO UPDATE SET
              canonical_name = excluded.canonical_name
            """, arguments: [masterId, canonicalName])
    }

    static func insertConfirmedMap(
        db: Database, recipeIngredient: String, vendorIngredient: String, locationId: String
    ) throws {
        try db.execute(sql: """
            INSERT INTO ingredient_maps (recipe_ingredient, vendor_ingredient, status, location_id)
            VALUES (?, ?, 'confirmed', ?)
            """, arguments: [recipeIngredient, vendorIngredient, locationId])
    }

    /// Returns the number of vendor_prices rows updated (web `info.changes`).
    static func setVpMasterId(
        db: Database, key: CatalogKey, masterId: String, locationId: String
    ) throws -> Int {
        try db.execute(sql: """
            UPDATE vendor_prices
               SET master_id = ?
             WHERE location_id = ?
               AND lower(trim(vendor)) = ?
               AND sku = ?
            """, arguments: [masterId, locationId, VendorMappingCompute.normVendor(key.vendor), key.sku])
        return db.changesCount
    }

    // ── audit plumbing ──────────────────────────────────────────────────

    private static func postAudit<P: Encodable>(
        db: Database, context: RegulatedWriteContext, entity: String, payload: P
    ) throws {
        _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
            entity: entity,
            entityId: nil,   // web passes entity_id: null on every event
            action: .correction,
            actorCookId: context.actorCookId,
            actorSource: context.actorSource,
            payloadJSON: AuditEventWriter.encodePayload(payload),
            shiftDate: context.shiftDate,
            locationId: context.locationId
        ))
    }

    // Payload shapes mirror the web `postAuditEvent` payloads field-for-field
    // (snake_case via `AuditEventWriter.encodePayload`).
    private struct MasterPairPayload: Encodable {
        let masterId: String
        let canonicalName: String
        let op: String
    }

    private struct MapPayload: Encodable {
        let recipeIngredient: String
        let vendorIngredient: String
        let status: String
        let op: String
    }

    private struct VpPairPayload: Encodable {
        let masterId: String
        let syscoSku: String
        let shamrockSku: String
        let op: String
    }

    private struct VpAttachPayload: Encodable {
        let masterId: String
        let vendor: String
        let sku: String
        let op: String
    }
}
