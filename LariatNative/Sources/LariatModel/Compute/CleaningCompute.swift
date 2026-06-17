import Foundation

/// Port of `lib/cleaning.ts` — validation essentials for POST /api/cleaning.
public enum CleaningCompute {
    public static let notesMaxLen = 500
    public static let areaMaxLen = 100
    public static let taskMaxLen = 200
    public static let cookIdMaxLen = 64
    public static let shiftDateMaxLen = 32
    public static let completedAtMaxLen = 40

    public struct NormalizedCleaningLog: Sendable {
        public let task: String
        public let area: String?
        public let notes: String?
        public let shiftDate: String?
        public let completedAt: String?
        public let cookId: String?
        public let verifiedByCookId: String?
        public let scheduleId: Int64?
    }

    public static func validateCleaningLog(
        task: String?,
        item: String?,
        area: String?,
        notes: String?,
        shiftDate: String?,
        completedAt: String?,
        cookId: String?,
        verifiedByCookId: String?,
        scheduleId: Int64?
    ) -> Result<NormalizedCleaningLog, CleaningWriteError> {
        let itemTrim = (item ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let taskTrim = (task ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !itemTrim.isEmpty || !taskTrim.isEmpty else {
            return .failure(.validationFailed("item or task is required"))
        }
        let taskValue = !itemTrim.isEmpty ? itemTrim : taskTrim
        if taskValue.count > taskMaxLen {
            return .failure(.validationFailed("task length \(taskValue.count) exceeds the \(taskMaxLen)-char limit"))
        }

        if let area, !area.isEmpty {
            if area.count > areaMaxLen {
                return .failure(.validationFailed("area length \(area.count) exceeds the \(areaMaxLen)-char limit"))
            }
        }

        if let notes {
            if notes.count > notesMaxLen {
                return .failure(.validationFailed("notes length \(notes.count) exceeds the \(notesMaxLen)-char limit"))
            }
        }

        if let completedAt {
            if completedAt.count > completedAtMaxLen {
                return .failure(.validationFailed("completed_at length \(completedAt.count) exceeds limit"))
            }
            if ISO8601DateFormatter().date(from: completedAt) == nil,
               DateFormatter.iso8601Flexible.date(from: completedAt) == nil {
                return .failure(.validationFailed("completed_at must be an ISO-8601 timestamp"))
            }
        }

        if let shiftDate {
            if shiftDate.count > shiftDateMaxLen {
                return .failure(.validationFailed("shift_date length \(shiftDate.count) exceeds limit"))
            }
            if shiftDate.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) == nil {
                return .failure(.validationFailed("shift_date must match YYYY-MM-DD"))
            }
        }

        if let cookId, cookId.count > cookIdMaxLen {
            return .failure(.validationFailed("cook_id length \(cookId.count) exceeds limit"))
        }
        if let verifiedByCookId, verifiedByCookId.count > cookIdMaxLen {
            return .failure(.validationFailed("verified_by_cook_id length \(verifiedByCookId.count) exceeds limit"))
        }

        if let scheduleId, scheduleId <= 0 {
            return .failure(.validationFailed("schedule_id must be a positive integer"))
        }

        let areaValue: String? = {
            guard let area else { return nil }
            let t = area.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? nil : t
        }()
        let notesValue: String? = {
            guard let notes else { return nil }
            let t = notes.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? nil : t
        }()

        return .success(NormalizedCleaningLog(
            task: taskValue,
            area: areaValue,
            notes: notesValue,
            shiftDate: shiftDate,
            completedAt: completedAt,
            cookId: cookId?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
            verifiedByCookId: verifiedByCookId?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
            scheduleId: scheduleId
        ))
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

private extension DateFormatter {
    static let iso8601Flexible: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
        f.timeZone = TimeZone(secondsFromGMT: 0)
        return f
    }()
}
