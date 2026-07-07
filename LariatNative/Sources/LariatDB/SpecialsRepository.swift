import Foundation
import GRDB
import LariatModel

/// Typed write errors for the saved-specials board — each case maps to a web
/// route status branch (asserted in `SpecialsRepositoryTests`).
public enum SpecialsWriteError: Error, Equatable, Sendable, LocalizedError {
    case missingWriteDatabase
    /// 404 branches (`not found`).
    case notFound
    /// 410 (`special is archived`).
    case archived
    /// 409 on export (`slug already exists`).
    case slugExists(String)
    /// 400 on promote (`no costed ingredients to promote …`).
    case noCostableComponents
    /// 400 on PATCH with an empty patch (`no fields to update`).
    case noFieldsToUpdate
    /// 400 on create (`no session content to save`).
    case noSessionContent
    /// 400 on promote (`servings must be a positive finite number`).
    case invalidServings
    /// 400 on promote: web relabels the shared validator's `name` error to
    /// `menu_item_name` (route.js `.replace(/^name/, 'menu_item_name')`).
    case menuItemNameRequired
    case menuItemNameTooLong

    public var errorDescription: String? {
        switch self {
        case .missingWriteDatabase: return "Could not open the write database"
        case .notFound: return "not found"
        case .archived: return "special is archived"
        case .slugExists(let slug): return "slug already exists: \(slug)"
        case .noCostableComponents:
            return "no costed ingredients to promote — run the cost action and match vendor items first"
        case .noFieldsToUpdate: return "no fields to update"
        case .noSessionContent: return "no session content to save"
        case .invalidServings: return "servings must be a positive finite number"
        case .menuItemNameRequired: return "menu_item_name required"
        case .menuItemNameTooLong: return "menu_item_name max \(SpecialsValidators.nameMax) chars"
        }
    }
}

/// Reads/writes the saved-specials corpus — behavior parity with
/// `app/api/specials/saved/*` (create/list/get/patch/soft-delete),
/// `…/[id]/export` (CSV build + `last_exported_at`), and `…/[id]/promote`
/// (`lib/specialsPromotion.ts promoteSpecialToMenu`).
///
/// AUDIT POSTURE — web parity, pinned by tests:
///   • create / update / delete / export write NO `audit_events` row (the web
///     routes post none); each writes its `specials.*` JSONL line INSIDE the
///     same write transaction (`db.transaction(() => { stmt.run(); logAuditAction() })`).
///   • promote writes the `specials_promotion` `audit_events` row in the SAME
///     transaction as the `dish_components` + `specials_promotions` writes
///     (`postAuditEvent` inside the txn), then the `specials.promote` JSONL
///     line AFTER commit (route-level `logAuditAction`).
///   • Rule failures throw typed errors BEFORE any write.
///
/// Deliberate divergences (documented per the A4/A5 precedent, asserted in
/// tests): no `withIdempotency` layer; `actor_source` = `native_mac` from
/// `RegulatedWriteContext` (web stamps `pic_ui` on promote), and the promote
/// audit row carries the PIN user as `actor_cook_id` (web sends null — native
/// has a real actor identity, so recording it is strictly more audit signal).
public struct SpecialsRepository {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase?
    private let auditLog: SpecialsAuditLog

