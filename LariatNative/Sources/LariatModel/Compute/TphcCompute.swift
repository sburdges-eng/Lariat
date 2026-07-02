import Foundation

// Port of `lib/tphc.ts` — Time as Public Health Control (FDA §3-501.19), F11.
//
// An alternative to temperature control for TCS food: the food stays safe
// because the time since it left temp control is capped, not because it stays
// cold/hot.
//   (A) Hot food held without temperature control — max 4 hours from the moment
//       it leaves temp control. Must be served or discarded by cutoff.
//   (B) Cold food held without temperature control — max 6 hours.
//
// This module is pure (no I/O); the repository wraps it with DB writes.
// `computeCutoffAt(started_at, kind)` returns the ISO timestamp at which the
// batch must be discarded. Numbers/citations match the JS rule module exactly —
// see tests/js/test-tphc-rules.mjs for the pins.

/// TPHC batch kind — mirrors the JS `TphcKind` string union. Raw values match the
/// strings the web accepts (`hot_time_only` / `cold_time_only`).
public enum TphcKind: String, Sendable, Equatable, CaseIterable {
    case hotTimeOnly = "hot_time_only"
    case coldTimeOnly = "cold_time_only"
}

/// Discard reason — mirrors the JS `TphcDiscardReason` string union. Raw values
/// match the strings the web writes to `tphc_entries.discard_reason`.
public enum TphcDiscardReason: String, Sendable, Equatable, CaseIterable {
    case reachedCutoff = "reached_cutoff"
    case consumed
    case quality
    case contamination
}

/// Per-batch status — mirrors the JS `TphcBatchStatus['status']` union.
public enum TphcStatus: String, Sendable, Equatable {
    case ok
    case warning
    case expired
}

/// Validation outcome for opening a batch — mirrors the JS `ValidateResult`.
public struct ValidateTphcResult: Sendable, Equatable {
    public let ok: Bool
    public let reason: String?

    public static let success = ValidateTphcResult(ok: true, reason: nil)
    public static func failure(_ reason: String) -> ValidateTphcResult {
        ValidateTphcResult(ok: false, reason: reason)
    }
}

/// Minimal row view for the scanner (mirrors the JS `TphcRowSnapshot`).
public struct TphcRowSnapshot: Sendable, Equatable {
    public let id: Int64
    public let item: String
    public let stationId: String?
    public let startedAt: String
    public let cutoffAt: String
    public let discardedAt: String?

    public init(id: Int64, item: String, stationId: String?, startedAt: String, cutoffAt: String, discardedAt: String?) {
        self.id = id
        self.item = item
        self.stationId = stationId
        self.startedAt = startedAt
        self.cutoffAt = cutoffAt
        self.discardedAt = discardedAt
    }
}

/// Classified scan entry (mirrors the JS `TphcBatchStatus`).
public struct TphcBatchStatus: Sendable, Equatable, Identifiable {
    public let id: Int64
    public let item: String
    public let stationId: String?
    public let startedAt: String
    public let cutoffAt: String
    public let minutesUntilCutoff: Int   // negative = past cutoff
    public let status: TphcStatus

    public init(id: Int64, item: String, stationId: String?, startedAt: String, cutoffAt: String, minutesUntilCutoff: Int, status: TphcStatus) {
        self.id = id
        self.item = item
        self.stationId = stationId
        self.startedAt = startedAt
        self.cutoffAt = cutoffAt
        self.minutesUntilCutoff = minutesUntilCutoff
        self.status = status
    }
}

public enum TphcCompute {
    public static let hotHours = 4
    public static let coldHours = 6

    /// Warn when less than this many minutes remain (yellow tile).
    public static let warningMinutes = 30

    // ── ISO-8601 parsing (parity with JS Date + the strict fragment guard) ──

