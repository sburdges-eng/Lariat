import Foundation

/// Pure renderers ported 1:1 from `lib/kitchenAssistantContext.ts`. Every
/// function returns the exact prompt text the web builds; the DB/wire halves
/// live in LariatDB.AssistantContextRepository which feeds these typed rows in
/// the web coordinator's order.
public enum AssistantContextCompute {
    // ── Limits / windows (web constants) ────────────────────────────
    public static let max86 = 40
    public static let maxInv = 20
    public static let maxRecipesInContext = 5
    public static let maxIngChars = 500
    public static let maxContextChars = 12000
    public static let staleBeoWindowDays = 2
    public static let repeat86WindowDays = 7
    public static let repeat86MinDays = 3
    public static let warrantyWindowDays = 30
    public static let maxFailedLineItems = 20
    public static let maxMissingSignoffs = 10
    public static let maxEquipmentDown = 15
    public static let maxStaleBeo = 20
    public static let maxRepeat86 = 10
    public static let maxGoldStars = 10
    public static let maxPerformanceReviews = 15
    public static let maxWarranties = 10
    public static let maxEquipmentSpecs = 12
    public static let maxBeoPrepRecentEvents = 5
    public static let maxBeoPrepItemHistory = 5
    public static let dailySalesTrendWindowDays = 7
    public static let maxFdaHits = 3
    public static let maxFdaBodyChars = 1200
    public static let maxUsdaHits = 4
    public static let maxUsdaBodyChars = 400

    // ── Keyword gates ───────────────────────────────────────────────
    public static let foodSafetyKeywords = [
        "temp", "temperature", "holding", "cool", "reheat", "haccp",
        "safe", "food safety", "165", "155", "145", "140", "41",
    ]
    public static let ingredientKeywords = [
        "ingredient", "protein", "calorie", "kcal", "carb", "fiber",
        "sodium", "sugar", "grams", "gluten", "vegan", "vegetarian",
        "nutrition", "allergen", "substitute", "yield", "shrinkage",
        "total lipid", "total fat",
    ]
    public static let historyKeywords = ["often", "history", "frequent", "always", "most", "past"]
    public static let vendorKeywords = [
        "sysco", "vendor", "order", "supplier", "brand", "purchase", "catalog", "case",
    ]
    public static let laborKeywords = [
        "labor", "staff", "schedule", "7shift", "hours", "overtime",
    ]
    public static let goldStarKeywords = [
        "recognition", "gold star", "gold", "award", "praise", "kudos", "star",
    ]
    public static let performanceKeywords = [
        "review", "performance", "evaluation", "metric", "rating", "feedback", "appraisal",
    ]
    public static let equipmentKeywords = [
        "equipment", "warranty", "maintenance", "service", "broken", "repair", "down",
        "model", "serial", "spec", "manufacturer", "brand",
        "ice machine", "ice maker", "fryer", "walk-in", "walk in", "freezer",
        "fridge", "refrigerat", "cooler", "reach-in", "prep table", "lowboy",
        "dishwasher", "dish machine", "warewash", "mixer", "slicer", "salamander",
        "griddle", "flat top", "convection", "combi", "steamer",
    ]
    public static let cateringKeywords = [
        "beo", "catering", "cater", "wedding", "event", "buffet", "banquet",
        "reception", "rehearsal", "birthday", "party", "graduation", "shower",
    ]
    public static let prepPlanningKeywords = [
        "prep", "pre-prep", "pre prep", "plate", "plating", "scale", "portion",
    ]
    public static let complianceKeywords = [
        "overtime", "wage", "minimum wage", "tip", "tips", "tipped",
        "sick leave", "hfwa", "meal break", "rest break", "comps order",
        "final paycheck", "youth labor", "minor", "equal pay",
        "liquor", "alcohol", "id check", "fake id", "underage",
        "visibly intoxicated", "over-served", "overserved", "dram shop",
        "responsible vendor", "refusal of service",
        "bouncer", "door security", "use of force", "detain", "restrain",
        "patron search", "bag check", "eject", "remove patron",
        "compliance", "colorado law", "cdle", "cdor",
    ]

    public static func matchesKeywords(_ qLower: String, _ keywords: [String]) -> Bool {
        keywords.contains { qLower.contains($0) }
    }

    public struct Section: Sendable, Equatable {
        public let text: String
        public let source: AssistantContextSource?

        public init(text: String, source: AssistantContextSource?) {
            self.text = text
            self.source = source
        }

        public static let empty = Section(text: "", source: nil)
    }

    public struct MultiSection: Sendable, Equatable {
        public let text: String
        public let sources: [AssistantContextSource]

        public init(text: String, sources: [AssistantContextSource]) {
            self.text = text
            self.sources = sources
        }
    }

    // ── Tier sentinels + trailing boundary lines (GH #247) ──────────

    public static let laborSentinel =
        "\nLABOR SUMMARY: not available at this auth tier — tell the cook to ask a manager for labor figures.\n"
    public static let goldStarSentinel =
        "\nGOLD STAR RECOGNITION: not available at this auth tier — tell the cook to ask a manager about recognition history.\n"
    public static let performanceSentinel =
        "\nPERFORMANCE REVIEWS: not available at this auth tier — performance review data is manager-only.\n"
    public static let notInContextManager =
        "\nNOT IN THIS CONTEXT: live POS, vendor pricing, full menu engineering, items not listed above.\n"
    public static let notInContextCook =
        "\nNOT IN THIS CONTEXT: live POS, Toast totals, vendor pricing, labor figures, recognition + performance review data, items not listed above.\n"

    /// Final char-budget clamp.
    public static func truncateContext(_ text: String) -> String {
        guard text.count > maxContextChars else { return text }
        return String(text.prefix(maxContextChars - 30)) + "\n… [context truncated]\n"
    }

    // ── Always-on renderers ─────────────────────────────────────────

    public struct Active86Row: Sendable, Equatable {
        public let item: String
        public let stationId: String?
        public let reason: String?
        public let quantity: String?

        public init(item: String, stationId: String?, reason: String?, quantity: String?) {
            self.item = item
            self.stationId = stationId
            self.reason = reason
            self.quantity = quantity
        }
    }

