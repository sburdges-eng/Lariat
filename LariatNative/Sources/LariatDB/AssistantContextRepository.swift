import Foundation
import GRDB
import LariatModel

/// `buildGroundedContext` port — DB/wire half of `lib/kitchenAssistantContext.ts`.
/// Section ordering, keyword gates, PIN tiering (#247), sources array order and
/// the 12k-char truncation all mirror the web coordinator exactly; per-section
/// text comes from `AssistantContextCompute`.
///
/// Cache loaders are injection seams (tests drive fixtures); production callers
/// use the defaults (same JSON caches lib/data.ts reads).
public struct AssistantContextRepository {
    public struct Caches {
        public var recipes: @Sendable () -> [AssistantRecipe]
        public var menu: @Sendable () -> [AssistantMenuItem]
        public var allergenMatrix: @Sendable () -> AssistantAllergenMatrix
        public var staff: @Sendable () -> [StaffMember]
        public var foodSafety: @Sendable () -> AssistantFoodSafetyData
        public var vendorSummary: @Sendable () -> AssistantVendorSummary?
        public var laborSummary: @Sendable () -> AssistantLaborSummary?
        public var stations: @Sendable () -> StationCatalog

        public init(
            recipes: @escaping @Sendable () -> [AssistantRecipe] = { AssistantDataCaches.loadRecipes() },
            menu: @escaping @Sendable () -> [AssistantMenuItem] = { AssistantDataCaches.loadMenu() },
            allergenMatrix: @escaping @Sendable () -> AssistantAllergenMatrix = { AssistantDataCaches.loadAllergenMatrix() },
            staff: @escaping @Sendable () -> [StaffMember] = { (try? StaffCatalog.load()) ?? [] },
            foodSafety: @escaping @Sendable () -> AssistantFoodSafetyData = { AssistantDataCaches.loadFoodSafety() },
            vendorSummary: @escaping @Sendable () -> AssistantVendorSummary? = { AssistantDataCaches.loadVendorSummary() },
            laborSummary: @escaping @Sendable () -> AssistantLaborSummary? = { AssistantDataCaches.loadLaborSummary() },
            stations: @escaping @Sendable () -> StationCatalog = {
                (try? StationCatalog.load())
                    ?? StationCatalog(stations: [], lineCheckTemplates: [:], recipes: [])
            }
        ) {
            self.recipes = recipes
            self.menu = menu
            self.allergenMatrix = allergenMatrix
            self.staff = staff
            self.foodSafety = foodSafety
            self.vendorSummary = vendorSummary
            self.laborSummary = laborSummary
            self.stations = stations
        }
    }

    private let readDB: LariatDatabase
    private let caches: Caches
    private let datapack: DatapackRepository?
    private let compliance: ComplianceSearchRepository?

    public init(
        readDB: LariatDatabase,
        caches: Caches = Caches(),
        datapack: DatapackRepository? = nil,
        compliance: ComplianceSearchRepository? = nil
    ) {
        self.readDB = readDB
        self.caches = caches
        self.datapack = datapack
        self.compliance = compliance
    }

    typealias C = AssistantContextCompute

    public func buildGroundedContext(
        locationId: String,
        userQuestion: String,
        hasPin: Bool,
        date: String = ShiftDate.todayISO()
    ) throws -> AssistantGroundedContext {
        var sources: [AssistantContextSource] = []
        let qLower = userQuestion.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)

        let recipes = caches.recipes()
        let menu = caches.menu()
        let allergenMatrix = caches.allergenMatrix()
        let menuMatchedSlugs = C.resolveMenuItemsToRecipes(qLower: qLower, menu: menu, recipes: recipes)
        let picked = C.pickRelevantRecipes(
            question: qLower, recipes: recipes, max: C.maxRecipesInContext,
            menuMatchedSlugs: menuMatchedSlugs
        )
        let subRecipes = C.collectSubRecipes(picked: picked, recipes: recipes)
        let catalog = caches.stations()

