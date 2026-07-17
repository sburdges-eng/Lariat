import Foundation

/// Portable canonical JSON — the byte-for-byte rule the cloud-bridge envelope
/// signs, mirroring lib/cloudBridgeCanonical.ts. Keys sorted recursively, no
/// whitespace, forward slash NOT escaped, integers only (a float throws, as on
/// the web side — the pushable tables carry money as integer cents).
public enum JSONValue: Equatable {
    case object([String: JSONValue])
    case array([JSONValue])
    case string(String)
    case int(Int64)
    case bool(Bool)
    case null
}

public enum CanonicalJSONError: Error, Equatable {
    /// A non-integer / non-finite number reached the codec.
    case unsupportedNumber
    /// An integer-like object key (e.g. "10"). JS engines reorder these
    /// numerically, diverging from a lexicographic sort — rejected fail-loud to
    /// stay a faithful twin of lib/cloudBridgeCanonical.ts's guard.
    case integerLikeKey(String)
}

extension JSONValue: Decodable {
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let i = try? c.decode(Int64.self) { self = .int(i); return }
        // A number that isn't an integer decodes as Double → reject (fail-loud).
        if (try? c.decode(Double.self)) != nil { throw CanonicalJSONError.unsupportedNumber }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let a = try? c.decode([JSONValue].self) { self = .array(a); return }
        if let o = try? c.decode([String: JSONValue].self) { self = .object(o); return }
        throw CanonicalJSONError.unsupportedNumber
    }
}

public enum CanonicalJSON {
    public static func encode(_ value: JSONValue) throws -> String {
        switch value {
        case .object(let dict):
            let parts = try dict.keys.sorted().map { key -> String in
                // Integer-like keys are reordered numerically by JS engines,
                // diverging from this lexicographic sort — reject fail-loud to
                // stay a faithful twin of lib/cloudBridgeCanonical.ts.
                if key.range(of: "^(0|[1-9][0-9]*)$", options: .regularExpression) != nil {
                    throw CanonicalJSONError.integerLikeKey(key)
                }
                return "\(encodeString(key)):\(try encode(dict[key]!))"
            }
            return "{\(parts.joined(separator: ","))}"
        case .array(let items):
            return "[\(try items.map { try encode($0) }.joined(separator: ","))]"
        case .string(let s):
            return encodeString(s)
        case .int(let n):
            return String(n)
        case .bool(let b):
            return b ? "true" : "false"
        case .null:
            return "null"
        }
    }

    /// Escapes per JSON.stringify: " \ and C0 controls; forward slash NOT
    /// escaped; non-ASCII emitted raw.
    static func encodeString(_ s: String) -> String {
        var out = "\""
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\u{08}": out += "\\b"
            case "\u{09}": out += "\\t"
            case "\u{0A}": out += "\\n"
            case "\u{0C}": out += "\\f"
            case "\u{0D}": out += "\\r"
            default:
                if scalar.value < 0x20 { out += String(format: "\\u%04x", scalar.value) }
                else { out.unicodeScalars.append(scalar) }
            }
        }
        return out + "\""
    }
}