    public static func renderActive86s(_ rows: [Active86Row]) -> Section {
        var text = "ACTIVE 86 (unresolved, today):\n"
        if rows.isEmpty {
            text += "  (none)\n"
        } else {
            for e in rows {
                text += "  - \(e.item)"
                if let s = e.stationId, !s.isEmpty { text += " @ \(s)" }
                if let r = e.reason, !r.isEmpty { text += " | \(r)" }
                if let q = e.quantity, !q.isEmpty { text += " | qty \(q)" }
                text += "\n"
            }
        }
        return Section(text: text, source: AssistantContextSource(type: "eighty_six", detail: "\(rows.count) active (today)"))
    }

    public struct InventoryUpdateRow: Sendable, Equatable {
        public let item: String
        public let direction: String?
        public let delta: String?
        public let stationId: String?
        public let note: String?

        public init(item: String, direction: String?, delta: String?, stationId: String?, note: String?) {
            self.item = item
            self.direction = direction
            self.delta = delta
            self.stationId = stationId
            self.note = note
        }
    }

    public static func renderInventoryUpdates(_ rows: [InventoryUpdateRow]) -> Section {
        var text = "\nRECENT INVENTORY UPDATES (today, newest first):\n"
        if rows.isEmpty {
            text += "  (none)\n"
        } else {
            for u in rows {
                let bits = [u.direction, u.delta, u.stationId, u.note]
                    .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
                text += "  - \(u.item)\(bits.isEmpty ? "" : " | \(bits)")\n"
            }
        }
        return Section(text: text, source: AssistantContextSource(type: "inventory", detail: "\(rows.count) rows (today)"))
    }

    public struct SignoffRow: Sendable, Equatable {
        public let stationId: String
        public let cookId: String

        public init(stationId: String, cookId: String) {
            self.stationId = stationId
            self.cookId = cookId
        }
    }

    public static func renderStationSignoffs(_ rows: [SignoffRow]) -> Section {
        var text = "\nSTATION SIGN-OFFS (today):\n"
        if rows.isEmpty {
            text += "  (none)\n"
        } else {
            for so in rows { text += "  - \(so.stationId) by \(so.cookId)\n" }
        }
        return Section(text: text, source: AssistantContextSource(type: "signoffs", detail: "\(rows.count) sign-off(s) (today)"))
    }

    public struct LineCheckStationInput: Sendable, Equatable {
        public let stationId: String
        public let stationName: String
        public let template: [String]
        /// (item, status) rows for the station today, id ASC.
        public let entries: [LineCheckEntryStatus]

        public init(stationId: String, stationName: String, template: [String], entries: [LineCheckEntryStatus]) {
            self.stationId = stationId
            self.stationName = stationName
            self.template = template
            self.entries = entries
        }
    }

    public struct LineCheckEntryStatus: Sendable, Equatable {
        public let item: String
        public let status: String

        public init(item: String, status: String) {
            self.item = item
            self.status = status
        }
    }

    public static func renderLineCheckProgress(_ stations: [LineCheckStationInput]) -> Section {
        var text = "\nLINE CHECK PROGRESS (today, from database vs template counts):\n"
        var summarized = 0
        for s in stations where !s.template.isEmpty {
            summarized += 1
            var byItem: [String: String] = [:]
            for r in s.entries { byItem[r.item] = r.status }
            var done = 0
            var fail = 0
            for item in s.template {
                if let st = byItem[item], st == "pass" || st == "fail" || st == "na" {
                    done += 1
                    if st == "fail" { fail += 1 }
                }
            }
            text += "  - \(s.stationName) (\(s.stationId)): \(done)/\(s.template.count) items recorded"
            if fail > 0 { text += ", \(fail) fail" }
            text += "\n"
        }
        return Section(
            text: text,
            source: AssistantContextSource(type: "line_checks", detail: "\(summarized) station(s) with templates")
        )
    }

    public static func renderStaffRoster(_ staff: [StaffMember]) -> Section {
        let roster = staff.filter { $0.active != false }
        if roster.isEmpty { return .empty }
        var text = "\nACTIVE STAFF ROSTER (Use exact full names for Gold Stars or HR actions):\n"
        for s in roster {
            text += "  - \(s.first ?? "") \(s.last ?? "") (ID: \(s.id))\n"
        }
        return Section(text: text, source: AssistantContextSource(type: "staff_roster", detail: "\(roster.count) active staff"))
    }

    public struct SalesVelocityRow: Sendable, Equatable {
        public let itemName: String
        public let qty: Double?

        public init(itemName: String, qty: Double?) {
            self.itemName = itemName
            self.qty = qty
        }
    }

    public static func renderSalesVelocity(_ rows: [SalesVelocityRow]) -> Section {
        if rows.isEmpty { return .empty }
        var text = "\nSALES VELOCITY (Historical volume to calculate dynamic prep against):\n"
        for s in rows {
            if let qty = s.qty, qty != 0, !qty.isNaN {
                text += "  - \(s.itemName): \(Int(qty.rounded())) units sold\n"
            }
        }
        return Section(text: text, source: AssistantContextSource(type: "sales_velocity", detail: "Top 15 items"))
    }

    // ── Oversight renderers ─────────────────────────────────────────

    public struct LineCheckFailureRow: Sendable, Equatable {
        public let stationId: String
        public let item: String
        public let note: String?
        public let cookId: String?

        public init(stationId: String, item: String, note: String?, cookId: String?) {
            self.stationId = stationId
            self.item = item
            self.note = note
            self.cookId = cookId
        }
    }

    public static func renderLineCheckFailures(_ rows: [LineCheckFailureRow]) -> Section {
        if rows.isEmpty { return .empty }
        var text = "\nLINE CHECK FAILURES (today, itemized — manager should address):\n"
        for r in rows {
            let bits = [r.note, r.cookId.map { "by \($0)" }]
                .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
            text += "  - [\(r.stationId)] \(r.item)\(bits.isEmpty ? "" : " | \(bits)")\n"
        }
        return Section(text: text, source: AssistantContextSource(type: "line_check_failures", detail: "\(rows.count) failure(s)"))
    }

