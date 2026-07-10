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
}