    public init(
        readDB: LariatDatabase,
        writeDB: LariatWriteDatabase? = nil,
        auditPath: String = resolveManagementAuditPath()
    ) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.auditLog = SpecialsAuditLog(auditPath: auditPath)
    }

    // ── list (GET /api/specials/saved + /specials/saved page join) ─────────

    /// Active rows newest-first, LEFT JOINed to promotions for the
    /// "On menu as …" badge (the server page's query).
    public func list(locationId: String = LocationScope.resolve()) async throws -> [SpecialListItem] {
        try await readDB.pool.read { db in
            try SpecialListItem.fetchAll(db, sql: """
                SELECT s.id, s.name, s.ai_answer, s.cost_total, s.last_exported_at, s.created_at,
                       p.menu_item_name AS promoted_menu_item, p.promoted_at
                  FROM specials s
                  LEFT JOIN specials_promotions p
                    ON p.special_id = s.id AND p.location_id = s.location_id
                 WHERE s.location_id = ? AND s.archived_at IS NULL
                 ORDER BY s.created_at DESC
                """, arguments: [locationId])
        }
    }

    // ── get (GET /api/specials/saved/[id]) ──────────────────────────────────

    /// Full record (including archived rows, like the web GET) plus its
    /// promotion record; nil when absent in this location (404).
    public func get(
        id: String, locationId: String = LocationScope.resolve()
    ) async throws -> (special: SpecialRecord, promotion: SpecialsPromotionRecord?)? {
        try await readDB.pool.read { db in
            guard let row = try SpecialRecord.fetchOne(db,
                sql: "SELECT * FROM specials WHERE id = ? AND location_id = ?",
                arguments: [id, locationId]) else { return nil }
            let promo = try SpecialsPromotionRecord.fetchOne(db,
                sql: "SELECT * FROM specials_promotions WHERE special_id = ? AND location_id = ?",
                arguments: [id, locationId])
            return (row, promo)
        }
    }

    // ── create (POST /api/specials/saved) ───────────────────────────────────

    /// Validate → clip → INSERT + `specials.create` JSONL in one transaction.
    /// Returns the new UUIDv7 id.
    @discardableResult
    public func create(
        _ draft: SpecialDraft, locationId: String = LocationScope.resolve()
    ) throws -> String {
        guard let writeDB else { throw SpecialsWriteError.missingWriteDatabase }

        let name = try SpecialsValidators.validateName(draft.name)
        let trimmedPantry = draft.pantryText.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedPrompt = draft.promptText.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedAnswer = draft.aiAnswer.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedPantry.isEmpty && trimmedPrompt.isEmpty && trimmedAnswer.isEmpty {
            throw SpecialsWriteError.noSessionContent
        }
        let costBreakdown = try SpecialsValidators.validateJsonField(draft.costBreakdownJson, field: "cost_breakdown")
        let sources = try SpecialsValidators.validateJsonField(draft.sourcesJson, field: "sources")
        let costTotal = (draft.costTotal?.isFinite == true) ? draft.costTotal : nil

        let id = UuidV7.generate()
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let log = auditLog

        try writeDB.write { db in
            try db.execute(sql: """
                INSERT INTO specials
                  (id, location_id, name, pantry_text, prompt_text, ai_answer, ai_model,
                   cost_breakdown, cost_total, scratch_notes, sources, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, arguments: [
                    id, locationId, name,
                    // User-editable fields are clipped (audit §5); ai_answer is
                    // intentionally uncapped — clipping mid-LLM-markdown would
                    // corrupt the recipe / cost breakdown (web comment).
                    SpecialsValidators.clipText(draft.pantryText, max: SpecialsValidators.pantryTextMax),
                    SpecialsValidators.clipText(draft.promptText, max: SpecialsValidators.promptTextMax),
                    draft.aiAnswer, draft.aiModel,
                    costBreakdown, costTotal,
                    SpecialsValidators.clipText(draft.scratchNotes, max: SpecialsValidators.scratchNotesMax),
                    sources, now, now,
                ])
            try log.logCreate(specialId: id, name: name, locationId: locationId)
        }
        return id
    }

    // ── update (PATCH /api/specials/saved/[id]) ─────────────────────────────

    /// Patch `name` / `scratch_notes` only (the web's ALLOWED_PATCH_KEYS —
    /// captured session fields are immutable). Bumps `updated_at`, writes the
    /// `specials.update` JSONL line in the same transaction. Only active
    /// (non-archived) rows are patchable, matching the web's `loadRow`.
    public func update(
        id: String, name: String? = nil, scratchNotes: String? = nil,
        locationId: String = LocationScope.resolve()
    ) throws {
        guard let writeDB else { throw SpecialsWriteError.missingWriteDatabase }
        if name == nil && scratchNotes == nil { throw SpecialsWriteError.noFieldsToUpdate }

        var updates: [(column: String, value: DatabaseValueConvertible)] = []
        var changed: [String] = []
        if let name {
            updates.append(("name", try SpecialsValidators.validateName(name)))
            changed.append("name")
        }
        if let scratchNotes {
            updates.append(("scratch_notes",
                            SpecialsValidators.clipText(scratchNotes, max: SpecialsValidators.scratchNotesMax)))
            changed.append("scratch_notes")
        }
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let log = auditLog

        try writeDB.write { db in
            let exists = try Bool.fetchOne(db, sql: """
                SELECT EXISTS(
                  SELECT 1 FROM specials
                   WHERE id = ? AND location_id = ? AND archived_at IS NULL)
                """, arguments: [id, locationId]) ?? false
            guard exists else { throw SpecialsWriteError.notFound }

            let setSql = updates.map { "\($0.column) = ?" }.joined(separator: ", ")
            var arguments = updates.map(\.value)
            arguments.append(now)
            arguments.append(id)
            arguments.append(locationId)
            try db.execute(
                sql: "UPDATE specials SET \(setSql), updated_at = ? WHERE id = ? AND location_id = ?",
                arguments: StatementArguments(arguments))
            try log.logUpdate(specialId: id, changed: changed, locationId: locationId)
        }
    }

    // ── archive (DELETE /api/specials/saved/[id]) ───────────────────────────

    /// Soft delete. Idempotent: re-deleting an archived row is ok (returns
    /// false, writes nothing — the web returns early with `{ok:true}` and no
    /// JSONL line). Unknown id throws `.notFound`.
    @discardableResult
    public func archive(
        id: String, locationId: String = LocationScope.resolve()
    ) throws -> Bool {
        guard let writeDB else { throw SpecialsWriteError.missingWriteDatabase }
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let log = auditLog

        return try writeDB.write { db in
            guard let archivedAt = try Row.fetchOne(db,
                sql: "SELECT archived_at FROM specials WHERE id = ? AND location_id = ?",
                arguments: [id, locationId])
            else { throw SpecialsWriteError.notFound }
            if (archivedAt["archived_at"] as Int64?) != nil { return false }

            try db.execute(
                sql: "UPDATE specials SET archived_at = ?, updated_at = ? WHERE id = ? AND location_id = ?",
                arguments: [now, now, id, locationId])
            try log.logDelete(specialId: id, locationId: locationId)
            return true
        }
    }

    // ── export (POST /api/specials/saved/[id]/export) ───────────────────────

    public struct ExportInput: Sendable {
        public var slug: String
        public var yieldQty: Double
        public var yieldUnit: String
        public var category: String?
        public var procedureOverride: String?

        public init(slug: String, yieldQty: Double, yieldUnit: String,
                    category: String? = nil, procedureOverride: String? = nil) {
            self.slug = slug
            self.yieldQty = yieldQty
            self.yieldUnit = yieldUnit
            self.category = category
            self.procedureOverride = procedureOverride
        }
    }

    public struct ExportResult: Sendable, Equatable {
        public let recipeRow: SpecialsExport.RecipeRow
        public let ingredientRows: [SpecialsExport.IngredientRow]
        public let skipped: [SpecialsExport.IngredientRow]
        public let csv: String
    }

    /// Validations throw before any write (route 400s); archived → `.archived`
    /// (410); slug collision vs `entities_recipes` → `.slugExists` (409, with
    /// the web's missing-table tolerance). Updates `last_exported_at` and
    /// writes the `specials.export` JSONL line in one transaction.
    public func export(
        id: String, input: ExportInput, locationId: String = LocationScope.resolve()
    ) throws -> ExportResult {
        guard let writeDB else { throw SpecialsWriteError.missingWriteDatabase }

        let slug = try SpecialsValidators.validateSlug(input.slug)
        let yieldQty = try SpecialsValidators.validateYieldQty(input.yieldQty)
        let yieldUnit = try SpecialsValidators.validateYieldUnit(input.yieldUnit)
        let category = try SpecialsValidators.validateCategory(input.category)
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let log = auditLog

        return try writeDB.write { db in
            guard let row = try SpecialRecord.fetchOne(db,
                sql: "SELECT * FROM specials WHERE id = ? AND location_id = ?",
                arguments: [id, locationId])
            else { throw SpecialsWriteError.notFound }
            if row.archivedAt != nil { throw SpecialsWriteError.archived }

            // Slug collision check is read-only; tolerate a missing
            // entities_recipes table on fresh DBs (web catches "no such table").
            if try db.tableExists("entities_recipes") {
                let collide = try String.fetchOne(db,
                    sql: "SELECT slug FROM entities_recipes WHERE slug = ? AND location_id = ? LIMIT 1",
                    arguments: [slug, locationId])
                if collide != nil { throw SpecialsWriteError.slugExists(slug) }
            }

            let breakdown = CostBreakdownLine.parse(row.costBreakdown)
            let ingredientRows = SpecialsExport.mapCostBreakdownToIngredientRows(breakdown)
            let skipped = SpecialsExport.selectSkippedRows(ingredientRows)
            let procedure = input.procedureOverride ?? SpecialsExport.stripCostMarkdown(row.aiAnswer)

            let recipeRow = SpecialsExport.RecipeRow(
                slug: slug, displayName: row.name, yieldQty: yieldQty,
                yieldUnit: yieldUnit, category: category, procedure: procedure)
            let csv = SpecialsExport.buildExportCsv(recipeRow: recipeRow, ingredientRows: ingredientRows)

            try db.execute(
                sql: "UPDATE specials SET last_exported_at = ?, updated_at = ? WHERE id = ? AND location_id = ?",
                arguments: [now, now, id, locationId])
            try log.logExport(specialId: id, slug: slug, locationId: locationId)

            return ExportResult(recipeRow: recipeRow, ingredientRows: ingredientRows,
                                skipped: skipped, csv: csv)
        }
    }

    // ── promote (POST /api/specials/saved/[id]/promote) ─────────────────────

    public struct PromoteResult: Sendable, Equatable {
        public let promotion: SpecialsPromotionRecord
        public let components: [PromotedComponent]
        public let skipped: [SkippedComponent]
        public let repromoted: Bool
    }

    /// Full `promoteSpecialToMenu` port. Transactional and idempotent:
    /// re-promoting refreshes the dish_components rows this promotion owns
    /// (deleting the prior set first so a renamed menu item leaves no
    /// orphans) and updates the promotion record in place. The audit_events
    /// row posts INSIDE the same transaction; the `specials.promote` JSONL
    /// line lands after commit (route parity).
    public func promote(
        id: String,
        menuItemName rawMenuItemName: String? = nil,
        servings rawServings: Double? = nil,
        locationId: String = LocationScope.resolve(),
        context: RegulatedWriteContext
    ) throws -> PromoteResult {
        guard let writeDB else { throw SpecialsWriteError.missingWriteDatabase }

        // Route-layer input validation (400s) before anything touches the DB.
        var validatedName: String?
        if let rawMenuItemName {
            // Relabel the shared validator's `name` error to `menu_item_name`
            // on this route only (web route.js `.replace(/^name/, ...)`); the
            // shared SpecialsValidators keeps its `name` wording for create/patch.
            do {
                validatedName = try SpecialsValidators.validateName(rawMenuItemName)
            } catch SpecialsValidationError.nameRequired {
                throw SpecialsWriteError.menuItemNameRequired
            } catch SpecialsValidationError.nameTooLong {
                throw SpecialsWriteError.menuItemNameTooLong
            }
        }
        if let rawServings, !(rawServings.isFinite && rawServings > 0) {
            throw SpecialsWriteError.invalidServings
        }

        let result: PromoteResult = try writeDB.write { db in
            guard let special = try SpecialRecord.fetchOne(db,
                sql: """
                    SELECT * FROM specials WHERE id = ? AND location_id = ?
                    """, arguments: [id, locationId])
            else { throw SpecialsWriteError.notFound }
            if special.archivedAt != nil { throw SpecialsWriteError.archived }

            let servings = SpecialsPromotionCompute.normalizedServings(rawServings)
            let menuItemName = (validatedName ?? special.name)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let canonicalMenuItemName = DishCostBridge.normalizeDishName(menuItemName)

            let breakdown = CostBreakdownLine.parse(special.costBreakdown)
            let mapped = SpecialsPromotionCompute.componentsFromBreakdown(breakdown, servings: servings)
            var skipped = mapped.skipped
            let components = try Self.alignComponentsToVendorPackUnits(
                db: db, components: mapped.components, skipped: &skipped, locationId: locationId)
            guard !components.isEmpty else { throw SpecialsWriteError.noCostableComponents }

            let now = Int64(Date().timeIntervalSince1970 * 1000)
            let prior = try SpecialsPromotionRecord.fetchOne(db,
                sql: "SELECT * FROM specials_promotions WHERE special_id = ? AND location_id = ?",
                arguments: [id, locationId])

            // Re-promote: remove the rows the prior promotion materialized so
            // a changed menu item name (or dropped ingredient) doesn't leave
            // stale cost rows behind. Hand-entered components are untouched.
            if let prior {
                for component in PromotedComponent.parseComponentsJson(prior.componentsJson) {
                    try db.execute(sql: """
                        DELETE FROM dish_components
                         WHERE location_id = ? AND dish_name = ?
                           AND component_type = 'vendor_item' AND vendor_ingredient = ?
                        """, arguments: [
                            locationId,
                            DishCostBridge.normalizeDishName(prior.menuItemName),
                            component.vendorIngredient,
                        ])
                }
            }

            let note = "promoted from special \(id)"
            for component in components {
                try db.execute(sql: """
                    INSERT INTO dish_components
                      (location_id, dish_name, component_type, recipe_slug, vendor_ingredient,
                       qty_per_serving, unit, notes)
                    VALUES (?, ?, 'vendor_item', NULL, ?, ?, ?, ?)
                    ON CONFLICT(location_id, dish_name, vendor_ingredient)
                      WHERE component_type = 'vendor_item'
                    DO UPDATE SET
                      qty_per_serving = excluded.qty_per_serving,
                      unit = excluded.unit,
                      notes = excluded.notes,
                      updated_at = datetime('now')
                    """, arguments: [
                        locationId, canonicalMenuItemName, component.vendorIngredient,
                        component.qtyPerServing, component.unit, note,
                    ])
            }

            let componentsJson = PromotedComponent.componentsJson(components)
            let record: SpecialsPromotionRecord
            if let prior {
                try db.execute(sql: """
                    UPDATE specials_promotions
                       SET menu_item_name = ?, servings = ?, components_json = ?, updated_at = ?
                     WHERE id = ?
                    """, arguments: [menuItemName, servings, componentsJson, now, prior.id])
                record = SpecialsPromotionRecord(
                    id: prior.id, specialId: prior.specialId, locationId: prior.locationId,
                    menuItemName: menuItemName, servings: servings,
                    componentsJson: componentsJson, promotedAt: prior.promotedAt, updatedAt: now)
            } else {
                try db.execute(sql: """
                    INSERT INTO specials_promotions
                      (special_id, location_id, menu_item_name, servings, components_json,
                       promoted_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, arguments: [id, locationId, menuItemName, servings, componentsJson, now, now])
                record = SpecialsPromotionRecord(
                    id: db.lastInsertedRowID, specialId: id, locationId: locationId,
                    menuItemName: menuItemName, servings: servings,
                    componentsJson: componentsJson, promotedAt: now, updatedAt: now)
            }

            // Web payload: {special_id, menu_item_name, servings,
            // component_count, skipped_count} — JS number formatting.
            let payloadJSON = "{\"special_id\":\(JsValueFormat.jsonString(id)),"
                + "\"menu_item_name\":\(JsValueFormat.jsonString(menuItemName)),"
                + "\"servings\":\(JsValueFormat.numberString(servings)),"
                + "\"component_count\":\(components.count),"
                + "\"skipped_count\":\(skipped.count)}"
            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "specials_promotion",
                entityId: record.id,
                action: prior != nil ? .update : .insert,
                actorCookId: context.actorCookId,
                actorSource: context.actorSource,
                payloadJSON: payloadJSON,
                shiftDate: context.shiftDate,
                locationId: locationId
            ))

            return PromoteResult(promotion: record, components: components,
                                 skipped: skipped, repromoted: prior != nil)
        }

        // Route-level JSONL line, after the transactional audit_events row —
        // mirrors the web's logAuditAction placement.
        try auditLog.logPromote(
            specialId: id, menuItemName: result.promotion.menuItemName, locationId: locationId)
        return result
    }

    /// `alignComponentsToVendorPackUnits` — convert each component into the
    /// vendor's latest pack unit (density-assisted for weight↔volume) so the
    /// dish→cost bridge prices it without a second conversion. Inconvertible
    /// components are skipped as invalid_qty.
    private static func alignComponentsToVendorPackUnits(
        db: Database,
        components: [PromotedComponent],
        skipped: inout [SkippedComponent],
        locationId: String
    ) throws -> [PromotedComponent] {
        var aligned: [PromotedComponent] = []
        for component in components {
            let vendorPackUnit = try String.fetchOne(db, sql: """
                SELECT pack_unit
                  FROM vendor_prices
                 WHERE location_id = ? AND lower(ingredient) = lower(?)
                 ORDER BY imported_at DESC, id DESC
                 LIMIT 1
                """, arguments: [locationId, component.vendorIngredient])
            let packUnit = UnitConvert.normalizeUnit(vendorPackUnit ?? "")
            if packUnit.isEmpty || packUnit == component.unit {
                aligned.append(component)
                continue
            }

            let gPerMl = try Double.fetchOne(db,
                sql: "SELECT g_per_ml FROM ingredient_densities WHERE ingredient_key = ?",
                arguments: [IngredientKey.normalize(component.vendorIngredient)])
            let converted = UnitConvert.convertQty(
                component.qtyPerServing, from: component.unit, to: packUnit, gPerMl: gPerMl)
            guard let converted, converted.isFinite, converted > 0 else {
                skipped.append(SkippedComponent(item: component.vendorIngredient, reason: .invalidQty))
                continue
            }
            aligned.append(PromotedComponent(
                vendorIngredient: component.vendorIngredient,
                qtyPerServing: converted,
                unit: packUnit))
        }
        return aligned
    }
}
