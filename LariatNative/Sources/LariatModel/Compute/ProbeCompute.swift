import Foundation

// Port of `classifyProbes` from `lib/calibrations.ts`, reduced to the three
// counts summarize() takes: overdue, failed, due_soon.
//
// Per probe (grouped by thermometer_id): take the MOST RECENT calibration
// (calibrated_at DESC). frequency_days override applies when > 0, else 30.
//   - not passed                       → failed
//   - passed, unparseable timestamp    → ok
//   - passed: daysRemaining = (lastAt + freq*1d - now)/1d
//        < 0           → overdue
//        <= 7          → due_soon
//        else          → ok
// `now` = today T00:00:00Z (mirrors summarize: new Date(today+'T00:00:00Z')).

enum ProbeCompute {
    private static let defaultFrequencyDays = 30
    private static let dueSoonWindowDays = 7.0

    /// Parse a sqlite timestamp ('YYYY-MM-DD HH:MM:SS' or 'YYYY-MM-DD'), treated
    /// as UTC when it carries no tz. Mirrors parseTs in lib/calibrations.ts.
    private static func parseTs(_ s: String?) -> Date? {
        guard let s = s, !s.isEmpty else { return nil }
        let hasTz = s.range(of: "[zZ]|[+-]\\d\\d:?\\d\\d$", options: .regularExpression) != nil
        let iso = hasTz ? s : s.replacingOccurrences(of: " ", with: "T") + "Z"
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        if let d = f.date(from: iso) { return d }
        // 'YYYY-MM-DD' (no time) → append midnight.
        let f2 = ISO8601DateFormatter()
        f2.formatOptions = [.withInternetDateTime]
        return f2.date(from: hasTz ? s : s + "T00:00:00Z")
    }

    /// today T00:00:00Z
    private static func todayUTCMidnight(_ today: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: today + "T00:00:00Z")
    }

    /// Returns (overdue, failed, dueSoon) counts.
    static func classify(_ rows: [CmdCalibrationRow], today: String) -> (overdue: Int, failed: Int, dueSoon: Int) {
        guard let now = todayUTCMidnight(today) else { return (0, 0, 0) }

        // Group by thermometer_id (skip blank/nil ids).
        var grouped: [String: [CmdCalibrationRow]] = [:]
        for r in rows {
            guard let id = r.thermometerId, !id.isEmpty else { continue }
            grouped[id, default: []].append(r)
        }

        var overdue = 0, failed = 0, dueSoon = 0
        for (_, bucket) in grouped where !bucket.isEmpty {
            // Newest-first by calibrated_at (lexicographic, matching TS).
            let sorted = bucket.sorted { ($0.calibratedAt ?? "") > ($1.calibratedAt ?? "") }
            let last = sorted[0]
            let freq = (last.frequencyDays ?? 0) > 0 ? last.frequencyDays! : defaultFrequencyDays
            let passed = last.passed == 1
            if !passed {
                failed += 1
                continue
            }
            guard let lastAt = parseTs(last.calibratedAt) else { continue } // 'ok' → no count
            let dueMs = lastAt.timeIntervalSince1970 + Double(freq) * 86400.0
            let daysRemaining = (dueMs - now.timeIntervalSince1970) / 86400.0
            if daysRemaining < 0 { overdue += 1 }
            else if daysRemaining <= dueSoonWindowDays { dueSoon += 1 }
            // else ok → no count
        }
        return (overdue, failed, dueSoon)
    }
}
