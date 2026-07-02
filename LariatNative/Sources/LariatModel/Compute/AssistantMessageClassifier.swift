import Foundation

/// Port of `lib/cookMessageClassifier.ts` — deterministic Q-vs-C routing so the
/// LLM never decides in-prompt whether "86" is a verb or a noun.
///
/// Bias: ambiguous → question. Any `?` forces question. Keep the verb lists in
/// sync with the action schemas in the assistant action repository.
public enum AssistantMessageClassifier {
    /// `QUESTION_LEAD_RE`
    private static let questionLead = try! NSRegularExpression(
        pattern: "^(what|when|where|how|why|who|which|is|are|am|was|were|do|does|did|can|could|should|would|will|may|might|have|has|had)\\b",
        options: [.caseInsensitive]
    )

    /// `IMPERATIVE_LEAD_RE`
    private static let imperativeLead = try! NSRegularExpression(
        pattern: "^(86|eighty[\\s-]?six|log|mark|add|give|set|update|record|note|reject|receive|reorder|order|adjust|scale|prep|generate)\\b",
        options: [.caseInsensitive]
    )

    /// `PIN_REQUIRED_LEAD_RE` — note: no `update` / `generate` (those have their
    /// own qualified patterns so read-like imperatives still reach the LLM).
    private static let pinRequiredLead = try! NSRegularExpression(
        pattern: "^(86|eighty[\\s-]?six|log|mark|add|give|set|record|note|reject|receive|reorder|order|adjust|scale|prep)\\b",
        options: [.caseInsensitive]
    )

    /// `PIN_REQUIRED_UPDATE_RE`
    private static let pinRequiredUpdate = try! NSRegularExpression(
        pattern: "^update\\s+(inventory|order(?:\\s+guide)?|par|prep|line|station|count|counts|quantity|qty)\\b",
        options: [.caseInsensitive]
    )

    /// `PIN_REQUIRED_GENERATE_RE`
    private static let pinRequiredGenerate = try! NSRegularExpression(
        pattern: "^generate\\s+(?:a\\s+)?(?:dynamic\\s+)?prep(?:\\s+list|\\s+for|\\b)",
        options: [.caseInsensitive]
    )

    private static func matches(_ re: NSRegularExpression, _ s: String) -> Bool {
        re.firstMatch(in: s, options: [], range: NSRange(s.startIndex..., in: s)) != nil
    }

    /// `isImperativeCommand(message)` parity.
    public static func isImperativeCommand(_ message: String?) -> Bool {
        guard let message else { return false }
        let m = message.trimmingCharacters(in: .whitespacesAndNewlines)
        if m.isEmpty { return false }
        if m.contains("?") { return false }
        if matches(questionLead, m) { return false }
        if matches(imperativeLead, m) { return true }
        return false
    }

    /// `requiresPinBeforeLlm(message)` parity — #248 short-circuit before Ollama.
    public static func requiresPinBeforeLlm(_ message: String?) -> Bool {
        guard isImperativeCommand(message), let message else { return false }
        let m = message.trimmingCharacters(in: .whitespacesAndNewlines)
        return matches(pinRequiredLead, m)
            || matches(pinRequiredUpdate, m)
            || matches(pinRequiredGenerate, m)
    }
}
