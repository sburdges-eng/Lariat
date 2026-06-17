import Foundation

// Port of `lib/dateMarks.ts` — discard-on math, validation, expiring scan.

public enum DateMarkCompute {
    public static let holdingDaysAfterPrep = 6

    private static let utcCalDay: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    private static func parseStrict(_ s: String?) -> Date? {
        guard let s, s.count == 10 else { return nil }
        guard let parts = parseParts(s) else { return nil }
        guard let dt = utcCalDay.date(from: s) else { return nil }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let c = cal.dateComponents([.year, .month, .day], from: dt)
        guard c.year == parts.y, c.month == parts.m, c.day == parts.d else { return nil }
        return dt
    }

    private static func parseParts(_ s: String) -> (y: Int, m: Int, d: Int)? {
        let bits = s.split(separator: "-")
        guard bits.count == 3,
              let y = Int(bits[0]), let m = Int(bits[1]), let d = Int(bits[2]) else { return nil }
        return (y, m, d)
    }

    private static func formatDate(_ d: Date) -> String {
        utcCalDay.string(from: d)
    }

    public static func computeDiscardOn(preparedOn: String) throws -> String {
        guard let dt = parseStrict(preparedOn) else {
            throw DateMarkWriteError.validationFailed("prepared_on must be a YYYY-MM-DD date")
        }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        guard let end = cal.date(byAdding: .day, value: holdingDaysAfterPrep, to: dt) else {
            throw DateMarkWriteError.validationFailed("Could not compute discard date")
        }
        return formatDate(end)
    }

    public static func validateCreate(item: String, preparedOn: String) -> Result<Void, DateMarkWriteError> {
        if item.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return .failure(.validationFailed("Item is required"))
        }
        if parseStrict(preparedOn) == nil {
            return .failure(.validationFailed("prepared_on must be a YYYY-MM-DD date"))
        }
        return .success(())
    }

    /// Command breach counts — expired + due today.
    public static func classify(_ rows: [CmdDateMarkRow], today: String) -> (expired: Int, dueToday: Int) {
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

    public static func scanExpiringBatches(_ rows: [DateMarkRow], today: String) -> [ExpiringBatch] {
        guard let now = parseStrict(today) else { return [] }
        var out: [ExpiringBatch] = []
        for r in rows {
            if r.discardedAt != nil { continue }
            guard let disc = parseStrict(r.discardOn) else { continue }
            let daysUntil = Int(((disc.timeIntervalSince1970 - now.timeIntervalSince1970) / 86400.0).rounded())
            let status: ExpiringBatchStatus
            if daysUntil < 0 { status = .expired }
            else if daysUntil == 0 { status = .dueToday }
            else { status = .ok }
            out.append(
                ExpiringBatch(
                    id: r.id,
                    item: r.item,
                    discardOn: r.discardOn,
                    daysUntilDiscard: daysUntil,
                    status: status
                )
            )
        }
        return out.sorted { $0.daysUntilDiscard < $1.daysUntilDiscard }
    }
}
