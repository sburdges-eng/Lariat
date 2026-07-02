import Foundation

/// Port of `lib/extractAction.ts` — the shared LLM action-JSON parser.
///
/// Finds the first balanced JSON object in `content` (string-aware, escape-aware
/// brace scan), parses it, requires a string `action` field, and returns the
/// content with the JSON block removed + code fences stripped.
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
        guard let braceStart = chars.firstIndex(of: "{") else {
            return Result(payload: nil, stripped: stripFences(content))
        }

        var depth = 0
        var inStr = false
        var esc = false
        var end = -1
        var i = braceStart
        while i < chars.count {
            let ch = chars[i]
            if esc { esc = false; i += 1; continue }
            if ch == "\\" { esc = true; i += 1; continue }
            if ch == "\"" { inStr.toggle(); i += 1; continue }
            if inStr { i += 1; continue }
            if ch == "{" { depth += 1 }
            else if ch == "}" {
                depth -= 1
                if depth == 0 { end = i; break }
            }
            i += 1
        }
        if end < 0 { return Result(payload: nil, stripped: stripFences(content)) }

        let jsonText = String(chars[braceStart...end])
        guard let data = jsonText.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]),
              let dict = parsed as? [String: Any],
              let action = dict["action"] as? String
        else {
            return Result(payload: nil, stripped: stripFences(content))
        }

        var fields: [String: AssistantJSONValue] = [:]
        for (k, v) in dict where k != "action" {
            fields[k] = AssistantJSONValue.from(any: v)
        }
        let remainder = String(chars[..<braceStart]) + String(chars[(end + 1)...])
        return Result(
            payload: AssistantActionPayload(action: action, fields: fields),
            stripped: stripFences(remainder)
        )
    }
}
