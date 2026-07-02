import Foundation

/// Pure reservations-board rules ported from `app/reservations/
/// ReservationsBoard.jsx`: the loose time parser (which carries an inline
/// assertion table in the web source — ported verbatim into the tests),
/// the 12h formatters, hour bucketing, and the header counts.
public enum ReservationsCompute {

    /// Parse a loose time string into 'HH:MM' 24h. Returns nil on failure.
    /// Port of `parseTimeTo24h` (whitespace-tolerant, case-insensitive
    /// AM/PM; bare hour assumes on-the-hour).
    public static func parseTimeTo24h(_ input: String?) -> String? {
        guard let input else { return nil }
        let s = input.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !s.isEmpty else { return nil }
        guard let match = s.wholeMatch(of: #/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/#) else { return nil }
        guard var h = Int(match.1) else { return nil }
        let min = match.2.flatMap { Int($0) } ?? 0
        guard (0...59).contains(min) else { return nil }
        if let ampm = match.3 {
            guard (1...12).contains(h) else { return nil }
            if ampm == "am" {
                h = h == 12 ? 0 : h
            } else {
                h = h == 12 ? 12 : h + 12
            }
        } else {
            guard (0...23).contains(h) else { return nil }
        }
        return String(format: "%02d:%02d", h, min)
    }

    /// Render a row's time portion in 12h. Input is "YYYY-MM-DD HH:MM".
    /// Port of `formatRowTime` (also duplicated in FloorPlan.jsx).
    public static func formatRowTime(_ at: String?) -> String {
        guard let at, let match = at.firstMatch(of: #/(\d{2}):(\d{2})$/#) else { return "" }
        guard let h24 = Int(match.1) else { return "" }
        let mm = String(match.2)
        let ampm = h24 >= 12 ? "PM" : "AM"
        let h = h24 % 12 == 0 ? 12 : h24 % 12
        return "\(h):\(mm) \(ampm)"
    }

    /// Render the bucket header in 12h from "HH:00". Port of `formatHourHeader`.
    public static func formatHourHeader(_ hh00: String) -> String {
        guard let match = hh00.wholeMatch(of: #/(\d{2}):(\d{2})/#) else { return hh00 }
        guard let h24 = Int(match.1) else { return hh00 }
        let ampm = h24 >= 12 ? "PM" : "AM"
        let h = h24 % 12 == 0 ? 12 : h24 % 12
        return "\(h):00 \(ampm)"
    }

    /// Group rows by hour bucket ("HH:00" from the trailing HH:MM). Rows
    /// missing a parseable time land in the "" (Unscheduled) bin, which
    /// sorts LAST. Preserves insertion order within a bucket.
    public static func hourBuckets(_ rows: [ReservationRow]) -> [(key: String, rows: [ReservationRow])] {
        var buckets: [String: [ReservationRow]] = [:]
        var order: [String] = []
        for r in rows {
            let key: String
            if let match = r.reservationAt.firstMatch(of: #/(\d{2}):(\d{2})$/#) {
                key = "\(match.1):00"
            } else {
                key = ""
            }
            if buckets[key] == nil { order.append(key) }
            buckets[key, default: []].append(r)
        }
        let keys = order.sorted { a, b in
            if a.isEmpty && !b.isEmpty { return false }
            if b.isEmpty && !a.isEmpty { return true }
            return a < b
        }
        return keys.map { (key: $0, rows: buckets[$0] ?? []) }
    }

    /// Header counts: per-status totals + people on the book (booked +
    /// seated party sizes).
    public static func counts(_ rows: [ReservationRow]) -> ReservationCounts {
        var booked = 0, seated = 0, completed = 0, cancelled = 0, noShow = 0, people = 0
        for r in rows {
            switch r.status {
            case "booked": booked += 1
            case "seated": seated += 1
            case "completed": completed += 1
            case "cancelled": cancelled += 1
            case "no_show": noShow += 1
            default: break
            }
            if r.status == "booked" || r.status == "seated" {
                people += r.partySize
            }
        }
        return ReservationCounts(
            booked: booked, seated: seated, completed: completed,
            cancelled: cancelled, noShow: noShow, people: people
        )
    }

    /// Status pill label — STATUS_LABEL in ReservationsBoard.jsx
    /// (unknown statuses render their raw value).
    public static func statusLabel(_ status: String) -> String {
        switch status {
        case "booked": return "Booked"
        case "seated": return "Seated"
        case "completed": return "Done"
        case "cancelled": return "Cancelled"
        case "no_show": return "No show"
        default: return status
        }
    }
}

public struct ReservationCounts: Sendable, Equatable {
    public let booked: Int
    public let seated: Int
    public let completed: Int
    public let cancelled: Int
    public let noShow: Int
    public let people: Int

    public init(booked: Int, seated: Int, completed: Int, cancelled: Int, noShow: Int, people: Int) {
        self.booked = booked
        self.seated = seated
        self.completed = completed
        self.cancelled = cancelled
        self.noShow = noShow
        self.people = people
    }
}
