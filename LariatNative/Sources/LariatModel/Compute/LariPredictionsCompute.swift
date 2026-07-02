import Foundation

/// Pure port of `lib/lariPredictions.ts` — the LaRi ambient-strip rule module.
/// Deterministic V5/V6 stubs; the contract (`LariPrediction`) is what any
/// future ML upgrade plugs into.

public enum LariSeverity: String, Sendable, Codable, CaseIterable {
    case ok
    case warn
    case alert

    /// `SEVERITY_RANK`
    var rank: Int {
        switch self {
        case .alert: return 0
        case .warn: return 1
        case .ok: return 2
        }
    }
}

public struct LariPrediction: Sendable, Equatable, Codable {
    public let id: String
    public let surface: String
    public let severity: LariSeverity
    public let text: String
    public var action: String?
    public var source: String?
    public var forRole: String?

    enum CodingKeys: String, CodingKey {
        case id, surface, severity, text, action, source
        case forRole = "for_role"
    }

    public init(
        id: String, surface: String, severity: LariSeverity, text: String,
        action: String? = nil, source: String? = nil, forRole: String? = nil
    ) {
        self.id = id
        self.surface = surface
        self.severity = severity
        self.text = text
        self.action = action
        self.source = source
        self.forRole = forRole
    }
}

public enum LariPredictionsCompute {
    static let maxTextLength = 240
    static let maxActionLength = 80

    /// `isValidSeverity(s)` — case-sensitive, strings only.
    public static func isValidSeverity(_ s: AssistantJSONValue?) -> Bool {
        guard case .string(let v)? = s else { return false }
        return LariSeverity(rawValue: v) != nil
    }

    /// `normalizePrediction(raw)` — nil for anything half-formed.
    public static func normalizePrediction(_ raw: AssistantJSONValue?) -> LariPrediction? {
        guard case .object(let r)? = raw else { return nil }

        func trimmedString(_ key: String) -> String? {
            guard case .string(let s)? = r[key] else { return nil }
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? nil : t
        }

        guard let id = trimmedString("id") else { return nil }
        guard let surface = trimmedString("surface") else { return nil }
        guard case .string(let sevRaw)? = r["severity"], let severity = LariSeverity(rawValue: sevRaw) else { return nil }
        guard case .string(let textRaw)? = r["text"] else { return nil }
        let text = textRaw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }

