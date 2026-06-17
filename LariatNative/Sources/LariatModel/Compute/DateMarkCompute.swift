import Foundation

// Port of `scanExpiringBatches` from `lib/dateMarks.ts`, reduced to the two
// counts summarize() takes: number of 'expired' and 'due_today' marks.
//
// Rule: daysUntil = round((discard_on - today) / 1 day), both parsed as UTC
// calendar midnights. daysUntil < 0 → expired; == 0 → due_today; else ok.
// Rows with discarded_at set are skipped (the repository already filters
// these, but we mirror the guard for faithfulness).

enum DateMarkCompute {
    private static let utcCalDay: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    /// Strict YYYY-MM-DD → UTC midnight (mirrors parseDateStrict; returns nil
    /// on non-date input so unparseable rows are skipped like the TS `continue`).
    private static func parseStrict(_ s: String?) -> Date? {
        guard let s = s, s.count == 10 else { return nil }
        return utcCalDay.date(from: s)
    }

    /// Returns (expired, dueToday) counts.
    static func classify(_ rows: [CmdDateMarkRow], today: String) -> (expired: Int, dueToday: Int) {
        guard let now = parseStrict(today) else { return (0, 0) }
        var expired = 0, dueToday = 0
        for r in rows {
            if r.discardedAt != nil { continue }
            guard let disc = parseStrict(r.discardOn) else { continue }
            let daysUntil = Int(((disc.timeIntervalSince1970 - now.timeIntervalSince1970) / 86400.0).rounded())
            if daysUntil < 0 { expired += 1 }
            else if daysUntil == 0 { dueToday += 1 }
        }
        return (expired, dueToday)
    }
}
