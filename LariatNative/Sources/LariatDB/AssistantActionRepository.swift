import Foundation
import GRDB
import LariatModel

/// Port of the LLM-action dispatch in `app/api/kitchen-assistant/route.js`
/// (the `payload && isCommand` branch) — every mutating handler with its FULL
/// web validation ladder. LLM input is UNTRUSTED: every guard fires BEFORE any
/// write, soft-rejects surface in `actionMsg`, and every write lands with its
/// `audit_events` row in ONE transaction (AuditedWriteRunner + AuditEventWriter).
///
/// actor_source: `kitchen_assistant` — the WEB literal, kept deliberately
/// (documented divergence from the native_cook convention): undo eligibility in
/// kitchenAssistantUndo.ts requires `actor_source === 'kitchen_assistant'`, so
/// the literal is load-bearing.
public struct AssistantActionRepository {
    public static let actorSource = "kitchen_assistant"

    /// route.js pinRequired list — defense-in-depth behind the pre-LLM gate.
    public static let pinRequiredActions: Set<String> = [
        "update_inventory", "maintenance", "update_order_guide", "beo_add_prep",
        "line_check", "eighty_six", "give_gold_star", "haccp_receive", "generate_prep",
    ]

    public struct Outcome: Sendable, Equatable {
        /// Web `actionExecuted` — true whenever a branch matched (including soft-rejects).
        public let actionExecuted: Bool
        public let actionMsg: String
        public let undo: KitchenAssistantUndoMeta?

        public init(actionExecuted: Bool, actionMsg: String, undo: KitchenAssistantUndoMeta?) {
            self.actionExecuted = actionExecuted
            self.actionMsg = actionMsg
            self.undo = undo
        }

        static let unhandled = Outcome(actionExecuted: false, actionMsg: "", undo: nil)

        static func handled(_ msg: String, undo: KitchenAssistantUndoMeta? = nil) -> Outcome {
            Outcome(actionExecuted: true, actionMsg: msg, undo: undo)
        }
    }

    private let writeDB: LariatWriteDatabase
    private let calculator: RecipeCalculating?

    public init(writeDB: LariatWriteDatabase, calculator: RecipeCalculating? = nil) {
        self.writeDB = writeDB
        self.calculator = calculator
    }

    /// Dispatch one extracted action payload. Throws propagate to the caller's
    /// catch (engine) which maps to the generic `actionError` message — never
    /// the raw DB error (no schema/PII leak). A throw inside a write block
    /// rolls back the source row AND its audit row together.
    public func execute(
        payload: AssistantActionPayload,
        hasPin: Bool,
        locationId: String,
        shiftDate: String = ShiftDate.todayISO()
    ) async throws -> Outcome {
        // Defense-in-depth PIN gate (web keeps it even after the #248 pre-LLM gate).
        if Self.pinRequiredActions.contains(payload.action) && !hasPin {
            return .handled("Action blocked — manager PIN required. Show a manager and ask them to confirm.")
        }

        switch payload.action {
        case "eighty_six" where payload.isTruthy("item"):
            return try eightySix(payload, hasPin: hasPin, locationId: locationId, shiftDate: shiftDate)
        case "update_inventory" where payload.isTruthy("item"):
            return try updateInventory(payload, locationId: locationId, shiftDate: shiftDate)
        case "line_check" where payload.isTruthy("item") && payload.isTruthy("station"):
            return try lineCheck(payload, locationId: locationId, shiftDate: shiftDate)
        case "maintenance" where payload.isTruthy("equipment"):
            return try maintenance(payload, locationId: locationId, shiftDate: shiftDate)
        case "scale_recipe" where payload.isTruthy("recipe"):
            return try await scaleRecipe(payload, locationId: locationId, shiftDate: shiftDate)
        case "update_order_guide" where payload.isTruthy("item"):
            return try updateOrderGuide(payload, locationId: locationId, shiftDate: shiftDate)
        case "beo_add_prep" where isIntegerNumber(payload.jsNumber("event_id")) && payload["tasks"]?.arrayValue != nil:
            return try await beoAddPrep(payload, locationId: locationId, shiftDate: shiftDate)
        case "give_gold_star" where payload.isTruthy("cook_name"):
            return try giveGoldStar(payload, locationId: locationId, shiftDate: shiftDate)
        case "haccp_receive" where payload.isTruthy("item"):
            return try haccpReceive(payload, locationId: locationId, shiftDate: shiftDate)
        case "generate_prep" where payload.isTruthy("station") && payload["tasks"]?.arrayValue != nil:
            return try await generatePrep(payload, locationId: locationId, shiftDate: shiftDate)
        default:
            // No branch matched (unknown action or missing guard field) — the
            // web leaves actionExecuted=false and the stripped prose stands.
            return .unhandled
        }
    }