    public static func renderMissingSignoffs(
        stations: [KitchenStation],
        signedOffStationIds: Set<String>
    ) -> Section {
        let missing = stations
            .filter { $0.lineCheckKey != nil && !signedOffStationIds.contains($0.id) }
            .prefix(maxMissingSignoffs)
        if missing.isEmpty { return .empty }
        var text = "\nSTATIONS WITHOUT SIGN-OFF (today — line-check stations only):\n"
        for s in missing { text += "  - \(s.name) (\(s.id))\n" }
        return Section(text: text, source: AssistantContextSource(type: "missing_signoffs", detail: "\(missing.count) station(s)"))
    }

    public struct EquipmentDownRow: Sendable, Equatable {
        public let name: String
        public let category: String
        public let status: String
        public let lastServiceDate: String?
        public let lastServiceType: String?
        public let lastServiceNotes: String?

        public init(name: String, category: String, status: String, lastServiceDate: String?, lastServiceType: String?, lastServiceNotes: String?) {
            self.name = name
            self.category = category
            self.status = status
            self.lastServiceDate = lastServiceDate
            self.lastServiceType = lastServiceType
            self.lastServiceNotes = lastServiceNotes
        }
    }

    public static func renderEquipmentDown(_ rows: [EquipmentDownRow]) -> Section {
        if rows.isEmpty { return .empty }
        var text = "\nEQUIPMENT OUT OF SERVICE:\n"
        for r in rows {
            text += "  - \(r.name) (\(r.category)) — status: \(r.status)\n"
            if let svc = r.lastServiceDate {
                let svcBits = [r.lastServiceType, r.lastServiceNotes]
                    .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
                text += "    last service: \(svc)\(svcBits.isEmpty ? "" : " (\(svcBits))")\n"
            }
        }
        return Section(text: text, source: AssistantContextSource(type: "equipment_down", detail: "\(rows.count) unit(s)"))
    }

    public struct Repeat86Row: Sendable, Equatable {
        public let item: String
        public let days: Int

        public init(item: String, days: Int) {
            self.item = item
            self.days = days
        }
    }

    public static func renderRepeat86s(_ rows: [Repeat86Row]) -> Section {
        if rows.isEmpty { return .empty }
        var text = "\nREPEAT 86s (≥\(repeat86MinDays) of last \(repeat86WindowDays) days — systemic issue):\n"
        for r in rows { text += "  - \(r.item): 86'd \(r.days) day(s)\n" }
        return Section(text: text, source: AssistantContextSource(type: "eighty_six_repeat", detail: "\(rows.count) item(s)"))
    }

    public struct HistoricalEightySixRow: Sendable, Equatable {
        public let item: String
        public let freq: Int

        public init(item: String, freq: Int) {
            self.item = item
            self.freq = freq
        }
    }

    public static func renderHistorical86s(_ rows: [HistoricalEightySixRow]) -> Section {
        if rows.isEmpty { return .empty }
        var text = "\nHISTORICAL 86 FREQUENCY (Lifetime):\n"
        for h in rows { text += "  - \(h.item): 86'd \(h.freq) times\n" }
        return Section(text: text, source: AssistantContextSource(type: "eighty_six_history", detail: "Top \(rows.count) flagged"))
    }

    public struct GoldStarRowInput: Sendable, Equatable {
        public let cookName: String
        public let reason: String
        public let stars: Int
        public let awardedDate: String

        public init(cookName: String, reason: String, stars: Int, awardedDate: String) {
            self.cookName = cookName
            self.reason = reason
            self.stars = stars
            self.awardedDate = awardedDate
        }
    }

    public static func renderGoldStars(_ rows: [GoldStarRowInput]) -> Section {
        if rows.isEmpty { return .empty }
        var text = "\nRECENT GOLD STARS (recognition):\n"
        for r in rows {
            text += "  - [\(r.awardedDate)] \(r.cookName) (\(r.stars)★): \(r.reason)\n"
        }
        return Section(text: text, source: AssistantContextSource(type: "gold_stars", detail: "\(rows.count) recognition(s)"))
    }

    public struct PerformanceReviewRow: Sendable, Equatable {
        public let cookName: String
        public let cookUuid: String?
        public let reviewDate: String
        public let punctualityScore: Int
        public let techniqueScore: Int
        public let speedScore: Int
        public let notes: String?
        public let reviewerName: String

        public init(cookName: String, cookUuid: String?, reviewDate: String, punctualityScore: Int, techniqueScore: Int, speedScore: Int, notes: String?, reviewerName: String) {
            self.cookName = cookName
            self.cookUuid = cookUuid
            self.reviewDate = reviewDate
            self.punctualityScore = punctualityScore
            self.techniqueScore = techniqueScore
            self.speedScore = speedScore
            self.notes = notes
            self.reviewerName = reviewerName
        }
    }

    public static func renderPerformanceReviews(_ rows: [PerformanceReviewRow]) -> Section {
        if rows.isEmpty { return .empty }
        var text = "\nRECENT PERFORMANCE REVIEWS (staff evaluations):\n"
        for r in rows {
            let uuid = r.cookUuid.map { " [uuid:\($0)]" } ?? ""
            text += "  - [\(r.reviewDate)] \(r.cookName)\(uuid) | scores: on-time=\(r.punctualityScore), tech=\(r.techniqueScore), speed=\(r.speedScore) | by \(r.reviewerName)"
            if let notes = r.notes, !notes.isEmpty { text += " | notes: \(notes)" }
            text += "\n"
        }
        return Section(text: text, source: AssistantContextSource(type: "performance_reviews", detail: "\(rows.count) evaluation(s)"))
    }

    public struct WarrantyRow: Sendable, Equatable {
        public let name: String
        public let category: String
        public let warrantyExpiration: String

        public init(name: String, category: String, warrantyExpiration: String) {
            self.name = name
            self.category = category
            self.warrantyExpiration = warrantyExpiration
        }
    }

    public static func renderWarrantyAlerts(_ rows: [WarrantyRow]) -> Section {
        if rows.isEmpty { return .empty }
        var text = "\nWARRANTY EXPIRATIONS (next \(warrantyWindowDays) days):\n"
        for r in rows {
            text += "  - \(r.name) (\(r.category)) — expires \(r.warrantyExpiration)\n"
        }
        return Section(text: text, source: AssistantContextSource(type: "warranty_alerts", detail: "\(rows.count) item(s)"))
    }

