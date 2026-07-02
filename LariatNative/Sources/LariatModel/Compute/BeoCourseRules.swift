import Foundation

/// Pure rule module for BEO course payloads — port of `lib/beoCourses.ts`.
/// No I/O; the repository owns the transaction. Single place that decides
/// what a valid course payload looks like and what the next sort_order
/// should be for a given event.
public enum BeoCourseRules {
    public static let courseLabelMax = 80
    public static let notesMax = 2000

    /// Canonical ISO-8601 UTC: round-trips through `Date.toISOString()`
    /// (same strictness as the KDS protocol §2 convention). Web parity:
    /// `new Date(Date.parse(s)).toISOString() === s` — so "Z without
    /// milliseconds", offsets, and space-separated date-times are rejected.
    public static func isIso8601Utc(_ s: String?) -> Bool {
        guard let s, !s.isEmpty else { return false }
        guard let date = fractionalIso.date(from: s) else { return false }
        return fractionalIso.string(from: date) == s
    }

    /// Formatter matching `Date.prototype.toISOString` output
    /// ("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"). ISO8601DateFormatter is thread-safe.
    static let fractionalIso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    /// Same shape as KDS protocol §2: lowercased non-empty slug.
    public static func isStationSlug(_ s: String?) -> Bool {
        guard let s, !s.isEmpty else { return false }
        return s == s.lowercased()
    }

    /// Validated course payload (`CoursePayload` in lib/beoCourses.ts).
    public struct CoursePayload: Equatable, Sendable {
        public let courseLabel: String
        public let fireAt: String
        public let notes: String?
        public let sortOrder: Int?
        public let stationId: String?

        public init(courseLabel: String, fireAt: String, notes: String?, sortOrder: Int?, stationId: String?) {
            self.courseLabel = courseLabel
            self.fireAt = fireAt
            self.notes = notes
            self.sortOrder = sortOrder
            self.stationId = stationId
        }
    }

    /// Unvalidated POST/PATCH body fields. `event_id` and `location_id` are
    /// NOT checked here — they're repository-level concerns (web parity).
    public struct CourseDraft: Sendable {
        public var courseLabel: String?
        public var fireAt: String?
        public var notes: String?
        public var sortOrder: Int?
        public var stationId: String?

        public init(
            courseLabel: String? = nil, fireAt: String? = nil, notes: String? = nil,
            sortOrder: Int? = nil, stationId: String? = nil
        ) {
            self.courseLabel = courseLabel
            self.fireAt = fireAt
            self.notes = notes
            self.sortOrder = sortOrder
            self.stationId = stationId
        }
    }

    public enum ValidationResult: Equatable, Sendable {
        case ok(CoursePayload)
        case error(String)
    }

    /// Port of `validateCoursePayload` — error strings match the web module
    /// so the 422 bodies stay parity-equal.
    public static func validateCoursePayload(_ draft: CourseDraft) -> ValidationResult {
        let courseLabel = draft.courseLabel?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if courseLabel.isEmpty {
            return .error("course_label required")
        }
        if courseLabel.count > courseLabelMax {
            return .error("course_label too long (max \(courseLabelMax))")
        }

        guard isIso8601Utc(draft.fireAt), let fireAt = draft.fireAt else {
            return .error("fire_at must be a canonical ISO-8601 UTC string")
        }

        var notes: String? = nil
        if let rawNotes = draft.notes {
            let t = rawNotes.trimmingCharacters(in: .whitespacesAndNewlines)
            if t.count > notesMax {
                return .error("notes too long (max \(notesMax))")
            }
            notes = t.isEmpty ? nil : t
        }

        var sortOrder: Int? = nil
        if let n = draft.sortOrder {
            if n < 0 {
                return .error("sort_order must be a non-negative integer")
            }
            sortOrder = n
        }

        var stationId: String? = nil
        if let s = draft.stationId {
            guard isStationSlug(s) else {
                return .error("station_id must be a non-empty lowercased slug")
            }
            stationId = s
        }

        return .ok(CoursePayload(
            courseLabel: courseLabel,
            fireAt: fireAt,
            notes: notes,
            sortOrder: sortOrder,
            stationId: stationId
        ))
    }

    /// Resolve sort_order when the caller doesn't supply one: append at the
    /// end of the event's existing courses. Returns 0 for a fresh event.
    public static func nextSortOrder(_ existingMax: Int?) -> Int {
        guard let existingMax else { return 0 }
        return max(0, existingMax) + 10
    }

    /// Helper for the line-item PATCH path: course_id may be a number, null
    /// (clear binding), or absent (no change). Tri-state input mirrors the
    /// JSON body: `nil` = key absent, `.some(nil)` = explicit null,
    /// `.some(.some(n))` = set.
    public enum CourseIdPatch: Equatable, Sendable {
        case absent
        case clear
        case set(Int64)
    }

    public static func parseCourseIdPatch(_ courseId: Int64??) throws -> CourseIdPatch {
        guard let present = courseId else { return .absent }
        guard let n = present else { return .clear }
        guard n > 0 else {
            throw BeoWriteError.unprocessable("course_id must be a positive integer or null")
        }
        return .set(n)
    }
}
