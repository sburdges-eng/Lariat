import Foundation

/// Pure derived state for the /equipment board — parity with
/// `isWarrantyExpired` / `isOverdue` in `app/equipment/EquipmentBoard.tsx`
/// (L26-42): a date is "past" when it parses and is strictly before today's
/// local midnight; null / unparseable dates never flag.
public enum EquipmentCompute {

    /// Strict `YYYY-MM-DD` check (the web parses `${iso}T00:00:00` — DB
    /// values come from `<input type="date">`, always this shape).
    private static func isISODate(_ s: String) -> Bool {
        guard s.count == 10 else { return false }
        let chars = Array(s)
        for (i, c) in chars.enumerated() {
            if i == 4 || i == 7 {
                if c != "-" { return false }
            } else if !c.isNumber {
                return false
            }
        }
        return true
    }

    /// `date < today` — a warranty expiring today is NOT yet expired and a
    /// task due today is NOT yet overdue (web comparison is strict `<`).
    public static func isPastDate(_ iso: String?, today: String = ShiftDate.todayISO()) -> Bool {
        guard let iso, isISODate(iso), isISODate(today) else { return false }
        return iso < today
    }

    /// Card-level "Service overdue" flag: any schedule row past due
    /// (EquipmentBoard.tsx L287).
    public static func anyOverdue(_ rows: [EquipmentScheduleRow], today: String = ShiftDate.todayISO()) -> Bool {
        rows.contains { isPastDate($0.nextDue, today: today) }
    }
}
