import Foundation

/// One management-action JSONL entry — tolerant decode of the lines written by
/// `lib/auditLog.mjs` `logAuditAction` (and natively by `ManagementAuditLogger`).
/// Unknown/extra fields are preserved in `raw`; typed accessors cover what the
/// web audit-log page renders (`action`, `slug`, `timestamp`, `user`, `changes`).
public struct ManagementAuditEntry: Sendable, Identifiable, Equatable {
    /// `id` field from the line (e.g. `audit_1717…_x9k2`); a stable positional
    /// fallback is synthesized when the line has none so SwiftUI lists stay keyed.
    public let id: String
    public let timestamp: String?
    public let action: String?
    public let slug: String?
    public let user: String?
    /// `changes` payload, stringified per key exactly like the web page's
    /// `String(value)` render. Sorted by key for deterministic display.
    public let changes: [(key: String, value: String)]
    /// The original JSONL line (for the expandable raw view / export).
    public let raw: String

    public static func == (lhs: ManagementAuditEntry, rhs: ManagementAuditEntry) -> Bool {
        lhs.raw == rhs.raw && lhs.id == rhs.id
    }

    /// Parse one JSONL line. Returns nil for corrupted / partial lines
    /// (interrupted appends) — callers skip, never throw.
    public static func parse(line: String, fallbackId: String) -> ManagementAuditEntry? {
        guard let data = line.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let dict = object as? [String: Any] else {
            return nil
        }
        let changesDict = dict["changes"] as? [String: Any] ?? [:]
        let changes = changesDict
            .map { (key: $0.key, value: Self.stringify($0.value)) }
            .sorted { $0.key < $1.key }
        return ManagementAuditEntry(
            id: (dict["id"] as? String) ?? fallbackId,
            timestamp: Self.stringifyOptional(dict["timestamp"]),
            action: dict["action"] as? String,
            slug: dict["slug"] as? String,
            user: dict["user"] as? String,
            changes: changes,
            raw: line
        )
    }

    /// Mirror of the JS template `String(value)` for changes rendering.
    static func stringify(_ value: Any) -> String {
        switch value {
        case let s as String: return s
        case let b as Bool: return b ? "true" : "false"
        case let n as NSNumber: return "\(n)"
        case is NSNull: return "null"
        default:
            if let data = try? JSONSerialization.data(withJSONObject: value),
               let s = String(data: data, encoding: .utf8) {
                return s
            }
            return "\(value)"
        }
    }

    static func stringifyOptional(_ value: Any?) -> String? {
        guard let value, !(value is NSNull) else { return nil }
        return stringify(value)
    }
}

/// Pure port of the read side of `lib/auditLog.mjs` — operates on the whole
/// JSONL file content (buffered read, same as the web module). File I/O lives
/// in `LariatDB.ManagementAuditLogReader`.
public enum AuditLogCompute {
    /// `getRecentAuditLog(limit = 100)` — last `limit` lines (slice BEFORE
    /// parse, matching the web), corrupted lines skipped, newest-first
    /// (positional reverse).
    public static func recent(content: String, limit: Int = 100) -> [ManagementAuditEntry] {
        guard limit > 0 else { return [] }
        let lines = content
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: "\n")
            .filter { !$0.isEmpty }
        let tail = lines.suffix(limit)
        let startIndex = lines.count - tail.count
        var out: [ManagementAuditEntry] = []
        for (offset, line) in tail.enumerated() {
            if let entry = ManagementAuditEntry.parse(line: line, fallbackId: "line_\(startIndex + offset)") {
                out.append(entry)
            }
        }
        return out.reversed()
    }

    /// `streamFilter(predicate)` — full-file scan (NO legacy 1000-entry cap),
    /// empty lines skipped, corrupted lines skipped, matched subset returned
    /// newest-first (positional reverse). Audit ref:
    /// docs/audit/2026-05-08-codebase-audit.md §1.
    public static func filter(
        content: String,
        predicate: (ManagementAuditEntry) -> Bool
    ) -> [ManagementAuditEntry] {
        var out: [ManagementAuditEntry] = []
        let lines = content.components(separatedBy: "\n")
        for (index, line) in lines.enumerated() {
            if line.isEmpty { continue }
            guard let entry = ManagementAuditEntry.parse(line: line, fallbackId: "line_\(index)") else {
                continue // skip half-written / corrupted line
            }
            if predicate(entry) {
                out.append(entry)
            }
        }
        return out.reversed()
    }

    /// `getAuditLogByAction(action)`.
    public static func byAction(content: String, action: String) -> [ManagementAuditEntry] {
        filter(content: content) { $0.action == action }
    }

    /// `getAuditLogForRecipe(slug)`.
    public static func forSlug(content: String, slug: String) -> [ManagementAuditEntry] {
        filter(content: content) { $0.slug == slug }
    }

    /// `exportAuditLog(startDate, endDate)` — inclusive range over the FULL
    /// file (no silent 5000-row cap). Entries with unparseable timestamps are
    /// skipped (predicate false on NaN), never crashed on.
    public static func export(content: String, start: Date, end: Date) -> [ManagementAuditEntry] {
        let startMs = start.timeIntervalSince1970
        let endMs = end.timeIntervalSince1970
        return filter(content: content) { entry in
            guard let ts = parseTimestamp(entry.timestamp) else { return false }
            let ms = ts.timeIntervalSince1970
            return ms >= startMs && ms <= endMs
        }
    }

    /// String-bounds overload — mirrors the web's `Date|string` parameter:
    /// if either bound is unparseable the export returns `[]` deterministically
    /// instead of throwing (compliance callers get an empty result, not a crash).
    public static func export(content: String, startISO: String, endISO: String) -> [ManagementAuditEntry] {
        guard let start = parseTimestamp(startISO), let end = parseTimestamp(endISO) else {
            return []
        }
        return export(content: content, start: start, end: end)
    }

    /// `new Date(value).getTime()` equivalent for the ISO-8601 strings
    /// `logAuditAction` writes (`toISOString()` — always fractional + Z).
    /// Non-fractional ISO and plain dates are also accepted; anything else → nil.
    public static func parseTimestamp(_ value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        if let d = Self.isoFractional.date(from: value) { return d }
        if let d = Self.iso.date(from: value) { return d }
        if let d = Self.plainDate.date(from: value) { return d }
        return nil
    }

    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private static let plainDate: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
}
