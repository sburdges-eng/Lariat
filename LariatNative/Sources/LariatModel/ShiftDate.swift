import Foundation

/// UTC calendar date (`yyyy-MM-dd`), matching `todayISO()` in `lib/db.ts`.
public enum ShiftDate {
    public static func todayISO() -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let components = calendar.dateComponents([.year, .month, .day], from: Date())
        return String(format: "%04d-%02d-%02d", components.year!, components.month!, components.day!)
    }
}