    // ── Equipment spec synonyms (pure filter derivation) ────────────

    static let equipmentSpecSynonyms: [(phrases: [String], likes: [String])] = [
        (["fryer"], ["cat:fryers", "name:fryer"]),
        (["oven", "convection", "combi"], ["cat:ovens", "name:oven"]),
        (["salamander", "griddle", "flat top", "broiler"], ["name:griddle", "name:salamander", "name:broiler"]),
        (["steamer"], ["name:steamer"]),
        (["mixer"], ["name:mixer"]),
        (["slicer"], ["name:slicer"]),
        (["dishwasher", "dish machine", "warewash"], ["name:dishwash", "name:dish machine", "name:warewash"]),
        (
            ["walk-in", "walk in", "freezer", "fridge", "refrigerat", "cooler", "reach-in", "prep table", "lowboy"],
            ["cat:refrigeration", "name:freezer", "name:cooler"]
        ),
        (["ice machine", "ice maker", "ice bin", "ice cuber"], ["name:ice machine", "name:ice maker", "name:ice bin"]),
    ]

    public struct EquipmentSpecFilters: Sendable, Equatable {
        public let nameLikes: Set<String>
        public let catLikes: Set<String>

        public var isEmpty: Bool { nameLikes.isEmpty && catLikes.isEmpty }
    }

    public static func equipmentSpecFilters(_ qLower: String) -> EquipmentSpecFilters {
        var nameLikes = Set<String>()
        var catLikes = Set<String>()
        for grp in equipmentSpecSynonyms {
            guard grp.phrases.contains(where: { qLower.contains($0) }) else { continue }
            for l in grp.likes {
                if l.hasPrefix("cat:") { catLikes.insert(String(l.dropFirst(4))) }
                else { nameLikes.insert(String(l.dropFirst(5))) }
            }
        }
        return EquipmentSpecFilters(nameLikes: nameLikes, catLikes: catLikes)
    }

    public struct EquipmentSpecRow: Sendable, Equatable {
        public let name: String
        public let category: String
        public let makeModel: String?
        public let modelNumber: String?
        public let status: String?
        public let vendor: String?

        public init(name: String, category: String, makeModel: String?, modelNumber: String?, status: String?, vendor: String?) {
            self.name = name
            self.category = category
            self.makeModel = makeModel
            self.modelNumber = modelNumber
            self.status = status
            self.vendor = vendor
        }
    }

    public static func renderEquipmentSpecs(_ rows: [EquipmentSpecRow]) -> Section {
        if rows.isEmpty { return .empty }
        var text = "\nEQUIPMENT SPECS (matched to your question):\n"
        for r in rows {
            let model = firstNonEmpty(r.makeModel, r.modelNumber) ?? "no model on file"
            var extras: [String] = []
            if let status = r.status, !status.isEmpty, status != "active" { extras.append("status: \(status)") }
            if let vendor = r.vendor, !vendor.isEmpty { extras.append("vendor: \(vendor)") }
            let extra = extras.joined(separator: " · ")
            text += "  - \(r.name) (\(r.category)) — model: \(model)\(extra.isEmpty ? "" : " · \(extra)")\n"
        }
        return Section(text: text, source: AssistantContextSource(type: "equipment_specs", detail: "\(rows.count) unit(s)"))
    }

    private static func firstNonEmpty(_ values: String?...) -> String? {
        for v in values {
            if let v, !v.isEmpty { return v }
        }
        return nil
    }

    // ── BEO renderers ───────────────────────────────────────────────

    public struct BeoEventInput: Sendable, Equatable {
        public let id: Int64
        public let title: String
        public let eventDate: String
        public let guestCount: Int?
        public let notes: String?
        public let prepTasks: [(task: String, done: Bool)]

        public init(id: Int64, title: String, eventDate: String, guestCount: Int?, notes: String?, prepTasks: [(task: String, done: Bool)]) {
            self.id = id
            self.title = title
            self.eventDate = eventDate
            self.guestCount = guestCount
            self.notes = notes
            self.prepTasks = prepTasks
        }

        public static func == (lhs: BeoEventInput, rhs: BeoEventInput) -> Bool {
            lhs.id == rhs.id && lhs.title == rhs.title && lhs.eventDate == rhs.eventDate
                && lhs.guestCount == rhs.guestCount && lhs.notes == rhs.notes
                && lhs.prepTasks.elementsEqual(rhs.prepTasks, by: { $0 == $1 })
        }
    }

    public static func renderBeoEvents(_ beos: [BeoEventInput]) -> Section {
        if beos.isEmpty { return .empty }
        var text = "\nUPCOMING BANQUETS & PARTIES (BEO):\n"
        for b in beos {
            let covers = (b.guestCount ?? 0) != 0 ? String(b.guestCount ?? 0) : "TBD"
            text += "  - [BEO ID: \(b.id)] \(b.title) on \(b.eventDate) (Covers: \(covers))\n"
            if let notes = b.notes, !notes.isEmpty { text += "    Notes: \(notes)\n" }
            if b.prepTasks.isEmpty {
                text += "    Prep List: (none yet)\n"
            } else {
                text += "    Prep List:\n"
                for pt in b.prepTasks {
                    text += "      [\(pt.done ? "DONE" : "PENDING")] \(pt.task)\n"
                }
            }
        }
        return Section(text: text, source: AssistantContextSource(type: "beo_events", detail: "\(beos.count) upcoming party(s)"))
    }

    public struct StaleBeoPrepRow: Sendable, Equatable {
        public let task: String
        public let title: String
        public let eventDate: String
        public let eventId: Int64

        public init(task: String, title: String, eventDate: String, eventId: Int64) {
            self.task = task
            self.title = title
            self.eventDate = eventDate
            self.eventId = eventId
        }
    }

    public static func renderStaleBeoPrep(_ rows: [StaleBeoPrepRow]) -> Section {
        if rows.isEmpty { return .empty }
        var text = "\nSTALE BEO PREP (events within \(staleBeoWindowDays) day(s), still PENDING):\n"
        for r in rows {
            text += "  - [\(r.eventDate)] \(r.title) (BEO \(r.eventId)): \(r.task)\n"
        }
        return Section(text: text, source: AssistantContextSource(type: "beo_prep_stale", detail: "\(rows.count) pending task(s)"))
    }