    private static let isoWithFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoNoFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    /// ISO-8601 emitter for `computeCutoffAt` output — matches JS
    /// `new Date(ms).toISOString()`, which always renders fractional seconds
    /// (`.000Z`). The web API tests assert the `.000Z` form exactly.
    private static let isoEmit: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        f.timeZone = TimeZone(secondsFromGMT: 0)
        return f
    }()

    /// Mirror of `parseInstantStrict`: reject bare years / non-ISO phrases.
    /// Requires at least a `YYYY-MM-DD[T ]HH:MM` fragment before accepting.
    /// Returns ms-since-epoch or nil.
    public static func parseInstantStrictMs(_ s: String?) -> Double? {
        guard let s, !s.isEmpty else { return nil }
        // Require a date+time fragment (parity with the JS regex guard).
        if fragmentRange(s) == nil { return nil }
        if let d = isoNoFraction.date(from: s) { return d.timeIntervalSince1970 * 1000 }
        if let d = isoWithFraction.date(from: s) { return d.timeIntervalSince1970 * 1000 }
        return nil
    }

    /// Matches the JS `/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/` fragment guard.
    private static func fragmentRange(_ s: String) -> Range<String.Index>? {
        // YYYY-MM-DD then a 'T' or ' ' then HH:MM.
        let chars = Array(s)
        guard chars.count >= 16 else { return nil }
        for start in 0...(chars.count - 16) {
            if isDigit(chars[start]) && isDigit(chars[start + 1]) && isDigit(chars[start + 2]) && isDigit(chars[start + 3])
                && chars[start + 4] == "-" && isDigit(chars[start + 5]) && isDigit(chars[start + 6])
                && chars[start + 7] == "-" && isDigit(chars[start + 8]) && isDigit(chars[start + 9])
                && (chars[start + 10] == "T" || chars[start + 10] == " ")
                && isDigit(chars[start + 11]) && isDigit(chars[start + 12])
                && chars[start + 13] == ":" && isDigit(chars[start + 14]) && isDigit(chars[start + 15]) {
                let lower = s.index(s.startIndex, offsetBy: start)
                let upper = s.index(lower, offsetBy: 16)
                return lower..<upper
            }
        }
        return nil
    }

    private static func isDigit(_ c: Character) -> Bool { c.isNumber && c.isASCII }

    // ── Hours per kind ────────────────────────────────────────────────

    /// Mirror of `hoursFor`. Returns nil for an unknown kind (the JS version
    /// throws; callers treat nil the same way validation does).
    public static func hoursFor(_ kind: TphcKind) -> Int {
        switch kind {
        case .hotTimeOnly: return hotHours
        case .coldTimeOnly: return coldHours
        }
    }

    // ── Public API ─────────────────────────────────────────────────────

    /// Mirror of `computeCutoffAt`. Returns the ISO instant at which the batch
    /// must be discarded, or nil on malformed `startedAt` (the JS throws; the
    /// repository maps a nil to a validation error rather than persisting a
    /// wrong time).
    public static func computeCutoffAt(startedAt: String, kind: TphcKind) -> String? {
        guard let startMs = parseInstantStrictMs(startedAt) else { return nil }
        let ms = startMs + Double(hoursFor(kind)) * 60 * 60 * 1000
        let date = Date(timeIntervalSince1970: ms / 1000)
        return isoEmit.string(from: date)
    }

    // ── Validation ─────────────────────────────────────────────────────

    /// Mirror of `isTphcKind`.
    public static func isTphcKind(_ raw: String?) -> Bool {
        guard let raw else { return false }
        return TphcKind(rawValue: raw) != nil
    }

    /// Mirror of `isTphcDiscardReason`.
    public static func isTphcDiscardReason(_ raw: String?) -> Bool {
        guard let raw else { return false }
        return TphcDiscardReason(rawValue: raw) != nil
    }

    /// Mirror of `validateTphcCreate`. `kind` arrives as a raw string so an
    /// unknown value fails the same way the web route's 400 path does.
    public static func validateTphcCreate(item: String?, startedAt: String?, kind: String?) -> ValidateTphcResult {
        let trimmedItem = (item ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedItem.isEmpty {
            return .failure("Item is required")
        }
        if parseInstantStrictMs(startedAt) == nil {
            return .failure("started_at must be an ISO 8601 timestamp")
        }
        if !isTphcKind(kind) {
            return .failure("kind must be one of: \(TphcKind.allCases.map(\.rawValue).joined(separator: ", "))")
        }
        return .success
    }

    // ── Scanner ────────────────────────────────────────────────────────

    /// Mirror of `scanActiveTphc`. Drops discarded rows, classifies each as
    /// ok / warning / expired against `now`, and sorts most-past-due first
    /// (ascending `minutes_until_cutoff`). `now` is a param so tests can freeze
    /// time. Returns nil on a malformed `now` (the JS throws).
    public static func scanActiveTphc(_ rows: [TphcRowSnapshot], now: String) -> [TphcBatchStatus]? {
        guard let refMs = parseInstantStrictMs(now) else { return nil }

        var out: [TphcBatchStatus] = []
        for r in rows {
            if r.discardedAt != nil { continue }
            guard let cutoffMs = parseInstantStrictMs(r.cutoffAt) else { continue }
            let minutesUntil = Int(((cutoffMs - refMs) / (60 * 1000)).rounded())
            let status: TphcStatus
            if minutesUntil <= 0 {
                status = .expired
            } else if minutesUntil <= warningMinutes {
                status = .warning
            } else {
                status = .ok
            }
            out.append(TphcBatchStatus(
                id: r.id, item: r.item, stationId: r.stationId,
                startedAt: r.startedAt, cutoffAt: r.cutoffAt,
                minutesUntilCutoff: minutesUntil, status: status))
        }
        out.sort { $0.minutesUntilCutoff < $1.minutesUntilCutoff }
        return out
    }

    /// Normalize a batch_ref / station / free-text field: trim, nil when empty.
    public static func normalizeOptional(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
