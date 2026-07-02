import Foundation

/// Per-station "tonight rollup" pure resolver — port of `lib/beoFireSchedule.ts`.
/// No I/O; the repository queries SQLite and hands the results in. Owns the
/// grouping/sorting + age-bucket helper so the board and any future rollup
/// screen stay consistent.
public enum BeoFireScheduleCompute {
    public static let unassigned = "unassigned"

    /// Joined course row (`CourseRow` in lib/beoFireSchedule.ts).
    public struct CourseRow: Equatable, Sendable {
        public let id: Int64
        public let eventId: Int64
        public let eventTitle: String
        public let courseLabel: String
        public let fireAt: String          // canonical ISO-8601 UTC
        public let stationId: String?      // nil → "unassigned" bucket

        public init(id: Int64, eventId: Int64, eventTitle: String, courseLabel: String, fireAt: String, stationId: String?) {
            self.id = id; self.eventId = eventId; self.eventTitle = eventTitle
            self.courseLabel = courseLabel; self.fireAt = fireAt; self.stationId = stationId
        }
    }

    /// Bound line-item row (`LineRow`).
    public struct LineRow: Equatable, Sendable {
        public let id: Int64
        public let eventId: Int64
        public let courseId: Int64?
        public let itemName: String
        public let quantity: Double
        public let prepNotes: String?

        public init(id: Int64, eventId: Int64, courseId: Int64?, itemName: String, quantity: Double, prepNotes: String?) {
            self.id = id; self.eventId = eventId; self.courseId = courseId
            self.itemName = itemName; self.quantity = quantity; self.prepNotes = prepNotes
        }
    }

    public struct CourseLine: Equatable, Sendable, Identifiable {
        public let id: Int64
        public let itemName: String
        public let quantity: Double
        public let prepNotes: String?

        public init(id: Int64, itemName: String, quantity: Double, prepNotes: String?) {
            self.id = id; self.itemName = itemName
            self.quantity = quantity; self.prepNotes = prepNotes
        }
    }

    public struct CourseWithLines: Equatable, Sendable, Identifiable {
        public let id: Int64
        public let eventId: Int64
        public let eventTitle: String
        public let courseLabel: String
        public let fireAt: String
        public let lines: [CourseLine]

        public init(id: Int64, eventId: Int64, eventTitle: String, courseLabel: String, fireAt: String, lines: [CourseLine]) {
            self.id = id; self.eventId = eventId; self.eventTitle = eventTitle
            self.courseLabel = courseLabel; self.fireAt = fireAt; self.lines = lines
        }
    }

    public struct StationBucket: Equatable, Sendable, Identifiable {
        public var id: String { stationId }
        public let stationId: String
        public let courses: [CourseWithLines]

        public init(stationId: String, courses: [CourseWithLines]) {
            self.stationId = stationId
            self.courses = courses
        }
    }

    public struct FireSchedulePayload: Equatable, Sendable {
        public let date: String
        public let locationId: String
        public let stations: [StationBucket]

        public init(date: String, locationId: String, stations: [StationBucket]) {
            self.date = date
            self.locationId = locationId
            self.stations = stations
        }
    }

    /// Group courses by station and attach the bound line items. Stations
    /// return in alphabetical order with 'unassigned' last; within each
    /// station, courses sort chronologically by fire_at, ties broken by
    /// event_id then course id (deterministic).
    public static func resolveSchedule(
        date: String,
        locationId: String,
        courses: [CourseRow],
        lines: [LineRow]
    ) -> FireSchedulePayload {
        var linesByCourse: [Int64: [LineRow]] = [:]
        for l in lines {
            guard let courseId = l.courseId else { continue }
            linesByCourse[courseId, default: []].append(l)
        }

        var buckets: [String: [CourseWithLines]] = [:]
        for c in courses {
            let station = c.stationId ?? unassigned
            buckets[station, default: []].append(CourseWithLines(
                id: c.id,
                eventId: c.eventId,
                eventTitle: c.eventTitle,
                courseLabel: c.courseLabel,
                fireAt: c.fireAt,
                lines: (linesByCourse[c.id] ?? []).map {
                    CourseLine(id: $0.id, itemName: $0.itemName, quantity: $0.quantity, prepNotes: $0.prepNotes)
                }
            ))
        }

        for key in buckets.keys {
            buckets[key]?.sort { a, b in
                let am = parseMs(a.fireAt), bm = parseMs(b.fireAt)
                if am != bm { return am < bm }
                if a.eventId != b.eventId { return a.eventId < b.eventId }
                return a.id < b.id
            }
        }

        // Stations: alphabetical, with 'unassigned' last.
        let stationKeys = buckets.keys.sorted { a, b in
            if a == unassigned { return false }
            if b == unassigned { return true }
            return a < b
        }

        return FireSchedulePayload(
            date: date,
            locationId: locationId,
            stations: stationKeys.map { StationBucket(stationId: $0, courses: buckets[$0] ?? []) }
        )
    }

    /// Age bucket for the UI color-coding helper.
    ///   green  : > 30 minutes until fire_at
    ///   yellow : ≤ 30 minutes and not yet past
    ///   red    : on or past fire_at (overdue) — also garbage input (fail-closed)
    /// Threshold mirrors the v1 KDS protocol §2 age-coloring convention.
    public enum AgeBucket: String, Sendable {
        case green, yellow, red
    }

    /// Web `YELLOW_THRESHOLD_MS = 30 * 60_000`, expressed in seconds.
    public static let yellowThresholdSeconds: TimeInterval = 30 * 60

    public static func ageBucketFor(_ fireAt: String, now: Date = Date()) -> AgeBucket {
        guard let fire = parseDate(fireAt) else { return .red } // fail-closed
        let delta = fire.timeIntervalSince(now)
        if delta <= 0 { return .red }
        if delta <= yellowThresholdSeconds { return .yellow }
        return .green
    }

    // ── internals ────────────────────────────────────────────────────────

    private static let nonFractionalIso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    /// JS `Date.parse` equivalent for the canonical strings this surface
    /// carries (fractional preferred, non-fractional accepted).
    static func parseDate(_ s: String) -> Date? {
        BeoCourseRules.fractionalIso.date(from: s) ?? nonFractionalIso.date(from: s)
    }

    /// Sort key: parsed epoch ms; garbage sorts first (deterministic — the
    /// write path validates fire_at, so this branch is unreachable in practice).
    private static func parseMs(_ s: String) -> Double {
        guard let d = parseDate(s) else { return -.greatestFiniteMagnitude }
        return d.timeIntervalSince1970 * 1000
    }
}