    public struct OrderGuideRow: Sendable, Equatable {
        public let ingredient: String
        public let baseQty: Double?
        public let unit: String?

        public init(ingredient: String, baseQty: Double?, unit: String?) {
            self.ingredient = ingredient
            self.baseQty = baseQty
            self.unit = unit
        }
    }

    public static func renderOrderGuide(_ rows: [OrderGuideRow]) -> Section {
        if rows.isEmpty { return .empty }
        var text = "\nORDER GUIDE (Items required for upcoming sysco drops):\n"
        for og in rows {
            let qty = og.baseQty.map(JsValueFormat.numberString) ?? "null"
            text += "  - \(og.ingredient) (Target: \(qty) \(og.unit ?? "null"))\n"
        }
        return Section(text: text, source: AssistantContextSource(type: "order_guide", detail: "\(rows.count) item(s)"))
    }

    public struct BeoPrepHistoryEventRow: Sendable, Equatable {
        public let client: String?
        public let eventDate: String
        public let items: String

        public init(client: String?, eventDate: String, items: String) {
            self.client = client
            self.eventDate = eventDate
            self.items = items
        }
    }

    public struct BeoPrepHistoryItemRow: Sendable, Equatable {
        public let item: String
        public let client: String?
        public let eventDate: String?
        public let amountQty: String?
        public let prePrepNotes: String?
        public let platingNotes: String?
        public let prepDay: String?

        public init(item: String, client: String?, eventDate: String?, amountQty: String?, prePrepNotes: String?, platingNotes: String?, prepDay: String?) {
            self.item = item
            self.client = client
            self.eventDate = eventDate
            self.amountQty = amountQty
            self.prePrepNotes = prePrepNotes
            self.platingNotes = platingNotes
            self.prepDay = prepDay
        }
    }

    public static func renderBeoPrepHistory(
        recentEvents: [BeoPrepHistoryEventRow],
        itemDetail: [BeoPrepHistoryItemRow],
        matchedItemCount: Int
    ) -> MultiSection {
        var text = ""
        var sources: [AssistantContextSource] = []

        if !recentEvents.isEmpty {
            text += "\nRECENT BEO EVENTS (prep history, most recent first):\n"
            for ev in recentEvents {
                let who = firstNonEmpty(ev.client) ?? "unknown client"
                text += "  - \(ev.eventDate) \(who): \(ev.items)\n"
            }
            sources.append(AssistantContextSource(type: "beo_prep_history_recent", detail: "\(recentEvents.count) event(s)"))
        }

        if !itemDetail.isEmpty {
            text += "\nMATCHED ITEM PREP HISTORY:\n"
            for d in itemDetail {
                var parts = [
                    d.eventDate ?? "?",
                    firstNonEmpty(d.client) ?? "unknown",
                    "\(d.item) × \(d.amountQty ?? "?")",
                ]
                if let prep = d.prepDay, !prep.isEmpty { parts.append("prep:\(prep)") }
                if let pre = d.prePrepNotes, !pre.isEmpty { parts.append("pre:\(pre)") }
                if let plating = d.platingNotes, !plating.isEmpty { parts.append("plating:\(plating)") }
                text += "  - \(parts.joined(separator: " | "))\n"
            }
            sources.append(AssistantContextSource(
                type: "beo_prep_history_item",
                detail: "\(itemDetail.count) hit(s) for \(matchedItemCount) item(s)"
            ))
        }

        return MultiSection(text: text, sources: sources)
    }

    // ── Recipe selection + block ────────────────────────────────────

    public static func resolveMenuItemsToRecipes(
        qLower: String,
        menu: [AssistantMenuItem],
        recipes: [AssistantRecipe]
    ) -> Set<String> {
        var matchedSlugs = Set<String>()

        var mentionedMenuItems: [String] = []
        for mi in menu {
            let name = (mi.displayName ?? "").lowercased()
            if name.count > 2 && qLower.contains(name) {
                mentionedMenuItems.append(mi.displayName ?? "")
            }
        }

        for r in recipes {
            for mi in r.menuItems ?? [] {
                let miLower = mi.lowercased()
                if miLower.count > 2 && qLower.contains(miLower), let slug = r.slug {
                    matchedSlugs.insert(slug)
                }
            }
        }

        for miName in mentionedMenuItems {
            for r in recipes {
                for rmi in r.menuItems ?? [] where rmi.lowercased() == miName.lowercased() {
                    if let slug = r.slug { matchedSlugs.insert(slug) }
                }
            }
        }

        return matchedSlugs
    }

    public static func pickRelevantRecipes(
        question: String,
        recipes: [AssistantRecipe],
        max maxCount: Int,
        menuMatchedSlugs: Set<String>
    ) -> [AssistantRecipe] {
        let q = question.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        if q.isEmpty || recipes.isEmpty { return [] }

        var seen = Set<String>()
        let words = q.split(whereSeparator: { !$0.isLetter && !$0.isNumber })
            .map(String.init)
            .filter { $0.count > 2 && seen.insert($0).inserted }

        let scored: [(recipe: AssistantRecipe, score: Double, index: Int)] = recipes.enumerated().map { index, r in
            var score = 0.0

            if let slug = r.slug, menuMatchedSlugs.contains(slug) { score += 15 }

            let name = (r.name ?? "").lowercased()
            if !name.isEmpty && q.contains(name) { score += 12 }
            for w in words where name.contains(w) { score += 4 }

            for mi in r.menuItems ?? [] {
                let miLower = mi.lowercased()
                if !miLower.isEmpty && q.contains(miLower) { score += 10 }
                for w in words where miLower.contains(w) { score += 3 }
            }

            let station = (r.station ?? "").lowercased()
            for w in words where station.contains(w) { score += 2 }

            for i in r.ingredients ?? [] {
                let it = (i.item ?? "").lowercased()
                for w in words where it.contains(w) { score += 2 }
            }

            for a in r.allergens ?? [] where q.contains(a.lowercased()) { score += 5 }

            return (r, score, index)
        }

        let top = scored
            .filter { $0.score > 0 }
            .sorted { a, b in
                if a.score != b.score { return a.score > b.score }
                return a.index < b.index  // stable like JS sort
            }
            .prefix(maxCount)
            .map(\.recipe)

        if !top.isEmpty { return Array(top) }

        return Array(recipes.filter { nameMatches($0.name ?? "", q) }.prefix(maxCount))
    }

