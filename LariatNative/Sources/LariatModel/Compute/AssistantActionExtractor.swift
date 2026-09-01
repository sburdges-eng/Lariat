import Foundation

/// Port of `lib/extractAction.ts` — the shared LLM action-JSON parser.
///
/// Scans EVERY balanced top-level JSON object in `content` (string-aware,
/// escape-aware brace scan), keeps the first that parses and has a string
/// `action` field as the payload, and returns the content with ALL parsed
/// objects removed + code fences stripped. Stripping every object (not just
/// the payload) is a safety guarantee: a model that double-emits the action
/// JSON must never leak a raw `{"action":…}` block into the cook-facing
/// answer (KA v3 rollout found a fine-tune that double-emitted scale_recipe).
public enum AssistantActionExtractor {
    public struct Result: Sendable, Equatable {
        public let payload: AssistantActionPayload?
        public let stripped: String

        public init(payload: AssistantActionPayload?, stripped: String) {
            self.payload = payload
            self.stripped = stripped
        }
    }

    /// `stripFences(s)` — removes ```json / ``` fences and trims.
    public static func stripFences(_ s: String) -> String {
        var out = s
        // `/```(?:json)?\s*/gi` then `/```/g`
        let fenceRe = try! NSRegularExpression(pattern: "```(?:json)?\\s*", options: [.caseInsensitive])
        out = fenceRe.stringByReplacingMatches(
            in: out, options: [], range: NSRange(out.startIndex..., in: out), withTemplate: ""
        )
        out = out.replacingOccurrences(of: "```", with: "")
        return out.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// `extractAction(content)` parity.
    public static func extractAction(_ content: String) -> Result {
        let chars = Array(content)

        // Collect every balanced top-level {…} span (start...end inclusive, parsed dict).
        struct Span { let start: Int; let end: Int; let dict: [String: Any] }
        var spans: [Span] = []
        var i = 0
        while i < chars.count {
            if chars[i] != "{" { i += 1; continue }
            let start = i
            var depth = 0
            var inStr = false
            var esc = false
            var end = -1
            var j = start
            while j < chars.count {
                let ch = chars[j]
                if esc { esc = false; j += 1; continue }
                if ch == "\\" { esc = true; j += 1; continue }
                if ch == "\"" { inStr.toggle(); j += 1; continue }
                if inStr { j += 1; continue }
                if ch == "{" { depth += 1 }
                else if ch == "}" {
                    depth -= 1
                    if depth == 0 { end = j; break }
                }
                j += 1
            }
            if end < 0 { break } // unbalanced tail — leave the rest untouched
            let jsonText = String(chars[start...end])
            if let data = jsonText.data(using: .utf8),
               let parsed = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]),
               let dict = parsed as? [String: Any] {
                spans.append(Span(start: start, end: end, dict: dict))
            }
            // objects that fail JSON parse (e.g. prose braces) are NOT recorded → kept in prose
            i = end + 1
        }

        // First action-bearing object is the payload.
        let payloadSpan = spans.first { $0.dict["action"] is String }

        // Remove EVERY parsed object from the prose (back-to-front to keep indices valid).
        var kept = chars
        for s in spans.sorted(by: { $0.start > $1.start }) {
            kept.removeSubrange(s.start...s.end)
        }
        let stripped = stripFences(String(kept))

        guard let span = payloadSpan, let action = span.dict["action"] as? String else {
            return Result(payload: nil, stripped: stripped)
        }
        var fields: [String: AssistantJSONValue] = [:]
        for (k, v) in span.dict where k != "action" {
            fields[k] = AssistantJSONValue.from(any: v)
        }
        return Result(
            payload: AssistantActionPayload(action: action, fields: fields),
            stripped: stripped
        )
    }

    /// Port of `isDegenerateAnswer` in lib/extractAction.ts (2026-08-31 "pico"
    /// find): the model mimicked the CONTEXT's XML shape and looped
    /// (`<ingredient name="diced shallot" />` ×12) until the token cap.
    ///
    /// Two signals, either one disqualifies. Keep this byte-parallel with the
    /// web twin — see that file for why each clause is shaped the way it is.
    ///
    /// Newlines are normalized before splitting. `split(separator: "\n")` does
    /// NOT split CRLF, because "\r\n" is a single grapheme cluster in Swift: a
    /// CRLF answer collapsed to one line and the repeat signal could never fire
    /// here while it fired on web. That was a fail-open divergence on iPad.
    ///
    /// Line length is measured in UTF-16 units to match JS `String.length`;
    /// `count` (grapheme clusters) disagreed with the web twin on emoji and
    /// combining marks.
    public static func isDegenerateAnswer(_ text: String) -> Bool {
        if text.isEmpty { return false }
        let tagPattern = try! NSRegularExpression(
            pattern: "</?[a-z][a-z0-9]*(?:[-:_][a-z0-9]+)*(?:\\s[^<>]{0,80})?/?>",
            options: [.caseInsensitive])
        let tagCount = tagPattern.numberOfMatches(
            in: text, options: [], range: NSRange(text.startIndex..., in: text))
        if tagCount >= markupTagMin { return true }

        let normalized = text
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")

        var prev: String? = nil
        var run = 0
        var counts: [String: Int] = [:]
        var nonEmpty = 0
        for raw in normalized.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if !line.isEmpty { nonEmpty += 1 }
            if line.utf16.count < repeatLineMinLen || isTableRow(line) {
                prev = nil
                run = 0
                continue
            }
            run = (line == prev) ? run + 1 : 1
            prev = line
            if run >= repeatRunMin { return true }
            counts[line] = (counts[line] ?? 0) + 1
        }

        var repeated = 0
        for n in counts.values where n >= repeatRunMin { repeated += n }
        return nonEmpty > 0 && Double(repeated) / Double(nonEmpty) >= repeatDominanceMin
    }

    private static let markupTagMin = 5
    private static let repeatLineMinLen = 8
    private static let repeatRunMin = 4
    private static let repeatDominanceMin = 0.5

    /// A markdown table row — real data repeats these legitimately.
    private static func isTableRow(_ line: String) -> Bool {
        line.count > 1 && line.hasPrefix("|") && line.hasSuffix("|")
    }
}
