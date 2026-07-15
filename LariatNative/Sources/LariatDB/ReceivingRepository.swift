import Foundation
import GRDB
import LariatModel

/// Repository for the receiving log — behavior parity with `app/api/receiving/route.js`
/// (POST + GET) plus, since the A5 wave, the manager `matches/**` tier
/// (`loadUnmatched` / `resolveMatch`). Reads via the read-only pool; regulated writes go
/// through `AuditedWriteRunner` so the `receiving_log` INSERT, its `audit_events`
/// row, and — when a delivery credits inventory (closed-loop receiving) — the
/// `inventory_updates` INSERT + its audit row all commit (or roll back) in ONE
/// transaction. Status semantics mirror the web route:
///   - missing vendor / unknown category / malformed date/reading / over-long note
///       → validationFailed (web 400)
///   - malformed received_qty/received_unit on a non-rejected line
///       → closedLoopError (web 400)
///   - outright rejection with no note → needsRejectionNote (web 422)
///   - drift-band accept-with-note with no note → needsCorrectiveAction (web 422)
public struct ReceivingRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    /// Web route stamps every receiving audit with `actor_source = 'cook_ui'`; the
    /// native surface stamps `native_cook` (per the port brief's actor tagging).
    private let inventoryActorSource = "receiving_closed_loop"

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    // ── GET — board snapshot ───────────────────────────────────────────

    public func load(
        date: String = ShiftDate.todayISO(),
        locationId: String = LocationScope.resolve(),
        includeSummary: Bool = true
    ) async throws -> ReceivingBoardSnapshot {
        try await readDB.pool.read { db in
            let rows = try ReceivingRow.fetchAll(
                db,
                sql: """
                  SELECT * FROM receiving_log
                  WHERE location_id = ? AND shift_date = ?
                  ORDER BY created_at DESC, id DESC
                  """,
                arguments: [locationId, date]
            )

            let summary = includeSummary
                ? ReceivingCompute.classifyDeliveries(
                    rows.map { ReceivingClassifyRow(category: $0.category, status: $0.status, createdAt: $0.createdAt) },
                    expectAllCategories: true
                  )
                : []

            // Group by vendor (mirror the JS GET vendor roll-up). Sort ascending.
            var byVendor: [String: [ReceivingRow]] = [:]
            var order: [String] = []
            for r in rows {
                let v = r.vendor.isEmpty ? "—" : r.vendor
                if byVendor[v] == nil { order.append(v) }
                byVendor[v, default: []].append(r)
            }
            let vendors = order.sorted().map { v -> ReceivingVendorGroup in
                let entries = byVendor[v] ?? []
                return ReceivingVendorGroup(
                    vendor: v,
                    entries: entries,
                    accepted: entries.filter { $0.status == "accepted" }.count,
                    rejected: entries.filter { $0.status == "rejected" }.count,
                    acceptedWithNote: entries.filter { $0.status == "accepted_with_note" }.count
                )
            }

            let totals = ReceivingTotals(
                accepted: rows.filter { $0.status == "accepted" }.count,
                rejected: rows.filter { $0.status == "rejected" }.count,
                acceptedWithNote: rows.filter { $0.status == "accepted_with_note" }.count
            )

            return ReceivingBoardSnapshot(
                date: date, locationId: locationId,
                entries: rows, vendors: vendors, totals: totals, summary: summary
            )
        }
    }

    // ── POST — record one delivery line ────────────────────────────────

    private static let isoDate = try! NSRegularExpression(pattern: "^\\d{4}-\\d{2}-\\d{2}$")

    @discardableResult
    public func record(input: ReceivingEntryInput, context: RegulatedWriteContext) throws -> ReceivingEntryResult {
        // ── coerce + shape validation (parity with the route's up-front 400s) ──
        guard let vendor = clip(input.vendor, max: 120) else {
            throw ReceivingWriteError.validationFailed("vendor is required")
        }

        let categoryRaw = clip(input.category, max: 64)
        guard let rule = ReceivingCompute.rule(for: categoryRaw), let category = categoryRaw else {
            let list = ReceivingCompute.categories.map { $0.rawValue }.joined(separator: ", ")
            throw ReceivingWriteError.validationFailed("unknown category — must be one of: \(list)")
        }

        let invoiceRef = clip(input.invoiceRef, max: 120)
        let item = clip(input.item, max: 200)
        let vendorSku = clip(input.vendorSku, max: 120)
        let shellstockTagRef = clip(input.shellstockTagRef, max: 120)
        let cookId = clip(input.cookId, max: 64) ?? context.actorCookId
        let shiftDate = clip(input.shiftDate, max: 32) ?? context.shiftDate
        let locationId = context.locationId

        let expirationDate = clip(input.expirationDate, max: 32)
        if let exp = expirationDate {
            let range = NSRange(exp.startIndex..., in: exp)
            if Self.isoDate.firstMatch(in: exp, range: range) == nil {
                throw ReceivingWriteError.validationFailed("expiration_date must be YYYY-MM-DD")
            }
        }

        // reading_f coercion — web 400s a non-finite non-empty reading.
        if let reading = input.readingF, !reading.isFinite {
            throw ReceivingWriteError.validationFailed("reading_f must be a number in °F or omitted")
        }
        let readingF = input.readingF

        if let qty = input.receivedQty, !qty.isFinite {
            throw ReceivingWriteError.validationFailed("received_qty must be a number or omitted")
        }
        let receivedQty = input.receivedQty
        let receivedUnit = clip(input.receivedUnit, max: 32)

        // Over-long corrective action is a 400 BEFORE classification.
        if let note = input.correctiveAction, note.count > ReceivingCompute.correctiveNoteMaxLength {
            throw ReceivingWriteError.correctiveNoteTooLong(length: note.count)
        }
        let correctiveAction = normalizeNote(input.correctiveAction)

        // ── rule decision ──────────────────────────────────────────────
        let decision = ReceivingCompute.validateReceivingReading(ReceivingReadingInput(
            category: category,
            readingF: readingF,
            packageOk: input.packageOk,
            expirationDate: expirationDate,
            receivedAt: shiftDate,
            receivedQty: receivedQty,
            receivedUnit: receivedUnit
        ))

        // HACCP outright rejections take priority over input-shape errors. A
        // note-less rejection is a refusal — surface needs_rejection_note (422).
        if decision.status == .rejected && correctiveAction == nil {
            throw ReceivingWriteError.needsRejectionNote(reason: decision.reason ?? "Refused delivery", citation: decision.citation)
        }

        // Closed-loop input-shape errors are 400 — but NOT for rejected lines
        // (no inventory credit happens on a rejection, so a malformed qty/unit
        // is irrelevant there; blocking it would mask the HACCP outcome).
        if let closedLoopError = decision.closedLoopError, decision.status != .rejected {
            throw ReceivingWriteError.closedLoopError(closedLoopError)
        }

        // Both note-carrying rejections and accept-with-note need a note. The
        // note-less rejection branch already threw above; this now only fires
        // on note-less accept-with-note.
        if decision.status != .ok && correctiveAction == nil {
            throw ReceivingWriteError.needsCorrectiveAction(reason: decision.reason ?? "Needs a corrective action", citation: decision.citation)
        }

        let dbStatus = ReceivingCompute.dbStatus(for: decision.status)

        // ── write (INSERT + audit [+ closed-loop credit] in ONE transaction) ──
        return try AuditedWriteRunner.perform(db: writeDB) { db in
            // Closed-loop crediting is attempted only when ALL of: status is
            // accepted/accepted_with_note, qty is present + positive, unit is a
            // non-empty string, and item is present.
            // Kept as typed sub-expressions: the combined `&&` chain exceeds
            // the type-check budget of the Swift 6.1/6.2 solvers on the
            // native-ci macOS runners.
            let creditableStatus: Bool = dbStatus == .accepted || dbStatus == .acceptedWithNote
            let hasPositiveQty: Bool = (receivedQty ?? 0) > 0
            let hasUnit: Bool = receivedUnit?.isEmpty == false
            let hasItem: Bool = item?.isEmpty == false
            let shouldAttemptInventoryCredit: Bool =
                creditableStatus && hasPositiveQty && hasUnit && hasItem

            let match: ReceivingMasterMatch = shouldAttemptInventoryCredit
                ? try resolveReceivingMaster(db, locationId: locationId, vendor: vendor, vendorSku: vendorSku, item: item)
                : .notAttempted
            let shouldCredit: Bool = shouldAttemptInventoryCredit
                && match.status == "matched"
                && (match.masterId?.isEmpty == false)

            try db.execute(
                sql: """
                  INSERT INTO receiving_log
                    (shift_date, location_id, vendor, invoice_ref, category, item,
                     vendor_sku, master_id, match_status, match_reason,
                     reading_f, required_max_f, package_ok, expiration_date,
                     received_qty, received_unit,
                     status, rejection_reason, shellstock_tag_ref, cook_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  """,
                arguments: [
                    shiftDate, locationId, vendor, invoiceRef, category, item,
                    vendorSku, match.masterId, match.status, match.reason,
                    readingF, decision.requiredMaxF, input.packageOk ? 1 : 0, expirationDate,
                    receivedQty, receivedUnit,
                    dbStatus.rawValue, correctiveAction, shellstockTagRef, cookId,
                ]
            )
            let newId = db.lastInsertedRowID
            guard let row = try ReceivingRow.fetchOne(db, sql: "SELECT * FROM receiving_log WHERE id = ?", arguments: [newId]) else {
                throw ReceivingWriteError.persistenceFailed
            }

            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "receiving_log",
                    entityId: newId,
                    action: .insert,
                    actorCookId: context.actorCookId ?? cookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(row),
                    note: decision.status == .ok ? nil : "\(decision.status.rawValue):\(category)",
                    shiftDate: shiftDate,
                    locationId: locationId
                )
            )

            var inventoryRow: InventoryUpdateRow?
            if shouldCredit, let masterId = match.masterId, let item, let receivedQty, let receivedUnit {
                // receiving_log_id stamps the source row so the partial UNIQUE
                // index enforces at-most-once crediting. A duplicate raises a
                // UNIQUE constraint that rolls the whole transaction back.
                let delta = "\(ReceivingRepository.numberText(receivedQty)) \(receivedUnit)"
                try db.execute(
                    sql: """
                      INSERT INTO inventory_updates
                        (shift_date, location_id, item, master_id, delta, direction, note, cook_id, receiving_log_id)
                      VALUES (?, ?, ?, ?, ?, 'in', ?, ?, ?)
                      """,
                    arguments: [
                        shiftDate, locationId, item, masterId, delta,
                        "closed-loop receiving from receiving_log #\(newId)", cookId, newId,
                    ]
                )
                let invId = db.lastInsertedRowID
                guard let invRow = try InventoryUpdateRow.fetchOne(db, sql: "SELECT * FROM inventory_updates WHERE id = ?", arguments: [invId]) else {
                    throw ReceivingWriteError.persistenceFailed
                }
                _ = try AuditEventWriter.post(
                    db: db,
                    input: AuditEventInput(
                        entity: "inventory_updates",
                        entityId: invId,
                        action: .insert,
                        actorCookId: cookId,
                        actorSource: inventoryActorSource,
                        payloadJSON: AuditEventWriter.encodePayload(invRow),
                        note: "receiving_log:\(newId)",
                        shiftDate: shiftDate,
                        locationId: locationId
                    )
                )
                inventoryRow = invRow
            }

            return ReceivingEntryResult(row: row, decision: decision, match: match, inventoryUpdate: inventoryRow)
        }
    }

    // ── manager matches tier (A5) — /api/receiving/matches/** ──────────
    //
    // The manager queue + resolution flow, ported in the A5 wave. The web
    // route also appends `sync_feed` ops (`appendOp`) for the cross-host peer
    // transport; that transport stays on the Next.js edge (see
    // docs/superpowers/specs/lariat-native-edge-blockers.md) so the native
    // resolution deliberately omits it.

    /// Manager queue: accepted lines that captured qty/unit but could not be
    /// tied to `ingredient_masters` at check-in. Mirrors the page query in
    /// `app/management/receiving-matches/page.jsx` (`readQueue`, LIMIT 100).
    public func loadUnmatched(locationId: String = LocationScope.resolve()) async throws -> [ReceivingRow] {
        try await readDB.pool.read { db in
            try ReceivingRow.fetchAll(
                db,
                sql: """
                  SELECT r.* FROM receiving_log r
                  WHERE r.location_id = ?
                    AND r.status IN ('accepted', 'accepted_with_note')
                    AND r.received_qty IS NOT NULL
                    AND r.received_qty > 0
                    AND r.received_unit IS NOT NULL
                    AND TRIM(r.received_unit) <> ''
                    AND COALESCE(r.match_status, 'not_attempted') IN ('unmatched', 'ambiguous')
                  ORDER BY r.created_at DESC, r.id DESC
                  LIMIT 100
                  """,
                arguments: [locationId]
            )
        }
    }

    /// Master picker options — mirrors the page's `readMasters`
    /// (name-sorted, LIMIT 1000; not location-scoped, like the web query).
    public func masterOptions() async throws -> [ReceivingMasterOption] {
        try await readDB.pool.read { db in
            try ReceivingMasterOption.fetchAll(
                db,
                sql: """
                  SELECT master_id, canonical_name, category, preferred_vendor
                    FROM ingredient_masters
                   ORDER BY lower(canonical_name), master_id
                   LIMIT 1000
                  """
            )
        }
    }

    /// Resolve one unmatched receiving row to an ingredient master and
    /// backfill the missing inventory credit — parity with
    /// `PATCH /api/receiving/matches/[id]`. ONE transaction, all-or-nothing:
    /// the `receiving_log` UPDATE, the closed-loop `inventory_updates` credit
    /// (UPDATE the existing credit's master when one exists for this
    /// `receiving_log_id`, else INSERT a fresh `direction='in'` row), and
    /// BOTH `audit_events` rows.
    @discardableResult
    public func resolveMatch(
        id: Int64,
        masterId rawMasterId: String,
        cookId rawCookId: String? = nil,
        context: RegulatedWriteContext
    ) throws -> ReceivingMatchResolution {
        // 400s — shape checks before touching the DB (route L37-52).
        guard id > 0 else {
            throw ReceivingMatchError.validation("receiving id required")
        }
        guard let masterId = clip(rawMasterId, max: 200) else {
            throw ReceivingMatchError.validation("master_id required")
        }
        let cookId = rawCookId.flatMap { clip($0, max: 64) }
        let locationId = context.locationId

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            // 404 — row must exist at this location (route L58-63).
            guard let row = try ReceivingRow.fetchOne(
                db,
                sql: "SELECT * FROM receiving_log WHERE id = ? AND location_id = ?",
                arguments: [id, locationId]
            ) else {
                throw ReceivingMatchError.notFound("receiving row not found")
            }

            // 404 — master must exist (route L65-69).
            let masterExists = try Int.fetchOne(
                db,
                sql: "SELECT COUNT(*) FROM ingredient_masters WHERE master_id = ?",
                arguments: [masterId]
            ) ?? 0
            guard masterExists > 0 else {
                throw ReceivingMatchError.notFound("master not found")
            }

            let existingCredit = try InventoryUpdateRow.fetchOne(
                db,
                sql: "SELECT * FROM inventory_updates WHERE receiving_log_id = ?",
                arguments: [id]
            )

            // 409s — status + stock-count gates (route L76-81).
            guard row.status == "accepted" || row.status == "accepted_with_note" else {
                throw ReceivingMatchError.conflict("rejected deliveries cannot add stock")
            }
            let unit = (row.receivedUnit ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard (row.receivedQty ?? 0) > 0, !unit.isEmpty, let item = row.item else {
                throw ReceivingMatchError.conflict("delivery has no stock count to add")
            }

            // ── mutation 1: point the receiving row at the master ────────
            try db.execute(
                sql: """
                  UPDATE receiving_log
                     SET master_id = ?,
                         match_status = 'matched',
                         match_reason = 'manager_selected'
                   WHERE id = ?
                  """,
                arguments: [masterId, id]
            )
            guard let after = try ReceivingRow.fetchOne(
                db, sql: "SELECT * FROM receiving_log WHERE id = ?", arguments: [id]
            ) else {
                throw ReceivingMatchError.persistenceFailed
            }

            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "receiving_log",
                entityId: id,
                action: .correction,
                actorCookId: cookId,
                actorSource: context.actorSource,
                payloadJSON: AuditEventWriter.encodePayload(MatchCorrectionPayload(
                    before: MatchSnapshot(id: row.id, masterId: row.masterId, matchStatus: row.matchStatus, matchReason: row.matchReason),
                    after: MatchSnapshot(id: after.id, masterId: after.masterId, matchStatus: after.matchStatus, matchReason: after.matchReason)
                )),
                note: "receiving_match:\(id)",
                shiftDate: row.shiftDate,
                locationId: locationId
            ))

            // ── mutation 2: closed-loop inventory credit ─────────────────
            let invRow: InventoryUpdateRow
            if let existingCredit {
                try db.execute(
                    sql: "UPDATE inventory_updates SET master_id = ? WHERE id = ?",
                    arguments: [masterId, existingCredit.id]
                )
                guard let updated = try InventoryUpdateRow.fetchOne(
                    db, sql: "SELECT * FROM inventory_updates WHERE id = ?", arguments: [existingCredit.id]
                ) else {
                    throw ReceivingMatchError.persistenceFailed
                }
                invRow = updated

                _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                    entity: "inventory_updates",
                    entityId: existingCredit.id,
                    action: .correction,
                    actorCookId: cookId,
                    actorSource: Self.matchResolutionActorSource,
                    payloadJSON: AuditEventWriter.encodePayload(CreditCorrectionPayload(
                        before: CreditSnapshot(id: existingCredit.id, masterId: existingCredit.masterId, receivingLogId: existingCredit.receivingLogId),
                        after: CreditSnapshot(id: invRow.id, masterId: invRow.masterId, receivingLogId: invRow.receivingLogId)
                    )),
                    note: "receiving_match:\(id)",
                    shiftDate: row.shiftDate,
                    locationId: locationId
                ))
            } else {
                let delta = "\(ReceivingRepository.numberText(row.receivedQty ?? 0)) \(unit)"
                try db.execute(
                    sql: """
                      INSERT INTO inventory_updates
                        (shift_date, location_id, item, master_id, delta, direction, note, cook_id, receiving_log_id)
                      VALUES (?, ?, ?, ?, ?, 'in', ?, ?, ?)
                      """,
                    arguments: [
                        row.shiftDate, locationId, item, masterId, delta,
                        "manager matched receiving_log #\(id)", cookId, id,
                    ]
                )
                let invId = db.lastInsertedRowID
                guard let inserted = try InventoryUpdateRow.fetchOne(
                    db, sql: "SELECT * FROM inventory_updates WHERE id = ?", arguments: [invId]
                ) else {
                    throw ReceivingMatchError.persistenceFailed
                }
                invRow = inserted

                _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                    entity: "inventory_updates",
                    entityId: invId,
                    action: .insert,
                    actorCookId: cookId,
                    actorSource: Self.matchResolutionActorSource,
                    payloadJSON: AuditEventWriter.encodePayload(invRow),
                    note: "receiving_match:\(id)",
                    shiftDate: row.shiftDate,
                    locationId: locationId
                ))
            }

            return ReceivingMatchResolution(receiving: after, inventoryUpdate: invRow)
        }
    }

    /// Web stamps the inventory-side audit rows of a manager resolution with
    /// this exact `actor_source` (semantic origin, not a UI source).
    static let matchResolutionActorSource = "receiving_match_resolution"

    // Audit payload shapes mirror the web route's postAuditEvent payloads
    // field-for-field (snake_case via `AuditEventWriter.encodePayload`).
    private struct MatchSnapshot: Encodable {
        let id: Int64
        let masterId: String?
        let matchStatus: String?
        let matchReason: String?
    }

    private struct MatchCorrectionPayload: Encodable {
        let before: MatchSnapshot
        let after: MatchSnapshot
    }

    private struct CreditSnapshot: Encodable {
        let id: Int64
        let masterId: String?
        let receivingLogId: Int64?
    }

    private struct CreditCorrectionPayload: Encodable {
        let before: CreditSnapshot
        let after: CreditSnapshot
    }

    // ── inline master resolution (mirror of `resolveReceivingMaster`) ──

    /// Resolve a delivery line to at-most-one ingredient master via `vendor_prices`.
    /// Matches on (vendor + sku) first, then (vendor + item). Multiple distinct
    /// masters → ambiguous; none → unmatched. This is the INLINE resolution the
    /// receiving POST performs before crediting inventory — NOT the manager
    /// `matches/**` PATCH flow (out of scope).
    private func resolveReceivingMaster(
        _ db: Database, locationId: String, vendor: String, vendorSku: String?, item: String?
    ) throws -> ReceivingMasterMatch {
        let vendorKey = normalizeMatchText(vendor)
        let skuKey = normalizeMatchText(vendorSku)
        let itemKey = normalizeMatchText(item)

        if vendorKey.isEmpty {
            return ReceivingMasterMatch(status: "unmatched", masterId: nil, reason: "missing_vendor")
        }

        if !skuKey.isEmpty {
            let ids = try String.fetchAll(
                db,
                sql: """
                  SELECT master_id FROM vendor_prices
                  WHERE location_id = ?
                    AND lower(trim(vendor)) = ?
                    AND lower(trim(COALESCE(sku, ''))) = ?
                    AND master_id IS NOT NULL AND master_id != ''
                  """,
                arguments: [locationId, vendorKey, skuKey]
            )
            if let m = matchFromMasterIds(ids, matched: "exact_vendor_sku", ambiguous: "multiple_vendor_sku_matches") {
                return m
            }
        }

        if !itemKey.isEmpty {
            let rows = try Row.fetchAll(
                db,
                sql: """
                  SELECT ingredient, master_id FROM vendor_prices
                  WHERE location_id = ?
                    AND lower(trim(vendor)) = ?
                    AND master_id IS NOT NULL AND master_id != ''
                  """,
                arguments: [locationId, vendorKey]
            )
            let ids = rows
                .filter { normalizeMatchText($0["ingredient"]) == itemKey }
                .compactMap { $0["master_id"] as String? }
            if let m = matchFromMasterIds(ids, matched: "exact_vendor_item", ambiguous: "multiple_vendor_item_matches") {
                return m
            }
        }

        return ReceivingMasterMatch(status: "unmatched", masterId: nil, reason: "no_vendor_price_match")
    }

    private func matchFromMasterIds(_ masterIds: [String], matched: String, ambiguous: String) -> ReceivingMasterMatch? {
        var seen: [String] = []
        for id in masterIds where !id.isEmpty && !seen.contains(id) { seen.append(id) }
        if seen.count == 1 {
            return ReceivingMasterMatch(status: "matched", masterId: seen[0], reason: matched)
        }
        if seen.count > 1 {
            return ReceivingMasterMatch(status: "ambiguous", masterId: nil, reason: ambiguous)
        }
        return nil
    }

    private func normalizeMatchText(_ s: String?) -> String {
        guard let s else { return "" }
        let collapsed = s.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        return collapsed.lowercased()
    }

    // ── helpers ─────────────────────────────────────────────────────────

    /// Mirror of the route's `clip(s, max)`: trim, nil when empty, else slice to max.
    private func clip(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }

    /// Trim + slice a corrective note (already length-guarded); nil when empty.
    private func normalizeNote(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(ReceivingCompute.correctiveNoteMaxLength))
    }

    /// Render a qty for the inventory `delta` string exactly as the JS route
    /// does: `${received_qty} ${received_unit}` — integral values have no `.0`.
    /// (Public since A5: the receiving-matches board reuses it for its Qty column.)
    public static func numberText(_ v: Double) -> String {
        if v == v.rounded() && abs(v) < 1e15 { return String(Int64(v)) }
        return String(format: "%g", v)
    }
}