        var out = LariPrediction(
            id: id, surface: surface, severity: severity,
            text: String(text.prefix(maxTextLength))
        )
        if let action = trimmedString("action") {
            out.action = String(action.prefix(maxActionLength))
        }
        if let source = trimmedString("source") { out.source = source }
        if let forRole = trimmedString("for_role") { out.forRole = forRole }
        return out
    }

    /// `sortBySeverity(list)` — alert → warn → ok, longer text first inside a
    /// tier; stable (JS Array.sort is stable; Swift's sort is not, so index
    /// tie-breaks force stability).
    public static func sortBySeverity(_ list: [LariPrediction]) -> [LariPrediction] {
        list.enumerated().sorted { a, b in
            let sa = a.element.severity.rank
            let sb = b.element.severity.rank
            if sa != sb { return sa < sb }
            if a.element.text.count != b.element.text.count {
                return a.element.text.count > b.element.text.count
            }
            return a.offset < b.offset
        }.map(\.element)
    }

    /// `trimPredictions(list, n = 5)`
    public static func trimPredictions(_ list: [LariPrediction], _ n: Int = 5) -> [LariPrediction] {
        Array(sortBySeverity(list).prefix(max(0, n)))
    }

    /// `daysUntil(start, end)` — calendar-day distance; -1 on unparseable input.
    public static func daysUntil(_ start: String, _ end: String) -> Int {
        guard let a = parseIsoDateMs(start), let b = parseIsoDateMs(end) else { return -1 }
        return Int(((b - a) / 86_400_000).rounded())
    }

    private static func parseIsoDateMs(_ iso: String) -> Double? {
        guard iso.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil else { return nil }
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.timeZone = TimeZone(identifier: "UTC")
        fmt.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        guard let d = fmt.date(from: "\(iso)T12:00:00") else { return nil }
        return d.timeIntervalSince1970 * 1000
    }

    // ── BEO builder ──────────────────────────────────────────────────

    public struct BeoEventRow: Sendable, Equatable {
        public let id: Int64
        public let title: String
        public let eventDate: String?
        public let eventTime: String?
        public let contactName: String?
        public let guestCount: Int?
        public let notes: String?

        public init(
            id: Int64, title: String, eventDate: String?, eventTime: String?,
            contactName: String?, guestCount: Int?, notes: String?
        ) {
            self.id = id
            self.title = title
            self.eventDate = eventDate
            self.eventTime = eventTime
            self.contactName = contactName
            self.guestCount = guestCount
            self.notes = notes
        }
    }

    public struct BeoLineItemRow: Sendable, Equatable {
        public let id: Int64
        public let eventId: Int64
        public let itemName: String
        public let quantity: Double?

        public init(id: Int64, eventId: Int64, itemName: String, quantity: Double?) {
            self.id = id
            self.eventId = eventId
            self.itemName = itemName
            self.quantity = quantity
        }
    }

    public struct BeoPrepTaskRow: Sendable, Equatable {
        public let id: Int64
        public let eventId: Int64
        public let task: String
        public let dueDate: String?
        public let done: Int

        public init(id: Int64, eventId: Int64, task: String, dueDate: String?, done: Int) {
            self.id = id
            self.eventId = eventId
            self.task = task
            self.dueDate = dueDate
            self.done = done
        }
    }

    /// `buildBeoPredictions(inputs)` parity.
    public static func buildBeoPredictions(
        events: [BeoEventRow],
        lineItems: [BeoLineItemRow],
        prepTasks: [BeoPrepTaskRow],
        today: String
    ) -> [LariPrediction] {
        if events.isEmpty { return [] }

        let todayEvents = events.filter { $0.eventDate == today }
        let upcomingEvents = events.filter { e in
            guard let d = e.eventDate, d > today else { return false }
            return daysUntil(today, d) <= 7
        }

        var lineCounts: [Int64: Int] = [:]
        for l in lineItems {
            lineCounts[l.eventId, default: 0] += 1
        }

        var out: [LariPrediction] = []

        // alert: event tonight missing contact_name
        for e in todayEvents {
            let contact = (e.contactName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if contact.isEmpty {
                out.append(LariPrediction(
                    id: "beo-missing-contact-\(e.id)",
                    surface: "beo",
                    severity: .alert,
                    text: "Tonight: \"\(e.title)\" has no host contact saved — confirm before service.",
                    action: "open BEO",
                    source: "beo_events:\(e.id)"
                ))
            }
        }

        // alert: overdue prep_task
        for t in prepTasks {
            if t.done != 0 { continue }
            guard let due = t.dueDate else { continue }
            if due < today {
                let event = events.first { $0.id == t.eventId }
                let eventLabel = event.map { "\"\($0.title)\"" } ?? "event #\(t.eventId)"
                out.append(LariPrediction(
                    id: "beo-overdue-task-\(t.id)",
                    surface: "beo",
                    severity: .alert,
                    text: "Overdue prep for \(eventLabel): \"\(t.task)\" was due \(due).",
                    action: "mark done",
                    source: "beo_prep_tasks:\(t.id)"
                ))
            }
        }

        // warn: today's event with <3 line items + >20 guests
        for e in todayEvents {
            let count = lineCounts[e.id] ?? 0
            let guests = e.guestCount ?? 0
            if count < 3 && guests > 20 {
                out.append(LariPrediction(
                    id: "beo-thin-menu-\(e.id)",
                    surface: "beo",
                    severity: .warn,
                    text: "Tonight: \"\(e.title)\" has only \(count) line item\(count == 1 ? "" : "s") for \(guests) guests.",
                    action: "review menu",
                    source: "beo_events:\(e.id)"
                ))
            }
        }

        // warn: upcoming event with no line items at all
        for e in upcomingEvents {
            let count = lineCounts[e.id] ?? 0
            if count == 0, let d = e.eventDate {
                let days = daysUntil(today, d)
                out.append(LariPrediction(
                    id: "beo-empty-menu-\(e.id)",
                    surface: "beo",
                    severity: .warn,
                    text: "\(d): \"\(e.title)\" has no menu yet — \(days) day\(days == 1 ? "" : "s") out.",
                    action: "open BEO",
                    source: "beo_events:\(e.id)"
                ))
            }
        }

        // ok: rollup of upcoming count
        if !upcomingEvents.isEmpty {
            out.append(LariPrediction(
                id: "beo-upcoming-rollup-\(today)",
                surface: "beo",
                severity: .ok,
                text: "\(upcomingEvents.count) BEO\(upcomingEvents.count == 1 ? "" : "s") in the next 7 days.",
                source: "beo_events:rollup"
            ))
        }

        return trimPredictions(out)
    }

    // ── Sound builder ────────────────────────────────────────────────

    public struct SoundSceneInput: Sendable, Equatable {
        public let id: Int64
        public let sceneName: String
        public let splLimitDb: Double?
        public let plotChannelCount: Int?
        public let savedAt: String

        /// `plotChannelCount`: nil ⇒ web `plot` null / no channels array.
        public init(id: Int64, sceneName: String, splLimitDb: Double?, plotChannelCount: Int?, savedAt: String) {
            self.id = id
            self.sceneName = sceneName
            self.splLimitDb = splLimitDb
            self.plotChannelCount = plotChannelCount
            self.savedAt = savedAt
        }
    }

    public struct SplSummaryInput: Sendable, Equatable {
        public let count: Int
        public let latest: Double?
        public let peak: Double?
        public let overLimitCount: Int
        public let limitDb: Double?

        public init(count: Int, latest: Double?, peak: Double?, overLimitCount: Int, limitDb: Double?) {
            self.count = count
            self.latest = latest
            self.peak = peak
            self.overLimitCount = overLimitCount
            self.limitDb = limitDb
        }
    }

    /// `buildSoundPredictions(inputs)` parity.
    public static func buildSoundPredictions(
        showId: Int64,
        bandName: String?,
        scenes: [SoundSceneInput]?,
        splSummary: SplSummaryInput?,
        today: String
    ) -> [LariPrediction] {
        guard let scenes else { return [] }

        var out: [LariPrediction] = []
        let showLabel = bandName.map { "\"\($0)\"" } ?? "show #\(showId)"

        // alert · over-limit readings
        if let s = splSummary, s.overLimitCount > 0, let limit = s.limitDb {
            out.append(LariPrediction(
                id: "sound-over-limit-\(showId)",
                surface: "sound",
                severity: .alert,
                text: "SPL exceeded \(JsValueFormat.numberString(limit)) dB on \(s.overLimitCount) reading\(s.overLimitCount == 1 ? "" : "s") — pull the mains.",
                action: "open SPL log",
                source: "spl_readings:\(showId)"
            ))
        }

        // alert · running blind (peak hot, no scene saved)
        let peakHot = splSummary.flatMap(\.peak).map { $0 >= 100 } ?? false
        if let s = splSummary, let peak = s.peak, peak >= 100, scenes.isEmpty {
            out.append(LariPrediction(
                id: "sound-running-blind-\(showId)",
                surface: "sound",
                severity: .alert,
                text: "Peak \(JsValueFormat.numberString(peak)) dB tonight and no scene saved for \(showLabel).",
                action: "save scene",
                source: "sound_scenes:\(showId)"
            ))
        }

        // warn · no scene saved at all
        if scenes.isEmpty && !peakHot {
            out.append(LariPrediction(
                id: "sound-no-scene-\(showId)",
                surface: "sound",
                severity: .warn,
                text: "No sound scene saved yet for \(showLabel).",
                action: "save scene",
                source: "sound_scenes:\(showId)"
            ))
        }

        // warn · scene saved but spl_limit_db is null
        if !scenes.isEmpty && !scenes.contains(where: { $0.splLimitDb != nil }) {
            out.append(LariPrediction(
                id: "sound-no-limit-\(showId)",
                surface: "sound",
                severity: .warn,
                text: "Scene saved but no SPL ceiling set — \(showLabel) is running uncapped.",
                action: "set limit",
                source: "sound_scenes:\(showId)"
            ))
        }

        // warn · plot empty (no channels on most-recent scene)
        if let latest = scenes.first {
            let channels = latest.plotChannelCount ?? 0
            if channels == 0 {
                out.append(LariPrediction(
                    id: "sound-empty-plot-\(showId)",
                    surface: "sound",
                    severity: .warn,
                    text: "Stage plot for \"\(latest.sceneName)\" has no channels listed.",
                    action: "open plot",
                    source: "sound_scenes:\(latest.id)"
                ))
            }
        }

        // ok · in-band rollup
        if let s = splSummary, s.count > 0, s.overLimitCount == 0, let peak = s.peak {
            out.append(LariPrediction(
                id: "sound-rollup-\(showId)",
                surface: "sound",
                severity: .ok,
                text: "\(s.count) reading\(s.count == 1 ? "" : "s") tonight · peak \(JsValueFormat.numberString(peak)) dB · in band.",
                source: "spl_readings:\(showId):rollup"
            ))
        }

        return trimPredictions(out)
    }

    // ── Host builder ─────────────────────────────────────────────────

    public struct HostWaitlistSummaryInput: Sendable, Equatable {
        public let total: Int
        public let waiting: Int
        public let seatedToday: Int
        public let leftToday: Int
        public let avgWaitMinutes: Double?
        public let longestWaitMinutes: Double?
        public let longestWaitPartyId: Int64?

        public init(
            total: Int, waiting: Int, seatedToday: Int, leftToday: Int,
            avgWaitMinutes: Double?, longestWaitMinutes: Double?, longestWaitPartyId: Int64?
        ) {
            self.total = total
            self.waiting = waiting
            self.seatedToday = seatedToday
            self.leftToday = leftToday
            self.avgWaitMinutes = avgWaitMinutes
            self.longestWaitMinutes = longestWaitMinutes
            self.longestWaitPartyId = longestWaitPartyId
        }
    }

    static let waitLongMinutes: Double = 45
    static let waitBusyThreshold = 5
    static let waitOverflowThreshold = 8
    static let avgWaitWarnMinutes: Double = 30

    /// `buildHostPredictions(inputs)` parity.
    public static func buildHostPredictions(
        summary: HostWaitlistSummaryInput?,
        today: String
    ) -> [LariPrediction] {
        guard let summary else { return [] }

        var out: [LariPrediction] = []

        // alert · longest waiter is past the threshold
        if let longest = summary.longestWaitMinutes,
           longest > waitLongMinutes,
           let partyId = summary.longestWaitPartyId {
            out.append(LariPrediction(
                id: "host-long-wait-\(partyId)",
                surface: "host",
                severity: .alert,
                text: "Party #\(partyId) has been waiting \(JsValueFormat.numberString(longest)) min — over the \(JsValueFormat.numberString(waitLongMinutes)) min threshold.",
                action: "seat or check in",
                source: "waitlist_parties:\(partyId)"
            ))
        }

        // alert · waitlist overflowing
        if summary.waiting > waitOverflowThreshold {
            out.append(LariPrediction(
                id: "host-overflow-\(today)",
                surface: "host",
                severity: .alert,
                text: "\(summary.waiting) parties waiting — past the \(waitOverflowThreshold)-party overflow threshold.",
                action: "call backup host",
                source: "waitlist_parties:rollup"
            ))
        }

        // warn · busy night
        if summary.waiting > waitBusyThreshold && summary.waiting <= waitOverflowThreshold {
            out.append(LariPrediction(
                id: "host-busy-\(today)",
                surface: "host",
                severity: .warn,
                text: "\(summary.waiting) parties waiting — pace check the floor.",
                source: "waitlist_parties:rollup"
            ))
        }

        // warn · today's average wait is creeping
        if let avg = summary.avgWaitMinutes, avg > avgWaitWarnMinutes {
            out.append(LariPrediction(
                id: "host-avg-wait-\(today)",
                surface: "host",
                severity: .warn,
                text: "Average seating wait today is \(JsValueFormat.numberString(avg)) min — over \(JsValueFormat.numberString(avgWaitWarnMinutes)) min.",
                source: "waitlist_parties:avg"
            ))
        }

        // ok · healthy rollup
        if summary.waiting > 0 || summary.seatedToday > 0 {
            let avgText = summary.avgWaitMinutes.map { " · avg \(JsValueFormat.numberString($0)) min" } ?? ""
            out.append(LariPrediction(
                id: "host-rollup-\(today)",
                surface: "host",
                severity: .ok,
                text: "\(summary.seatedToday) seated today · \(summary.waiting) waiting\(avgText).",
                source: "waitlist_parties:rollup"
            ))
        }

        return trimPredictions(out)
    }
}