        var text = "DATE: \(date) (shift_date in database)\nLOCATION_ID: \(locationId)\n\n"

        func append(_ section: C.Section) {
            text += section.text
            if let source = section.source { sources.append(source) }
        }
        func appendMulti(_ section: C.MultiSection) {
            text += section.text
            sources.append(contentsOf: section.sources)
        }

        // All DB reads happen in one snapshot.
        let db = try readDB.pool.read { db -> DbSections in
            try fetchDbSections(db, locationId: locationId, date: date, hasPin: hasPin, qLower: qLower, catalog: catalog)
        }

        // Source-push order mirrors the web coordinator exactly (tests assert it).
        let active86 = C.renderActive86s(db.active86)
        let inventory = C.renderInventoryUpdates(db.inventory)
        let signoffs = C.renderStationSignoffs(db.signoffs)
        let lineCheckProgress = C.renderLineCheckProgress(db.lineCheckStations)
        if let s = active86.source { sources.append(s) }
        if let s = inventory.source { sources.append(s) }
        if let s = signoffs.source { sources.append(s) }
        if let s = lineCheckProgress.source { sources.append(s) }
        if !picked.isEmpty {
            sources.append(AssistantContextSource(
                type: "recipes",
                detail: (picked + subRecipes).map { $0.name ?? "" }.joined(separator: ", ")
            ))
        }

        text += active86.text
        text += inventory.text
        append(C.renderStaffRoster(caches.staff()))
        text += signoffs.text
        text += lineCheckProgress.text
        append(C.renderLineCheckFailures(db.lineCheckFailures))
        append(C.renderMissingSignoffs(stations: catalog.stations, signedOffStationIds: db.signedOffStations))
        append(C.renderEquipmentDown(db.equipmentDown))
        append(C.renderRepeat86s(db.repeat86s))
        // Manager-tier (#247): sales aggregates stay behind the PIN gate.
        if hasPin {
            append(C.renderSalesVelocity(db.salesVelocity))
            append(C.renderDailySalesTrend(db.dailySalesTrend))
        }
        text += C.renderRecipeBlock(picked: picked, subRecipes: subRecipes, allergenMatrix: allergenMatrix)

        // ── Conditional sections (keyword gates) ──────────────────────
        if C.matchesKeywords(qLower, C.foodSafetyKeywords) {
            append(C.renderHaccpCcps(caches.foodSafety()))
            append(renderFdaFoodCode(userQuestion))
        }
        if C.matchesKeywords(qLower, C.ingredientKeywords) {
            append(renderUsdaIngredients(userQuestion))
        }
        if C.matchesKeywords(qLower, C.historyKeywords) {
            append(C.renderHistorical86s(db.historical86s))
        }
        appendMulti(C.renderBeoPrepHistory(
            recentEvents: db.beoPrepHistoryEvents,
            itemDetail: db.beoPrepHistoryItems,
            matchedItemCount: db.beoPrepHistoryMatchedItems
        ))
        if C.matchesKeywords(qLower, C.vendorKeywords) {
            append(C.renderVendorSummaryBlock(caches.vendorSummary()))
        }
        if C.matchesKeywords(qLower, C.laborKeywords) {
            if hasPin {
                append(C.renderLaborSummaryBlock(caches.laborSummary()))
            } else {
                // #247: never inject 7shifts data into a cook-tier prompt.
                text += C.laborSentinel
            }
        }
        if C.matchesKeywords(qLower, C.complianceKeywords), let compliance {
            append(compliance.renderCompliance(userQuestion))
        }

        // ── BEO events + stale prep + order guide ─────────────────────
        append(C.renderBeoEvents(db.beoEvents))
        append(C.renderStaleBeoPrep(db.staleBeoPrep))
        append(C.renderOrderGuide(db.orderGuide))