    static func nameMatches(_ name: String, _ q: String) -> Bool {
        if name.isEmpty { return false }
        let n = name.lowercased()
        var len = min(24, q.count)
        while len >= 4 {
            let sub = String(q.prefix(len))
            if sub.count >= 4 && n.contains(sub) { return true }
            len -= 1
        }
        return false
    }

    public static func collectSubRecipes(picked: [AssistantRecipe], recipes: [AssistantRecipe]) -> [AssistantRecipe] {
        var subRecipeSlugs: [String] = []
        var seen = Set<String>()
        for r in picked {
            for slug in r.subRecipes ?? [] {
                if !picked.contains(where: { $0.slug == slug }) && seen.insert(slug).inserted {
                    subRecipeSlugs.append(slug)
                }
            }
        }
        var out: [AssistantRecipe] = []
        for slug in subRecipeSlugs {
            if let found = recipes.first(where: { $0.slug == slug }) { out.append(found) }
        }
        return out
    }

    public static func formatRecipeSnippet(
        _ r: AssistantRecipe,
        allergenMatrix: AssistantAllergenMatrix,
        isSub: Bool
    ) -> String {
        let type = isSub ? "SUB-RECIPE" : "RECIPE"
        let allergens = (r.allergens ?? []).joined(separator: ", ")
        let allergenText = allergens.isEmpty ? "none tagged" : allergens
        let ing = (r.ingredients ?? [])
            .map { i -> String in
                let qty = i.qty.map { " \($0.display)" } ?? " "
                // web: `${item || ''} ${qty != null ? qty : ''} ${unit || ''}`.trim()
                return "\(i.item ?? "")\(qty.trimmingCharacters(in: .whitespaces).isEmpty ? "" : qty) \(i.unit ?? "")"
                    .trimmingCharacters(in: .whitespaces)
            }
            .joined(separator: "; ")
        let ingShort = ing.count > maxIngChars ? "\(String(ing.prefix(maxIngChars)))..." : ing

        var out = "<\(type) name=\"\(r.name ?? "")\" slug=\"\(r.slug ?? "no-slug")\">\n"
        if let station = r.station, !station.isEmpty { out += "  STATION: \(station)\n" }
        if let yieldQty = r.yieldQty {
            out += "  YIELD: \(yieldQty.display) \(r.yieldUnit ?? "")\n"
        }
        if let menuItems = r.menuItems, !menuItems.isEmpty {
            out += "  MENU ITEMS: \(menuItems.joined(separator: ", "))\n"
        }
        if let subRecipes = r.subRecipes, !subRecipes.isEmpty {
            out += "  SUB-RECIPES: \(subRecipes.joined(separator: ", "))\n"
        }
        out += "  ALLERGENS (TAGS): \(allergenText)\n"
        out += "  INGREDIENTS: \(ingShort)\n"

        let matrixEntries = r.slug.flatMap { allergenMatrix[$0] } ?? []
        let flagged = matrixEntries.filter { !($0.big9 ?? []).isEmpty }
        if !flagged.isEmpty {
            out += "  ALLERGEN DETAIL (INGREDIENT-LEVEL):\n"
            for entry in flagged {
                out += "    \(entry.ingredient) -> \((entry.big9 ?? []).joined(separator: ", "))\n"
            }
        }

        out += "</\(type)>\n\n"
        return out
    }

    public static func renderRecipeBlock(
        picked: [AssistantRecipe],
        subRecipes: [AssistantRecipe],
        allergenMatrix: AssistantAllergenMatrix
    ) -> String {
        var text = "\nRECIPES (Isolated in XML tags - do not cross-reference ingredients between tags):\n"
        if picked.isEmpty {
            text += "  (no recipe matched — do not invent recipe or allergen facts)\n"
            return text
        }
        for r in picked { text += formatRecipeSnippet(r, allergenMatrix: allergenMatrix, isSub: false) }
        if !subRecipes.isEmpty {
            text += "  SUB-RECIPES (referenced by above):\n"
            for r in subRecipes { text += formatRecipeSnippet(r, allergenMatrix: allergenMatrix, isSub: true) }
        }
        return text
    }

    // ── HACCP / vendor / labor cache renderers ──────────────────────

    public static func renderHaccpCcps(_ safety: AssistantFoodSafetyData) -> Section {
        let ccps = safety.ccps ?? []
        if ccps.isEmpty { return .empty }
        var text = "\nHACCP CRITICAL CONTROL POINTS:\n"
        for c in ccps {
            text += "  - [\(c.ccpId ?? "")] \(c.criticalControlPoint ?? "")\n"
            text += "    hazard: \(c.hazard ?? "") | limit: \(c.criticalLimit ?? "")\n"
            text += "    monitor: \(c.monitoringProcedure ?? "")\n"
            text += "    corrective: \(c.correctiveAction ?? "")\n"
        }
        return Section(text: text, source: AssistantContextSource(type: "food_safety", detail: "\(ccps.count) CCP(s)"))
    }

    public static func renderVendorSummaryBlock(_ vendor: AssistantVendorSummary?) -> Section {
        guard let items = vendor?.sysco?.recentItems, !items.isEmpty else { return .empty }
        let shown = Array(items.prefix(15))
        var text = "\nSYSCO RECENT ITEMS (top 15):\n"
        for v in shown {
            var parts: [String] = []
            if let d = v.description, !d.isEmpty { parts.append(d) }
            if let c = v.category, !c.isEmpty { parts.append(c) }
            if let p = v.packSize, !p.isEmpty { parts.append(p) }
            if let price = v.price { parts.append("$\(JsValueFormat.numberString(price))") }
            text += "  - \(parts.joined(separator: " | "))\n"
        }
        if let last = vendor?.sysco?.lastInvoiceDate, !last.isEmpty {
            text += "  last invoice: \(last)\n"
        }
        return Section(text: text, source: AssistantContextSource(type: "vendor_summary", detail: "\(shown.count) Sysco item(s)"))
    }