    private func isIntegerNumber(_ n: Double) -> Bool {
        n.isFinite && n == n.rounded()
    }

    // ── eighty_six ──────────────────────────────────────────────────

    private func eightySix(
        _ payload: AssistantActionPayload, hasPin: Bool, locationId: String, shiftDate: String
    ) throws -> Outcome {
        let itemName = payload.clip("item", AssistantLimits.maxItem)
        let rawItem = payload["item"]?.jsTemplate ?? "undefined"
        // JS `%${itemName}%` renders null as the literal "null".
        let likePattern = "%\(itemName ?? "null")%"

        struct InvRow { let ingredient: String; let baseQty: Double; let unit: String? }
        let inv: InvRow? = try writeDB.pool.read { db in
            guard let row = try Row.fetchOne(
                db,
                sql: "SELECT ingredient, base_qty, unit FROM order_guide_items WHERE ingredient LIKE ? AND location_id = ? LIMIT 1",
                arguments: [likePattern, locationId]
            ) else { return nil }
            return InvRow(ingredient: row["ingredient"], baseQty: row["base_qty"] ?? 0, unit: row["unit"])
        }
        let depletedToday: Int = try inv == nil ? 0 : writeDB.pool.read { db in
            try Int.fetchOne(
                db,
                sql: "SELECT COUNT(*) as cnt FROM inventory_updates WHERE item LIKE ? AND location_id = ? AND shift_date = ? AND direction IN ('out','waste')",
                arguments: [likePattern, locationId, shiftDate]
            ) ?? 0
        }
        let stockDepleted = depletedToday > 0

        if let inv, inv.baseQty > 0, !stockDepleted, !hasPin {
            // Inventory-based soft block. Dead code post-#248 for the un-PIN'd
            // path (the pinRequired gate fires first) — kept for web parity.
            return .handled(
                "Hold on — order guide shows \(JsValueFormat.numberString(inv.baseQty)) \(inv.unit ?? "") of \(inv.ingredient) on hand. Look again, then ask a manager if it's really gone."
            )
        }

        let reasonClip = payload.clip("reason", AssistantLimits.maxNote) ?? "AI Update"
        let createdAt = LariConversationMemoryCompute.isoString()
        let (auditId, entityId) = try AuditedWriteRunner.perform(db: writeDB) { db -> (Int64, Int64) in
            try db.execute(
                sql: "INSERT INTO eighty_six (location_id, item, shift_date, created_at, reason) VALUES (?, ?, ?, ?, ?)",
                arguments: [locationId, itemName, shiftDate, createdAt, reasonClip]
            )
            let id = db.lastInsertedRowID
            let auditId = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "eighty_six", entityId: id, action: .insert,
                actorCookId: nil, actorSource: Self.actorSource,
                payloadJSON: AssistantAuditJSON.object([
                    ("item", .string(itemName)),
                    ("reason", .string(reasonClip)),
                ]),
                shiftDate: shiftDate, locationId: locationId
            ))
            return (auditId, id)
        }
        let msg = "Marked \(rawItem) as 86'd."
        return .handled(msg, undo: AssistantUndoCompute.buildUndoMeta(
            auditEventId: auditId, entity: "eighty_six", entityId: entityId,
            label: msg, createdAt: createdAt
        ))
    }

    // ── update_inventory ────────────────────────────────────────────

    private func updateInventory(
        _ payload: AssistantActionPayload, locationId: String, shiftDate: String
    ) throws -> Outcome {
        let rawDelta = payload.jsNumber("delta")
        // Strict numeric guard — pre-2026-05-08 junk strings ("5 lbs") landed in
        // inventory_updates.delta. Soft-reject so the LLM retries clean.
        guard rawDelta.isFinite else {
            return .handled(
                "Inventory update blocked — delta \"\(payload["delta"]?.jsTemplate ?? "undefined")\" is not a number. Try again with just the count."
            )
        }
        // Web double-checks truthiness AFTER normalize (`rawUnit ? … : …`), so a
        // whitespace-only unit normalizing to "" must not leave a trailing space.
        let rawUnit = (payload.isTruthy("unit")
            ? UnitConvert.normalizeUnit(payload["unit"]?.jsTemplate)
            : nil).flatMap { $0.isEmpty ? nil : $0 }
        let deltaStr = rawUnit.map { "\(JsValueFormat.numberString(rawDelta)) \($0)" }
            ?? JsValueFormat.numberString(rawDelta)
        let itemClip = payload.clip("item", AssistantLimits.maxItem)
        let direction = payload.clip("direction", 16)
        let createdAt = LariConversationMemoryCompute.isoString()

        let (auditId, entityId) = try AuditedWriteRunner.perform(db: writeDB) { db -> (Int64, Int64) in
            try db.execute(
                sql: "INSERT INTO inventory_updates (location_id, item, shift_date, created_at, delta, direction) VALUES (?, ?, ?, ?, ?, ?)",
                arguments: [locationId, itemClip, shiftDate, createdAt, deltaStr, direction]
            )
            let id = db.lastInsertedRowID
            let auditId = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "inventory_updates", entityId: id, action: .insert,
                actorCookId: nil, actorSource: Self.actorSource,
                payloadJSON: AssistantAuditJSON.object([
                    ("item", .string(itemClip)),
                    ("delta", .string(deltaStr)),
                    ("direction", .string(direction)),
                ]),
                shiftDate: shiftDate, locationId: locationId
            ))
            return (auditId, id)
        }
        let msg = "Logged inventory update for \(payload["item"]?.jsTemplate ?? "undefined")."
        return .handled(msg, undo: AssistantUndoCompute.buildUndoMeta(
            auditEventId: auditId, entity: "inventory_updates", entityId: entityId,
            label: msg, createdAt: createdAt
        ))
    }

    // ── line_check ──────────────────────────────────────────────────

    private func lineCheck(
        _ payload: AssistantActionPayload, locationId: String, shiftDate: String
    ) throws -> Outcome {
        var status = payload.clip("status", 16) ?? "na"
        var note = payload.clip("note", AssistantLimits.maxNote)
        // typeof === 'number' gate FIRST — an object/array reading_f must not
        // trip the validate-temp branch (route parity, hardening test).
        let readingF = payload["reading_f"]?.strictFiniteNumber

        if payload.isTruthy("temp_point_id"), let reading = readingF {
            if let pt = TempLogCompute.getTempPoint(payload["temp_point_id"]?.jsTemplate ?? "") {
                let val = TempLogCompute.validateTempReading(
                    point: pt, readingF: reading, correctiveAction: note
                )
                if !val.ok {
                    status = "fail"
                    note = val.reason
                } else {
                    status = "pass"
                }
            } else {
                status = "na"
                note = "[Unvalidated Temp: \(JsValueFormat.numberString(reading))°F] \(note ?? "")"
            }
        }

        let stationClip = payload.clip("station", 64)
        let itemClip = payload.clip("item", AssistantLimits.maxItem)
        let createdAt = LariConversationMemoryCompute.isoString()
        let statusValue = status
        let noteValue = note

        let (auditId, entityId) = try AuditedWriteRunner.perform(db: writeDB) { db -> (Int64, Int64) in
            try db.execute(
                sql: "INSERT INTO line_check_entries (location_id, shift_date, station_id, item, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                arguments: [locationId, shiftDate, stationClip, itemClip, statusValue, noteValue, createdAt]
            )
            let id = db.lastInsertedRowID
            let auditId = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "line_check_entries", entityId: id, action: .insert,
                actorCookId: nil, actorSource: Self.actorSource,
                payloadJSON: AssistantAuditJSON.object([
                    ("station", .string(stationClip)),
                    ("item", .string(itemClip)),
                    ("status", .string(statusValue)),
                    ("reading_f", readingF.map { .number($0) } ?? .null),
                ]),
                shiftDate: shiftDate, locationId: locationId
            ))
            return (auditId, id)
        }
        let readingSuffix = readingF.map { " at \(JsValueFormat.numberString($0))°F" } ?? ""
        let msg = "Logged line check for \(payload["item"]?.jsTemplate ?? "undefined")\(readingSuffix) (\(statusValue))."
        return .handled(msg, undo: AssistantUndoCompute.buildUndoMeta(
            auditEventId: auditId, entity: "line_check_entries", entityId: entityId,
            label: msg, createdAt: createdAt
        ))
    }

    // ── maintenance ─────────────────────────────────────────────────

    private func maintenance(
        _ payload: AssistantActionPayload, locationId: String, shiftDate: String
    ) throws -> Outcome {
        let equipName = payload.clip("equipment", AssistantLimits.maxItem)
        // JS templates render a null clip as the literal "null".
        let equipDisplay = equipName ?? "null"
        // LIKE %name% partial match (post-fix; the raw name was exact-only).
        let equipId: Int64? = try writeDB.pool.read { db in
            try Int64.fetchOne(
                db,
                sql: "SELECT id FROM equipment WHERE name LIKE ? AND location_id = ?",
                arguments: ["%\(equipDisplay)%", locationId]
            )
        }
        guard let equipId else {
            return .handled("Could not find equipment \"\(equipDisplay)\" — ask a manager to add it first.")
        }

        let issueClip = payload.clip("issue", AssistantLimits.maxNote) ?? "n/a"
        let issueString = String("Broken: \(equipDisplay). Issue: \(issueClip)".prefix(AssistantLimits.maxNote))
        let createdAt = LariConversationMemoryCompute.isoString()

        let (auditId, entityId) = try AuditedWriteRunner.perform(db: writeDB) { db -> (Int64, Int64) in
            try db.execute(
                sql: "INSERT INTO equipment_maintenance (location_id, equipment_id, service_date, type, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                arguments: [locationId, equipId, shiftDate, "repair_request", issueString, createdAt]
            )
            let id = db.lastInsertedRowID
            let auditId = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "equipment_maintenance", entityId: id, action: .insert,
                actorCookId: nil, actorSource: Self.actorSource,
                payloadJSON: AssistantAuditJSON.object([
                    ("equipment", .string(equipName)),
                    ("issue", .string(issueClip)),
                    ("equipment_id", .int(equipId)),
                ]),
                shiftDate: shiftDate, locationId: locationId
            ))
            return (auditId, id)
        }
        let msg = "Submitted maintenance ticket for \(payload["equipment"]?.jsTemplate ?? "undefined")."
        return .handled(msg, undo: AssistantUndoCompute.buildUndoMeta(
            auditEventId: auditId, entity: "equipment_maintenance", entityId: entityId,
            label: msg, createdAt: createdAt
        ))
    }

    // ── scale_recipe ────────────────────────────────────────────────

    private func scaleRecipe(
        _ payload: AssistantActionPayload, locationId: String, shiftDate: String
    ) async throws -> Outcome {
        let rawMult = payload.jsNumber("multiplier")
        guard rawMult.isFinite, rawMult > 0 else {
            return .handled(
                "Scale Recipe blocked — multiplier \(payload["multiplier"]?.jsTemplate ?? "undefined") is not a positive number."
            )
        }
        guard let calculator else {
            // Same operator-visible failure shape as a calculator error.
            return .handled("Scale Recipe failed (calculator_unavailable): deterministic calculator is not configured on this device.")
        }
        do {
            // Model numeric fields are DISCARDED — the calculator is authoritative.
            let result = try await calculator.scaleRecipe(
                slug: payload["recipe"]?.jsTemplate ?? "", multiplier: rawMult
            )
            let tasks = RecipeCalculatorFormat.formatLeafRowsAsTasks(result.leafRows)
            // ACID-A: all leaf rows land or none do.
            _ = try AuditedWriteRunner.perform(db: writeDB) { db in
                for leaf in result.leafRows {
                    try db.execute(
                        sql: "INSERT INTO line_check_entries (location_id, shift_date, station_id, item, status, need, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        arguments: [
                            locationId, shiftDate, "scaled:\(result.recipeSlug)",
                            AssistantJSONValue.string(leaf.ingredient).clip(AssistantLimits.maxItem),
                            "na",
                            AssistantJSONValue.string("\(JsValueFormat.numberString(leaf.qty)) \(leaf.unit)").clip(64),
                            LariConversationMemoryCompute.isoString(),
                        ]
                    )
                }
                _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                    entity: "line_check_entries", entityId: nil, action: .insert,
                    actorCookId: nil, actorSource: Self.actorSource,
                    payloadJSON: AssistantAuditJSON.object([
                        ("recipe", .string(result.recipeSlug)),
                        ("scaleFactor", .number(result.scaleFactor)),
                        ("leafCount", .int(Int64(result.leafRows.count))),
                    ]),
                    note: "scale_recipe: \(result.leafRows.count) leaf rows",
                    shiftDate: shiftDate, locationId: locationId
                ))
            }
            return .handled(
                "Scaled \(result.recipeSlug) to \(JsValueFormat.numberString(result.targetQty)) \(result.targetUnit) (×\(JsValueFormat.numberString(result.scaleFactor))). \(tasks.count) ingredient line\(tasks.count == 1 ? "" : "s") — values from deterministic calculator."
            )
        } catch let e as RecipeCalculatorError {
            return .handled("Scale Recipe failed (\(e.code)): \(e.message)")
        } catch {
            return .handled("Scale Recipe failed (unknown): \(error.localizedDescription)")
        }
    }

    // ── update_order_guide ──────────────────────────────────────────

    private func updateOrderGuide(
        _ payload: AssistantActionPayload, locationId: String, shiftDate: String
    ) throws -> Outcome {
        let rawUnit = payload.isTruthy("unit")
            ? UnitConvert.normalizeUnit(payload["unit"]?.jsTemplate)
            : "ea"
        let itemClip = payload.clip("item", AssistantLimits.maxItem)
        let rawQty = payload.jsNumber("qty")
        // Strict numeric guard — pre-fix `payload.qty || 1` coerced junk.
        guard rawQty.isFinite, rawQty > 0 else {
            return .handled(
                "Order Guide update blocked — qty \"\(payload["qty"]?.jsTemplate ?? "undefined")\" is not a positive number. Try again with just the count."
            )
        }
        let createdAt = LariConversationMemoryCompute.isoString()
        let (auditId, entityId) = try AuditedWriteRunner.perform(db: writeDB) { db -> (Int64, Int64) in
            try db.execute(
                sql: "INSERT INTO order_guide_items (location_id, ingredient, base_qty, unit, imported_at) VALUES (?, ?, ?, ?, ?)",
                arguments: [locationId, itemClip, rawQty, AssistantJSONValue.string(rawUnit).clip(16), createdAt]
            )
            let id = db.lastInsertedRowID
            let auditId = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "order_guide_items", entityId: id, action: .insert,
                actorCookId: nil, actorSource: Self.actorSource,
                payloadJSON: AssistantAuditJSON.object([
                    ("item", .string(itemClip)),
                    ("qty", .number(rawQty)),
                    ("unit", .string(rawUnit)),
                ]),
                shiftDate: shiftDate, locationId: locationId
            ))
            return (auditId, id)
        }
        let msg = "Added \(JsValueFormat.numberString(rawQty)) \(rawUnit) of \(payload["item"]?.jsTemplate ?? "undefined") to the Order Guide."
        return .handled(msg, undo: AssistantUndoCompute.buildUndoMeta(
            auditEventId: auditId, entity: "order_guide_items", entityId: entityId,
            label: msg, createdAt: createdAt
        ))
    }

    // ── beo_add_prep ────────────────────────────────────────────────

    private func beoAddPrep(
        _ payload: AssistantActionPayload, locationId: String, shiftDate: String
    ) async throws -> Outcome {
        // Int64(exactly:) — a hallucinated event_id like 1e19 passes the
        // integer dispatch guard but must soft-reject (web binds the raw double
        // into `WHERE id = ?` and finds no row), never trap the process.
        let eventIdRaw = payload.jsNumber("event_id")
        guard let eventIdNum = Int64(exactly: eventIdRaw) else {
            return .handled("Add BEO Prep blocked — event \(JsValueFormat.numberString(eventIdRaw)) does not exist. Ask a manager to create the BEO first.")
        }

        // Cross-location guard: the LLM is free to emit ANY event_id — before
        // touching beo_prep_tasks we MUST confirm the parent row exists AND
        // belongs to the requesting location. Soft-reject, never auto-correct.
        struct EventRow { let locationId: String; let guestCount: Double? }
        let beoEvent: EventRow? = try await writeDB.pool.read { db in
            guard let row = try Row.fetchOne(
                db,
                sql: "SELECT location_id, guest_count FROM beo_events WHERE id = ?",
                arguments: [eventIdNum]
            ) else { return nil }
            return EventRow(locationId: row["location_id"], guestCount: row["guest_count"])
        }
        guard let beoEvent else {
            return .handled("Add BEO Prep blocked — event \(eventIdNum) does not exist. Ask a manager to create the BEO first.")
        }
        guard beoEvent.locationId == locationId else {
            return .handled("Add BEO Prep blocked — event \(eventIdNum) belongs to a different location. Cross-location prep injection is not allowed.")
        }

        var calcNotes: [String] = []
        var calcTasks: [String] = []
        let beoRecipes = payload["recipes"]?.arrayValue ?? []
        if !beoRecipes.isEmpty, let guests = beoEvent.guestCount, guests.isFinite, guests > 0 {
            // Web: `r.recipe_slug` on a null array element throws inside the
            // try (route.js:736) → unknown-error catch → model-task fallback.
            // Silently filtering it would run the calculator on the remainder
            // and write DIFFERENT rows than the web.
            if beoRecipes.contains(.null) {
                calcNotes.append("Calculator error (unknown): Cannot read properties of null (reading 'recipe_slug'). Falling back to model-provided tasks.")
            } else {
            let specs: [(slug: String, portionsPerGuest: Double)] = beoRecipes.compactMap { r in
                guard let obj = r.objectValue else { return ("", 1) as (String, Double) }
                let slugValue = (obj["recipe_slug"]?.isTruthy == true ? obj["recipe_slug"] : nil)
                    ?? (obj["recipe"]?.isTruthy == true ? obj["recipe"] : nil)
                let slug = slugValue?.jsTemplate ?? ""
                // Web `Number(r.portions_per_guest ?? 1)` — nullish → 1, so an
                // explicit JSON null must NOT become jsNumber(.null) == 0
                // (that would expand zero-quantity prep lines).
                let ppg = obj["portions_per_guest"]
                let portions = (ppg == nil || ppg == .null) ? 1 : ppg!.jsNumber
                return (slug, portions)
            }.filter { !$0.slug.isEmpty }
            if let calculator {
                do {
                    let results = try await calculator.expandForBEO(recipes: specs, guestCount: guests)
                    for res in results {
                        for task in RecipeCalculatorFormat.formatLeafRowsAsTasks(res.leafRows) {
                            calcTasks.append("[\(res.recipeSlug)] \(task)")
                        }
                    }
                    calcNotes.append("Calculator produced \(calcTasks.count) scaled prep lines for \(JsValueFormat.numberString(guests)) guests.")
                } catch let e as RecipeCalculatorError {
                    calcNotes.append("Calculator error (\(e.code)): \(e.message). Falling back to model-provided tasks.")
                    calcTasks = []
                } catch {
                    calcNotes.append("Calculator error (unknown): \(error.localizedDescription). Falling back to model-provided tasks.")
                    calcTasks = []
                }
            } else {
                calcNotes.append("Calculator error (calculator_unavailable): deterministic calculator is not configured on this device. Falling back to model-provided tasks.")
            }
            }
        }

        let modelTasks = payload["tasks"]?.arrayValue ?? []
        let finalTasks: [String?] = calcTasks.isEmpty
            ? modelTasks.map { t in
                // web: clip(typeof t === 'string' ? t : String(t ?? ''), MAX_NOTE)
                // — the nullish coalesce renders JSON null as '' (→ SQL NULL),
                // NOT the template-literal "null".
                let s = t.stringValue ?? (t == .null ? "" : t.jsTemplate)
                return AssistantJSONValue.string(s).clip(AssistantLimits.maxNote)
            }
            : calcTasks.map { AssistantJSONValue.string($0).clip(AssistantLimits.maxNote) }
        let calcScaled = !calcTasks.isEmpty

        // ACID-A: all prep tasks land or none do.
        _ = try AuditedWriteRunner.perform(db: writeDB) { db in
            for t in finalTasks {
                try db.execute(
                    sql: "INSERT INTO beo_prep_tasks (location_id, event_id, task, done, sort_order) VALUES (?, ?, ?, 0, 0)",
                    arguments: [locationId, eventIdNum, t]
                )
            }
            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "beo_prep_tasks", entityId: nil, action: .insert,
                actorCookId: nil, actorSource: Self.actorSource,
                payloadJSON: AssistantAuditJSON.object([
                    ("event_id", .int(eventIdNum)),
                    ("taskCount", .int(Int64(finalTasks.count))),
                    ("calcScaled", .bool(calcScaled)),
                ]),
                note: "beo_add_prep: \(finalTasks.count) tasks",
                shiftDate: shiftDate, locationId: locationId
            ))
        }
        let suffix = calcNotes.isEmpty ? "" : " " + calcNotes.joined(separator: " ")
        return .handled(
            "Added \(finalTasks.count) \(calcScaled ? "calculator-scaled" : "scaled") side-prep tasks to BEO ID \(eventIdNum).\(suffix)"
        )
    }

    // ── give_gold_star ──────────────────────────────────────────────

    private func giveGoldStar(
        _ payload: AssistantActionPayload, locationId: String, shiftDate: String
    ) throws -> Outcome {
        let starsRaw = payload.jsNumber("stars")
        // Stars type guard — pre-fix `Number(stars) || 1` silently coerced.
        guard starsRaw.isFinite, starsRaw >= 1 else {
            return .handled("Could not give gold star — \"stars\" must be a number between 1 and 3.")
        }
        let starVal = Int(min(max(starsRaw.rounded(), 1), 3))
        let cookName = payload.clip("cook_name", 64)
        let reasonSource: AssistantJSONValue = payload.isTruthy("reason")
            ? (payload["reason"] ?? .null)
            : .string("Exceptional performance")
        let reasonClip = reasonSource.clip(AssistantLimits.maxNote)

        // Roster validation (case-insensitive exact display_name). Empty roster
        // → allow (fresh-DB fallback); missing table → allow (legacy fallback).
        var rosterOk = true
        do {
            let total = try writeDB.pool.read { db in
                try Int.fetchOne(db, sql: "SELECT COUNT(*) AS n FROM entities_employees WHERE active = 1") ?? 0
            }
            if total > 0 {
                let match = try writeDB.pool.read { db in
                    try String.fetchOne(
                        db,
                        sql: "SELECT uuid FROM entities_employees WHERE active = 1 AND LOWER(display_name) = LOWER(?) LIMIT 1",
                        arguments: [cookName]
                    )
                }
                rosterOk = match != nil
            }
        } catch {
            rosterOk = true
        }
        guard rosterOk else {
            return .handled(
                "Gold Star blocked — \"\(payload["cook_name"]?.jsTemplate ?? "undefined")\" is not on the active roster. Ask a manager to confirm the name or add the cook first."
            )
        }

        let createdAt = LariConversationMemoryCompute.isoString()
        let (auditId, entityId) = try AuditedWriteRunner.perform(db: writeDB) { db -> (Int64, Int64) in
            try db.execute(
                sql: "INSERT INTO gold_stars (location_id, cook_name, reason, stars) VALUES (?, ?, ?, ?)",
                arguments: [locationId, cookName, reasonClip, starVal]
            )
            let id = db.lastInsertedRowID
            let auditId = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "gold_stars", entityId: id, action: .insert,
                actorCookId: nil, actorSource: Self.actorSource,
                payloadJSON: AssistantAuditJSON.object([
                    ("cook_name", .string(cookName)),
                    ("reason", .string(reasonClip)),
                    ("stars", .int(Int64(starVal))),
                ]),
                shiftDate: shiftDate, locationId: locationId
            ))
            return (auditId, id)
        }
        let msg = "Awarded \(starVal) Gold Star(s) to \(payload["cook_name"]?.jsTemplate ?? "undefined") for HR recognition."
        return .handled(msg, undo: AssistantUndoCompute.buildUndoMeta(
            auditEventId: auditId, entity: "gold_stars", entityId: entityId,
            label: msg, createdAt: createdAt
        ))
    }

    // ── haccp_receive ───────────────────────────────────────────────

    /// The validator seam is injectable so the throw-path contract stays
    /// pinned by tests: a thrown validator maps to status='fail' (regulated
    /// red marker a manager must see) — NEVER 'na' (quiet skip).
    /// See docs/agentic/findings/2026-05-01-haccp-ka-llm-action-receiving-status-na-on-throw.md.
    func haccpStatusAndNote(
        category: String,
        readingF: Double?,
        packageOk: Bool?,
        note: String?,
        validator: (ReceivingReadingInput) throws -> ReceivingReadingResult = {
            ReceivingCompute.validateReceivingReading($0)
        }
    ) -> (status: String, note: String?) {
        do {
            let val = try validator(ReceivingReadingInput(
                category: category,
                readingF: readingF,
                packageOk: packageOk
            ))
            let status = ReceivingCompute.dbStatus(for: val.status) == .rejected ? "fail" : "pass"
            if let reason = val.reason, !reason.isEmpty {
                return (status, "[\(reason)] \(note ?? "")")
            }
            return (status, note)
        } catch {
            return ("fail", "[Validation Error: \(error.localizedDescription)] \(note ?? "")")
        }
    }

    private func haccpReceive(
        _ payload: AssistantActionPayload, locationId: String, shiftDate: String
    ) throws -> Outcome {
        var status = "pass"
        var note = payload.clip("note", AssistantLimits.maxNote)
        let readingF = payload.jsNumber("reading_f")

        if payload.isTruthy("category") {
            let outcome = haccpStatusAndNote(
                category: payload["category"]?.jsTemplate ?? "",
                readingF: readingF.isFinite ? readingF : nil,
                packageOk: payload["package_ok"]?.boolValue,
                note: note
            )
            status = outcome.status
            note = outcome.note
        }

        let itemClip = payload.clip("item", AssistantLimits.maxItem)
        let categoryClip = payload.clip("category", 64)
        let createdAt = LariConversationMemoryCompute.isoString()
        let statusValue = status
        let noteValue = note

        let (auditId, entityId) = try AuditedWriteRunner.perform(db: writeDB) { db -> (Int64, Int64) in
            try db.execute(
                sql: "INSERT INTO line_check_entries (location_id, shift_date, station_id, item, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                arguments: [locationId, shiftDate, "haccp_receiving", itemClip, statusValue, noteValue, createdAt]
            )
            let id = db.lastInsertedRowID
            let auditId = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "line_check_entries", entityId: id, action: .insert,
                actorCookId: nil, actorSource: Self.actorSource,
                payloadJSON: AssistantAuditJSON.object([
                    ("item", .string(itemClip)),
                    ("category", .string(categoryClip)),
                    ("status", .string(statusValue)),
                    ("reading_f", readingF.isFinite ? .number(readingF) : .null),
                ]),
                shiftDate: shiftDate, locationId: locationId
            ))
            return (auditId, id)
        }
        let msg = "Logged HACCP receiving for \(payload["item"]?.jsTemplate ?? "undefined") (\(statusValue))."
        return .handled(msg, undo: AssistantUndoCompute.buildUndoMeta(
            auditEventId: auditId, entity: "line_check_entries", entityId: entityId,
            label: msg, createdAt: createdAt
        ))
    }

    // ── generate_prep ───────────────────────────────────────────────

    private func generatePrep(
        _ payload: AssistantActionPayload, locationId: String, shiftDate: String
    ) async throws -> Outcome {
        let tasks = payload["tasks"]?.arrayValue ?? []
        // Web: `clip(t.item, …)` on a null element throws a TypeError that
        // aborts the whole action BEFORE the transaction (zero rows, generic
        // actionError). Writing NULL-item rows instead would commit prep rows
        // the web refuses to write.
        struct NullTaskElementError: Error {}
        if tasks.contains(.null) { throw NullTaskElementError() }
        let stationClip = payload.clip("station", 64)
        var calcReplacements = 0
        var calcFailures = 0
        // Collect all rows first (calculator is async), then insert atomically.
        var prepRows: [(item: String?, need: String?)] = []

        for t in tasks {
            let obj = t.objectValue
            let slugValue = (obj?["recipe_slug"]?.isTruthy == true ? obj?["recipe_slug"] : nil)
                ?? (obj?["recipe"]?.isTruthy == true ? obj?["recipe"] : nil)
            let mult = obj?["multiplier"].map(\.jsNumber) ?? .nan
            if let slugValue, mult.isFinite, mult > 0, let calculator {
                do {
                    let result = try await calculator.scaleRecipe(slug: slugValue.jsTemplate, multiplier: mult)
                    for leaf in result.leafRows {
                        prepRows.append((
                            item: AssistantJSONValue.string(leaf.ingredient).clip(AssistantLimits.maxItem),
                            need: AssistantJSONValue.string("\(JsValueFormat.numberString(leaf.qty)) \(leaf.unit)").clip(64)
                        ))
                    }
                    calcReplacements += 1
                    continue
                } catch {
                    calcFailures += 1
                    // fall through and store the model's task as-is
                }
            }
            prepRows.append((
                item: obj?["item"]?.clip(AssistantLimits.maxItem),
                need: obj?["need"]?.clip(64)
            ))
        }

        // ACID-A: all prep rows land or none do.
        _ = try AuditedWriteRunner.perform(db: writeDB) { db in
            for row in prepRows {
                try db.execute(
                    sql: "INSERT INTO line_check_entries (location_id, shift_date, station_id, item, status, need, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    arguments: [
                        locationId, shiftDate, stationClip, row.item, "na", row.need,
                        LariConversationMemoryCompute.isoString(),
                    ]
                )
            }
            _ = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: "line_check_entries", entityId: nil, action: .insert,
                actorCookId: nil, actorSource: Self.actorSource,
                payloadJSON: AssistantAuditJSON.object([
                    ("station", .string(stationClip)),
                    ("taskCount", .int(Int64(prepRows.count))),
                    ("calcReplacements", .int(Int64(calcReplacements))),
                    ("calcFailures", .int(Int64(calcFailures))),
                ]),
                note: "generate_prep: \(prepRows.count) rows",
                shiftDate: shiftDate, locationId: locationId
            ))
        }
        let calcSuffix = calcReplacements > 0
            ? " (\(calcReplacements) scaled by calculator\(calcFailures > 0 ? ", \(calcFailures) fallback" : ""))"
            : ""
        return .handled(
            "Generated \(tasks.count) dynamic prep tasks for \(payload["station"]?.jsTemplate ?? "undefined")\(calcSuffix)."
        )
    }
}

/// Ordered JSON builder for audit `payload_json` parity with the web's
/// `JSON.stringify(payload)` — keeps insertion order and real JSON types
/// (numbers unquoted, null as null). Encoding via JsValueFormat matches the
/// established A6.3 byte-for-byte conventions.
enum AssistantAuditJSON {
    enum Value {
        case string(String?)
        case number(Double)
        case int(Int64)
        case bool(Bool)
        case null

        var encoded: String {
            switch self {
            case .string(let s):
                guard let s else { return "null" }
                return JsValueFormat.jsonString(s)
            case .number(let n):
                return n.isFinite ? JsValueFormat.numberString(n) : "null"
            case .int(let i):
                return String(i)
            case .bool(let b):
                return b ? "true" : "false"
            case .null:
                return "null"
            }
        }
    }

    static func object(_ pairs: [(String, Value)]) -> String {
        "{" + pairs.map { "\(JsValueFormat.jsonString($0.0)):\($0.1.encoded)" }.joined(separator: ",") + "}"
    }
}