        if C.matchesKeywords(qLower, C.goldStarKeywords) {
            if hasPin {
                append(C.renderGoldStars(db.goldStars))
            } else {
                text += C.goldStarSentinel
            }
        }
        if C.matchesKeywords(qLower, C.performanceKeywords) {
            if hasPin {
                append(C.renderPerformanceReviews(db.performanceReviews))
            } else {
                text += C.performanceSentinel
            }
        }
        if C.matchesKeywords(qLower, C.equipmentKeywords) {
            append(C.renderEquipmentSpecs(db.equipmentSpecs))
            append(C.renderWarrantyAlerts(db.warrantyAlerts))
        }

        // Trailing boundary line reflects the ACTUAL injection for this tier.
        text += hasPin ? C.notInContextManager : C.notInContextCook

        return AssistantGroundedContext(
            contextText: C.truncateContext(text),
            sources: sources
        )
    }

    // ── DB fetches (queries mirror lib/kitchenAssistantContext.ts) ──

    private struct DbSections {
        var active86: [C.Active86Row] = []
        var inventory: [C.InventoryUpdateRow] = []
        var signoffs: [C.SignoffRow] = []
        var signedOffStations: Set<String> = []
        var lineCheckStations: [C.LineCheckStationInput] = []
        var lineCheckFailures: [C.LineCheckFailureRow] = []
        var equipmentDown: [C.EquipmentDownRow] = []
        var repeat86s: [C.Repeat86Row] = []
        var salesVelocity: [C.SalesVelocityRow] = []
        var dailySalesTrend: [C.DailySalesTrendRow] = []
        var historical86s: [C.HistoricalEightySixRow] = []
        var beoPrepHistoryEvents: [C.BeoPrepHistoryEventRow] = []
        var beoPrepHistoryItems: [C.BeoPrepHistoryItemRow] = []
        var beoPrepHistoryMatchedItems = 0
        var beoEvents: [C.BeoEventInput] = []
        var staleBeoPrep: [C.StaleBeoPrepRow] = []
        var orderGuide: [C.OrderGuideRow] = []
        var goldStars: [C.GoldStarRowInput] = []
        var performanceReviews: [C.PerformanceReviewRow] = []
        var equipmentSpecs: [C.EquipmentSpecRow] = []
        var warrantyAlerts: [C.WarrantyRow] = []
    }

    private func fetchDbSections(
        _ db: Database, locationId: String, date: String, hasPin: Bool,
        qLower: String, catalog: StationCatalog
    ) throws -> DbSections {
        var out = DbSections()

        out.active86 = try Row.fetchAll(
            db,
            sql: """
              SELECT item, station_id, reason, quantity, created_at FROM eighty_six
              WHERE shift_date = ? AND resolved_at IS NULL AND location_id = ?
              ORDER BY id DESC LIMIT ?
              """,
            arguments: [date, locationId, C.max86]
        ).map { C.Active86Row(item: $0["item"], stationId: $0["station_id"], reason: $0["reason"], quantity: $0["quantity"]) }

        out.inventory = try Row.fetchAll(
            db,
            sql: """
              SELECT item, direction, delta, station_id, note, created_at FROM inventory_updates
              WHERE shift_date = ? AND location_id = ?
              ORDER BY id DESC LIMIT ?
              """,
            arguments: [date, locationId, C.maxInv]
        ).map { C.InventoryUpdateRow(item: $0["item"], direction: $0["direction"], delta: $0["delta"], stationId: $0["station_id"], note: $0["note"]) }

        out.signoffs = try Row.fetchAll(
            db,
            sql: """
              SELECT station_id, cook_id, created_at FROM station_signoffs
              WHERE shift_date = ? AND location_id = ? ORDER BY id ASC
              """,
            arguments: [date, locationId]
        ).map { C.SignoffRow(stationId: $0["station_id"], cookId: $0["cook_id"]) }
        out.signedOffStations = Set(out.signoffs.map(\.stationId))

        out.lineCheckStations = try catalog.stations.compactMap { station -> C.LineCheckStationInput? in
            guard station.lineCheckKey != nil else { return nil }
            let template = catalog.lineCheckItems(for: station)
            guard !template.isEmpty else { return nil }
            let entries = try Row.fetchAll(
                db,
                sql: """
                  SELECT item, status FROM line_check_entries
                  WHERE shift_date = ? AND station_id = ? AND location_id = ?
                  ORDER BY id ASC
                  """,
                arguments: [date, station.id, locationId]
            ).map { C.LineCheckEntryStatus(item: $0["item"], status: $0["status"]) }
            return C.LineCheckStationInput(
                stationId: station.id, stationName: station.name,
                template: template, entries: entries
            )
        }

        out.lineCheckFailures = try Row.fetchAll(
            db,
            sql: """
              SELECT station_id, item, note, cook_id FROM line_check_entries
              WHERE shift_date = ? AND location_id = ? AND status = 'fail'
              ORDER BY station_id, id ASC LIMIT ?
              """,
            arguments: [date, locationId, C.maxFailedLineItems]
        ).map { C.LineCheckFailureRow(stationId: $0["station_id"], item: $0["item"], note: $0["note"], cookId: $0["cook_id"]) }

        out.equipmentDown = try Row.fetchAll(
            db,
            sql: """
              SELECT e.id, e.name, e.category, e.status,
                     m.service_date AS last_service_date, m.type AS last_service_type, m.notes AS last_service_notes
              FROM equipment e
              LEFT JOIN equipment_maintenance m
                ON m.equipment_id = e.id
                AND m.id = (SELECT MAX(id) FROM equipment_maintenance WHERE equipment_id = e.id)
              WHERE e.location_id = ? AND e.status != 'active'
              ORDER BY e.name ASC LIMIT ?
              """,
            arguments: [locationId, C.maxEquipmentDown]
        ).map {
            C.EquipmentDownRow(
                name: $0["name"], category: $0["category"], status: $0["status"],
                lastServiceDate: $0["last_service_date"], lastServiceType: $0["last_service_type"],
                lastServiceNotes: $0["last_service_notes"]
            )
        }

        out.repeat86s = try Row.fetchAll(
            db,
            sql: """
              SELECT item, COUNT(DISTINCT shift_date) AS days
              FROM eighty_six
              WHERE location_id = ?
                AND date(shift_date) >= date('now', '-' || ? || ' days')
              GROUP BY item
              HAVING days >= ?
              ORDER BY days DESC, item ASC
              LIMIT ?
              """,
            arguments: [locationId, C.repeat86WindowDays, C.repeat86MinDays, C.maxRepeat86]
        ).map { C.Repeat86Row(item: $0["item"], days: $0["days"]) }

        if hasPin {
            out.salesVelocity = try Row.fetchAll(
                db,
                sql: """
                  SELECT item_name, SUM(quantity_sold) as qty FROM sales_lines
                  WHERE location_id = ?
                  GROUP BY item_name ORDER BY qty DESC LIMIT 15
                  """,
                arguments: [locationId]
            ).map { C.SalesVelocityRow(itemName: $0["item_name"], qty: $0["qty"]) }

            out.dailySalesTrend = try Row.fetchAll(
                db,
                sql: """
                  SELECT g1.shift_date, g1.net_sales, g1.orders, g1.guests,
                         g2.net_sales AS yoy_net_sales,
                         g2.orders    AS yoy_orders,
                         g2.guests    AS yoy_guests
                  FROM toast_sales_daily g1
                  LEFT JOIN toast_sales_daily g2
                    ON g2.location_id = g1.location_id
                   AND g2.comparison_group = 2
                   AND date(g2.shift_date) = date(g1.shift_date, '-1 year')
                  WHERE g1.location_id = ?
                    AND g1.comparison_group = 1
                    AND date(g1.shift_date) <= date(?)
                    AND date(g1.shift_date) >= date(?, '-' || ? || ' days')
                  ORDER BY g1.shift_date DESC
                  LIMIT ?
                  """,
                arguments: [locationId, date, date, C.dailySalesTrendWindowDays, C.dailySalesTrendWindowDays]
            ).map {
                C.DailySalesTrendRow(
                    shiftDate: $0["shift_date"], netSales: $0["net_sales"], orders: $0["orders"],
                    guests: $0["guests"], yoyNetSales: $0["yoy_net_sales"], yoyOrders: $0["yoy_orders"],
                    yoyGuests: $0["yoy_guests"]
                )
            }
        }

        if C.matchesKeywords(qLower, C.historyKeywords) {
            out.historical86s = try Row.fetchAll(
                db,
                sql: """
                  SELECT item, COUNT(*) as freq FROM eighty_six
                  WHERE location_id = ?
                  GROUP BY item ORDER BY freq DESC LIMIT 15
                  """,
                arguments: [locationId]
            ).map { C.HistoricalEightySixRow(item: $0["item"], freq: $0["freq"]) }
        }

        // BEO prep history (catering/prep keyword → recent events; item names
        // in the question → per-item history).
        let isCateringQ = C.matchesKeywords(qLower, C.cateringKeywords)
            || C.matchesKeywords(qLower, C.prepPlanningKeywords)
        if isCateringQ {
            out.beoPrepHistoryEvents = try Row.fetchAll(
                db,
                sql: """
                  SELECT client, event_date,
                         GROUP_CONCAT(item || ' (' || COALESCE(amount_qty, '?') || ')', ', ') AS items
                    FROM (
                      SELECT client, event_date, item, amount_qty
                        FROM beo_prep_history
                       WHERE location_id = ? AND event_date IS NOT NULL
                         AND (type IS NULL OR type = 'Main Item')
                       ORDER BY event_date DESC, id ASC
                    )
                    GROUP BY client, event_date
                    ORDER BY event_date DESC
                    LIMIT ?
                  """,
                arguments: [locationId, C.maxBeoPrepRecentEvents]
            ).map { C.BeoPrepHistoryEventRow(client: $0["client"], eventDate: $0["event_date"], items: $0["items"] ?? "") }
        }
        if qLower.count >= 4 {
            let itemHits = try String.fetchAll(
                db,
                sql: "SELECT DISTINCT item FROM beo_prep_history WHERE location_id = ? AND item IS NOT NULL",
                arguments: [locationId]
            )
            let matched = itemHits.filter { !$0.isEmpty && qLower.contains($0.lowercased()) }
            out.beoPrepHistoryMatchedItems = matched.count
            if !matched.isEmpty {
                var arguments: [DatabaseValueConvertible] = [locationId]
                arguments.append(contentsOf: matched)
                arguments.append(C.maxBeoPrepItemHistory)
                out.beoPrepHistoryItems = try Row.fetchAll(
                    db,
                    sql: """
                      SELECT item, client, event_date, amount_qty,
                             pre_prep_notes, plating_notes, prep_day
                        FROM beo_prep_history
                       WHERE location_id = ?
                         AND item IN (\(matched.map { _ in "?" }.joined(separator: ",")))
                       ORDER BY (event_date IS NULL), event_date DESC, id DESC
                       LIMIT ?
                      """,
                    arguments: StatementArguments(arguments)
                ).map {
                    C.BeoPrepHistoryItemRow(
                        item: $0["item"], client: $0["client"], eventDate: $0["event_date"],
                        amountQty: $0["amount_qty"], prePrepNotes: $0["pre_prep_notes"],
                        platingNotes: $0["plating_notes"], prepDay: $0["prep_day"]
                    )
                }
            }
        }

        // Upcoming BEO events + their prep tasks.
        let beoRows = try Row.fetchAll(
            db,
            sql: """
              SELECT * FROM beo_events WHERE location_id = ?
                AND date(event_date) >= date(?)
                ORDER BY event_date ASC LIMIT 5
              """,
            arguments: [locationId, date]
        )
        if !beoRows.isEmpty {
            let beoIds: [Int64] = beoRows.map { $0["id"] }
            var taskArgs: [DatabaseValueConvertible] = []
            taskArgs.append(contentsOf: beoIds)
            let taskRows = try Row.fetchAll(
                db,
                sql: "SELECT * FROM beo_prep_tasks WHERE event_id IN (\(beoIds.map { _ in "?" }.joined(separator: ","))) ORDER BY sort_order",
                arguments: StatementArguments(taskArgs)
            )
            out.beoEvents = beoRows.map { b in
                let id: Int64 = b["id"]
                let tasks = taskRows
                    .filter { ($0["event_id"] as Int64?) == id }
                    .map { (task: $0["task"] as String? ?? "", done: ($0["done"] as Int? ?? 0) != 0) }
                return C.BeoEventInput(
                    id: id, title: b["title"], eventDate: b["event_date"] ?? "",
                    guestCount: b["guest_count"], notes: b["notes"], prepTasks: tasks
                )
            }
        }

        out.staleBeoPrep = try Row.fetchAll(
            db,
            sql: """
              SELECT t.task, t.due_date, e.title, e.event_date, e.id AS event_id
              FROM beo_prep_tasks t
              JOIN beo_events e ON e.id = t.event_id
              WHERE t.location_id = ?
                AND t.done = 0
                AND date(e.event_date) >= date(?)
                AND date(e.event_date) <= date(?, '+' || ? || ' days')
              ORDER BY date(e.event_date) ASC, t.sort_order ASC
              LIMIT ?
              """,
            arguments: [locationId, date, date, C.staleBeoWindowDays, C.maxStaleBeo]
        ).map { C.StaleBeoPrepRow(task: $0["task"], title: $0["title"], eventDate: $0["event_date"], eventId: $0["event_id"]) }

        out.orderGuide = try Row.fetchAll(
            db,
            sql: "SELECT * FROM order_guide_items WHERE location_id = ? ORDER BY ingredient LIMIT 20",
            arguments: [locationId]
        ).map { C.OrderGuideRow(ingredient: $0["ingredient"], baseQty: $0["base_qty"], unit: $0["unit"]) }

        if hasPin && C.matchesKeywords(qLower, C.goldStarKeywords) {
            out.goldStars = try Row.fetchAll(
                db,
                sql: """
                  SELECT cook_name, reason, stars, awarded_date FROM gold_stars
                  WHERE location_id = ?
                  ORDER BY id DESC LIMIT ?
                  """,
                arguments: [locationId, C.maxGoldStars]
            ).map { C.GoldStarRowInput(cookName: $0["cook_name"], reason: $0["reason"], stars: $0["stars"], awardedDate: $0["awarded_date"] ?? "") }
        }

        if hasPin && C.matchesKeywords(qLower, C.performanceKeywords) {
            out.performanceReviews = try Row.fetchAll(
                db,
                sql: """
                  SELECT cook_name, cook_uuid, review_date, punctuality_score, technique_score, speed_score, notes, reviewer_name
                  FROM performance_reviews
                  WHERE location_id = ?
                  ORDER BY review_date DESC, id DESC LIMIT ?
                  """,
                arguments: [locationId, C.maxPerformanceReviews]
            ).map {
                C.PerformanceReviewRow(
                    cookName: $0["cook_name"], cookUuid: $0["cook_uuid"], reviewDate: $0["review_date"],
                    punctualityScore: $0["punctuality_score"] ?? 0, techniqueScore: $0["technique_score"] ?? 0,
                    speedScore: $0["speed_score"] ?? 0, notes: $0["notes"], reviewerName: $0["reviewer_name"]
                )
            }
        }

        if C.matchesKeywords(qLower, C.equipmentKeywords) {
            let filters = C.equipmentSpecFilters(qLower)
            if !filters.isEmpty {
                var clauses: [String] = []
                var arguments: [DatabaseValueConvertible] = [locationId]
                for c in filters.catLikes.sorted() {
                    clauses.append("lower(category) LIKE ?")
                    arguments.append("%\(c)%")
                }
                for n in filters.nameLikes.sorted() {
                    clauses.append("lower(name) LIKE ?")
                    arguments.append("%\(n)%")
                }
                arguments.append(C.maxEquipmentSpecs)
                out.equipmentSpecs = try Row.fetchAll(
                    db,
                    sql: """
                      SELECT name, category, make_model, model_number, status, vendor
                      FROM equipment
                      WHERE location_id = ? AND (\(clauses.joined(separator: " OR ")))
                      ORDER BY name ASC LIMIT ?
                      """,
                    arguments: StatementArguments(arguments)
                ).map {
                    C.EquipmentSpecRow(
                        name: $0["name"], category: $0["category"], makeModel: $0["make_model"],
                        modelNumber: $0["model_number"], status: $0["status"], vendor: $0["vendor"]
                    )
                }
            }

            out.warrantyAlerts = try Row.fetchAll(
                db,
                sql: """
                  SELECT name, category, warranty_expiration FROM equipment
                  WHERE location_id = ?
                    AND warranty_expiration IS NOT NULL
                    AND warranty_expiration != ''
                    AND date(warranty_expiration) >= date('now')
                    AND date(warranty_expiration) <= date('now', '+' || ? || ' days')
                  ORDER BY date(warranty_expiration) ASC
                  LIMIT ?
                  """,
                arguments: [locationId, C.warrantyWindowDays, C.maxWarranties]
            ).map { C.WarrantyRow(name: $0["name"], category: $0["category"], warrantyExpiration: $0["warranty_expiration"]) }
        }

        return out
    }

    // ── datapack sections (lexical — semantic channel deferred) ─────

    /// FDA Food Code block via DatapackRepository FTS. The web's hybrid
    /// retrieval degrades to this exact path when the vector pack is absent.
    func renderFdaFoodCode(_ question: String) -> C.Section {
        guard let datapack else { return .empty }
        let trimmed = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .empty }
        let phrase = DatapackSearchCompute.escapeFtsPhrase(trimmed)
        guard let hits = try? datapack.fts(phrase, source: .fda, limit: C.maxFdaHits * 2),
              !hits.isEmpty
        else { return .empty }

        let mapped: [C.FdaFoodCodeHit] = hits.map { hit in
            let rowid = Int64(hit.hitId)
            let body = rowid.flatMap { try? datapack.fdaSection(rowid: $0)?.body } ?? ""
            return C.FdaFoodCodeHit(
                sectionId: hit.subtitle ?? "",
                title: hit.title ?? "",
                whereLabel: hit.extra ?? "",
                body: body
            )
        }
        return C.renderFdaFoodCode(mapped)
    }

    /// USDA ingredients block via DatapackRepository FTS + nutrients.
    func renderUsdaIngredients(_ question: String) -> C.Section {
        guard let datapack else { return .empty }
        let trimmed = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .empty }
        let phrase = DatapackSearchCompute.escapeFtsPhrase(trimmed)
        guard let hits = try? datapack.fts(phrase, source: .usda, limit: C.maxUsdaHits * 2),
              !hits.isEmpty
        else { return .empty }

        let mapped: [C.UsdaIngredientHit] = hits.compactMap { hit in
            guard let fdcId = Int64(hit.hitId) else { return nil }
            let nutrients = (try? datapack.usdaNutrients(fdcId: fdcId)) ?? []
            return C.UsdaIngredientHit(
                fdcId: fdcId,
                description: hit.title ?? "",
                category: hit.subtitle ?? "",
                meta: hit.extra ?? "",
                nutrients: nutrients.map {
                    C.UsdaNutrientInput(nutrientName: $0.nutrientName, amount: $0.amount, unitName: $0.unitName)
                }
            )
        }
        return C.renderUsdaIngredients(mapped)
    }
}