    public static func renderLaborSummaryBlock(_ labor: AssistantLaborSummary?) -> Section {
        guard let labor else { return .empty }
        var text = "\nLABOR SUMMARY (from 7shifts export):\n"
        text += "  period: \(firstNonEmpty(labor.period) ?? "n/a")\n"
        text += "  net sales: $\(jsLocaleString(labor.netSales ?? 0))\n"
        text += "  labor cost: $\(jsLocaleString(labor.laborCost ?? 0)) (\(toFixed((labor.laborPctNet ?? 0) * 100, 1))% of net)\n"
        if let splh = labor.splhNet, splh != 0 { text += "  SPLH (net): $\(JsValueFormat.numberString(splh))\n" }
        if let roles = labor.byRole, !roles.isEmpty {
            text += "  by role:\n"
            for r in roles {
                let otHrs = r.otHours ?? 0
                let ot = otHrs > 0 ? " (\(toFixed(otHrs, 0)) OT)" : ""
                let title = firstNonEmpty(r.jobTitle, r.role) ?? ""
                text += "    - \(title): \(toFixed(r.totalHours ?? 0, 0)) hrs\(ot), $\(jsLocaleString(r.totalCost ?? 0)) (\(toFixed((r.laborPctNet ?? 0) * 100, 1))% net)\n"
            }
        }
        if let employees = labor.byEmployee, !employees.isEmpty {
            text += "  by employee (top 10 by hours):\n"
            let sorted = employees.enumerated()
                .sorted { a, b in
                    let ha = a.element.totalHours ?? 0
                    let hb = b.element.totalHours ?? 0
                    if ha != hb { return ha > hb }
                    return a.offset < b.offset
                }
                .prefix(10)
            for (_, e) in sorted {
                let eOtHrs = e.otHours ?? 0
                let ot = eOtHrs > 0 ? " (\(toFixed(eOtHrs, 0)) OT)" : ""
                text += "    - \(e.firstName ?? "") \(e.lastName ?? "") (\(e.jobTitle ?? "")): \(toFixed(e.totalHours ?? 0, 0)) hrs\(ot), $\(jsLocaleString(e.totalCost ?? 0))\n"
            }
        }
        return Section(text: text, source: AssistantContextSource(type: "labor_summary", detail: firstNonEmpty(labor.period) ?? "loaded"))
    }

    // ── Daily sales trend ───────────────────────────────────────────

    public struct DailySalesTrendRow: Sendable, Equatable {
        public let shiftDate: String
        public let netSales: Double?
        public let orders: Double?
        public let guests: Double?
        public let yoyNetSales: Double?
        public let yoyOrders: Double?
        public let yoyGuests: Double?

        public init(shiftDate: String, netSales: Double?, orders: Double?, guests: Double?, yoyNetSales: Double?, yoyOrders: Double?, yoyGuests: Double?) {
            self.shiftDate = shiftDate
            self.netSales = netSales
            self.orders = orders
            self.guests = guests
            self.yoyNetSales = yoyNetSales
            self.yoyOrders = yoyOrders
            self.yoyGuests = yoyGuests
        }
    }

    public static func renderDailySalesTrend(_ rows: [DailySalesTrendRow]) -> Section {
        if rows.isEmpty { return .empty }
        var text = "\nDAILY SALES TREND (last \(dailySalesTrendWindowDays) days, Toast):\n"
        var yoyMatches = 0
        for r in rows {
            let base = "\(fmtUsd(r.netSales)) / \(fmtInt(r.orders)) orders / \(fmtInt(r.guests)) guests"
            var yoy = ""
            if r.yoyNetSales != nil || r.yoyOrders != nil || r.yoyGuests != nil {
                yoyMatches += 1
                let yoyBase = "\(fmtUsd(r.yoyNetSales)) / \(fmtInt(r.yoyOrders)) / \(fmtInt(r.yoyGuests))"
                var deltaPct = ""
                if let net = r.netSales, let yoyNet = r.yoyNetSales, yoyNet != 0 {
                    let pct = ((net - yoyNet) / yoyNet) * 100
                    let sign = pct >= 0 ? "+" : ""
                    deltaPct = ", \(sign)\(toFixed(pct, 1))% YoY"
                }
                yoy = " (YoY: \(yoyBase)\(deltaPct))"
            }
            text += "  - \(r.shiftDate): \(base)\(yoy)\n"
        }
        let detail = yoyMatches > 0
            ? "\(rows.count) day(s), \(yoyMatches) with YoY"
            : "\(rows.count) day(s)"
        return Section(text: text, source: AssistantContextSource(type: "daily_sales_trend", detail: detail))
    }

    public static func fmtUsd(_ n: Double?) -> String {
        guard let n, !n.isNaN else { return "—" }
        return "$" + jsLocaleString(n, minFractionDigits: 2, maxFractionDigits: 2)
    }

    public static func fmtInt(_ n: Double?) -> String {
        guard let n, !n.isNaN else { return "—" }
        return jsLocaleString(n.rounded(), minFractionDigits: 0, maxFractionDigits: 0)
    }

    // ── FDA Food Code + USDA ingredients (datapack, lexical) ────────

    public struct FdaFoodCodeHit: Sendable, Equatable {
        public let sectionId: String
        public let title: String
        public let whereLabel: String
        public let body: String

        public init(sectionId: String, title: String, whereLabel: String, body: String) {
            self.sectionId = sectionId
            self.title = title
            self.whereLabel = whereLabel
            self.body = body
        }
    }

    /// `truncateSafe(s, n)` — avoid splitting a surrogate pair at the tail.
    public static func truncateSafe(_ s: String, _ n: Int) -> String {
        let units = Array(s.utf16)
        if units.count <= n { return s }
        var end = n
        let code = units[end - 1]
        if code >= 0xD800 && code <= 0xDBFF { end -= 1 }
        return String(decoding: units[0..<end], as: UTF16.self) + "…"
    }

