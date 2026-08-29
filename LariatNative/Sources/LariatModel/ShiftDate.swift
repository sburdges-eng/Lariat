import Foundation

/// Venue service date and UTC calendar date.
///
/// Web twins:
/// - `serviceDate()` in `lib/serviceDate.ts` — 02:00–02:00 `America/Denver`
/// - `todayISO()` in `lib/db/queries.ts` — UTC `yyyy-MM-dd`
///
/// Spec: `docs/superpowers/specs/2026-08-06-service-date-design.md`
/// Parity oracle: `tests/fixtures/service_date_parity.json`
public enum ShiftDate {
    public static let venueTimeZoneIdentifier = "America/Denver"
    public static let serviceDayStartHour = 2

    /// UTC calendar date (`yyyy-MM-dd`), matching web `todayISO()`.
    /// Use only for calendar surfaces: certs, reservations, reporting windows.
    public static func todayISO(from date: Date = Date()) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        return String(
            format: "%04d-%02d-%02d",
            components.year!,
            components.month!,
            components.day!
        )
    }

    /// Venue service date (`yyyy-MM-dd`) for an instant.
    ///
    /// `serviceDate(at) = denverCalendarDate(at − 2h)`. Instant arithmetic, never
    /// wall-clock arithmetic, so the two DST nights need no special case. On
    /// fall-back night the repeated 01:00 hour belongs to the new service day
    /// (spec Option A).
    public static func serviceDate(at date: Date = Date()) -> String {
        let shifted = date.addingTimeInterval(
            -TimeInterval(serviceDayStartHour * 3600)
        )
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: venueTimeZoneIdentifier)!
        let components = calendar.dateComponents([.year, .month, .day], from: shifted)
        return String(
            format: "%04d-%02d-%02d",
            components.year!,
            components.month!,
            components.day!
        )
    }
}
