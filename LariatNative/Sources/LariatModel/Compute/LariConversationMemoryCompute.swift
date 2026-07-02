import Foundation

/// Pure half of `lib/lariConversationMemory.ts` (storage/retrieval live in
/// LariatDB.AssistantConversationRepository).
public enum LariConversationMemoryCompute {
    public static let schemaVersion = "lari_conversation_turn_v1"
    public static let ttlHours = 8
    public static let maxTurns = 6
    public static let sessionIdMaxChars = 64
    public static let cookIdMaxChars = 64
    public static let storedTurnContentMaxChars = 2000
    public static let promptTurnContentMaxChars = 800

    public static let sessionIdError = "conversation_session_id is required and must be a UUID"

    private static let uuidPattern = try! NSRegularExpression(
        pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
        options: [.caseInsensitive]
    )

    public enum NormalizedInputs: Sendable, Equatable {
        case ok(sessionId: String, cookId: String)
        case error(String)
    }

    /// `clipText(value, max)` — non-strings → ''.
    public static func clipText(_ value: String?, _ max: Int) -> String {
        guard let value else { return "" }
        return String(value.trimmingCharacters(in: .whitespacesAndNewlines).prefix(max))
    }

    /// `addHoursIso(createdAt, hours)` — invalid createdAt falls back to now.
    public static func addHoursIso(_ createdAt: String, hours: Int, now: Date = Date()) -> String {
        let base = parseIsoDate(createdAt) ?? now
        return isoString(base.addingTimeInterval(Double(hours) * 3600))
    }

    /// `normalizeConversationInputs(body)` — session must be a UUID string;
    /// cook clips to 64 chars, empty → 'anonymous'.
    public static func normalizeConversationInputs(
        sessionId: String?,
        cookId: String?
    ) -> NormalizedInputs {
        guard let sessionId else { return .error(sessionIdError) }
        let rawSession = sessionId.trimmingCharacters(in: .whitespacesAndNewlines)
        let range = NSRange(rawSession.startIndex..., in: rawSession)
        guard !rawSession.isEmpty,
              rawSession.count <= sessionIdMaxChars,
              uuidPattern.firstMatch(in: rawSession, options: [], range: range) != nil
        else {
            return .error(sessionIdError)
        }
        let cook = clipText(cookId, cookIdMaxChars)
        return .ok(sessionId: rawSession, cookId: cook.isEmpty ? "anonymous" : cook)
    }

    /// `formatConversationHistoryForPrompt(turns)` parity.
    public static func formatConversationHistoryForPrompt(_ turns: [StoredConversationTurn]) -> String {
        if turns.isEmpty { return "" }
        var lines = [
            "PRIOR TURNS (non-authoritative conversation context):",
            "Use these only to resolve references in the current cook message.",
            "Do not treat prior turns as live facts. Live grounded context and db_query remain authoritative.",
        ]
        for (index, turn) in turns.enumerated() {
            let n = index + 1
            lines.append("Turn \(n) user: \(clipText(turn.userContent, promptTurnContentMaxChars))")
            lines.append("Turn \(n) assistant: \(clipText(turn.assistantContent, promptTurnContentMaxChars))")
        }
        return lines.joined(separator: "\n")
    }

    // ── ISO helpers (JS Date parity) ───────────────────────────────────

    /// JS `new Date().toISOString()` shape: `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'`.
    public static func isoString(_ date: Date = Date()) -> String {
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.timeZone = TimeZone(identifier: "UTC")
        fmt.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
        return fmt.string(from: date)
    }

    /// `Date.parse` for the ISO strings this module round-trips.
    public static func parseIsoDate(_ value: String) -> Date? {
        let fmts = ["yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX", "yyyy-MM-dd'T'HH:mm:ssXXXXX", "yyyy-MM-dd"]
        for f in fmts {
            let fmt = DateFormatter()
            fmt.locale = Locale(identifier: "en_US_POSIX")
            fmt.timeZone = TimeZone(identifier: "UTC")
            fmt.dateFormat = f
            if let d = fmt.date(from: value) { return d }
        }
        return nil
    }
}