    /// Dedupe by section_id (first wins) then cap at MAX_FDA_HITS — the
    /// repository feeds hits pre-sorted by rank.
    public static func dedupeFdaHits(_ hits: [FdaFoodCodeHit]) -> [FdaFoodCodeHit] {
        var seen = Set<String>()
        var unique: [FdaFoodCodeHit] = []
        for h in hits {
            if !h.sectionId.isEmpty {
                if seen.contains(h.sectionId) { continue }
                seen.insert(h.sectionId)
            }
            unique.append(h)
            if unique.count >= maxFdaHits { break }
        }
        return unique
    }

    public static func renderFdaFoodCode(_ hits: [FdaFoodCodeHit]) -> Section {
        let unique = dedupeFdaHits(hits)
        if unique.isEmpty { return .empty }
        var text = "\nFDA FOOD CODE (regulatory text — cite § when answering):\n"
        for h in unique {
            let sectionId = h.sectionId.isEmpty ? "(no §)" : h.sectionId
            let title = h.title.isEmpty ? "(untitled)" : h.title
            text += "  - [§ \(sectionId)] \(title)\(h.whereLabel.isEmpty ? "" : " (\(h.whereLabel))")\n"
            if !h.body.isEmpty {
                let body = truncateSafe(h.body, maxFdaBodyChars)
                text += "    \(body.replacingOccurrences(of: "\n", with: "\n    "))\n"
            }
        }
        return Section(text: text, source: AssistantContextSource(type: "fda_food_code", detail: "\(unique.count) section(s)"))
    }

    /// Duplicated on the web at app/kitchen-assistant/citationHelpers.js — the
    /// guard test (test-kitchen-assistant-citations.mjs) pins these three.
    public static let usdaNutrientPriority = [
        "Energy",
        "Protein",
        "Carbohydrate",
        "Total lipid (fat)",
        "Sodium, Na",
        "Sugars, total",
    ]

    public static let usdaPriorityDisplay: [String: String] = [
        "Total lipid (fat)": "Fat",
        "Sodium, Na": "Sodium",
        "Sugars, total": "Sugars",
    ]

    /// `formatUnit(unitName)` parity.
    public static func formatUnit(_ unitName: String?) -> String {
        guard let unitName, !unitName.isEmpty else { return "" }
        switch unitName {
        case "KCAL": return "kcal"
        case "G": return "g"
        case "MG": return "mg"
        case "UG": return "µg"
        case "IU": return "IU"
        case "kJ": return "kJ"
        case "MG_ATE": return "mg α-TE"
        case "SP_GR": return "sp.gr."
        default: return unitName
        }
    }

    public struct UsdaNutrientInput: Sendable, Equatable {
        public let nutrientName: String?
        public let amount: Double?
        public let unitName: String?

        public init(nutrientName: String?, amount: Double?, unitName: String?) {
            self.nutrientName = nutrientName
            self.amount = amount
            self.unitName = unitName
        }
    }

    /// `formatPriorityNutrients(nutrients)` parity.
    public static func formatPriorityNutrients(_ nutrients: [UsdaNutrientInput]) -> String {
        if nutrients.isEmpty { return "" }
        var parts: [String] = []
        for wanted in usdaNutrientPriority {
            guard let found = nutrients.first(where: {
                ($0.nutrientName ?? "").lowercased().hasPrefix(wanted.lowercased())
            }) else { continue }
            guard let amount = found.amount else { continue }
            let displayName = usdaPriorityDisplay[wanted] ?? wanted
            let unitText = formatUnit(found.unitName)
            let unit = unitText.isEmpty ? "" : " \(unitText)"
            parts.append("\(displayName) \(JsValueFormat.numberString(amount))\(unit)")
        }
        return parts.joined(separator: " · ")
    }

    public struct UsdaIngredientHit: Sendable, Equatable {
        public let fdcId: Int64
        public let description: String
        public let category: String
        public let meta: String
        public let nutrients: [UsdaNutrientInput]

        public init(fdcId: Int64, description: String, category: String, meta: String, nutrients: [UsdaNutrientInput]) {
            self.fdcId = fdcId
            self.description = description
            self.category = category
            self.meta = meta
            self.nutrients = nutrients
        }
    }

    public static func renderUsdaIngredients(_ hits: [UsdaIngredientHit]) -> Section {
        // Dedupe by fdc_id, preserving rank order; cap at MAX_USDA_HITS.
        var seen = Set<Int64>()
        var unique: [UsdaIngredientHit] = []
        for h in hits {
            if seen.contains(h.fdcId) { continue }
            seen.insert(h.fdcId)
            unique.append(h)
            if unique.count >= maxUsdaHits { break }
        }
        if unique.isEmpty { return .empty }

        var text = "\nUSDA INGREDIENTS (per-100g unless noted; cite fdc_id when answering):\n"
        var rendered = 0
        for h in unique {
            let description = h.description.isEmpty ? "(no description)" : h.description
            let paren = [h.category, h.meta].filter { !$0.isEmpty }.joined(separator: " · ")
            text += "  - [fdc_id \(h.fdcId)] \(description)\(paren.isEmpty ? "" : " (\(paren))")\n"
            let nutrientLine = formatPriorityNutrients(h.nutrients)
            if !nutrientLine.isEmpty {
                text += "    \(truncateSafe(nutrientLine, maxUsdaBodyChars))\n"
            }
            rendered += 1
        }
        if rendered == 0 { return .empty }
        return Section(text: text, source: AssistantContextSource(type: "usda_ingredients", detail: "\(rendered) food(s)"))
    }

    // ── JS number formatting helpers ────────────────────────────────

    /// `n.toLocaleString()` / `toLocaleString('en-US', {...})` parity.
    public static func jsLocaleString(
        _ n: Double,
        minFractionDigits: Int = 0,
        maxFractionDigits: Int = 3
    ) -> String {
        let fmt = NumberFormatter()
        fmt.locale = Locale(identifier: "en_US")
        fmt.numberStyle = .decimal
        fmt.minimumFractionDigits = minFractionDigits
        fmt.maximumFractionDigits = maxFractionDigits
        fmt.usesGroupingSeparator = true
        return fmt.string(from: NSNumber(value: n)) ?? JsValueFormat.numberString(n)
    }

    /// `n.toFixed(digits)` parity.
    public static func toFixed(_ n: Double, _ digits: Int) -> String {
        String(format: "%.\(digits)f", n)
    }
}
