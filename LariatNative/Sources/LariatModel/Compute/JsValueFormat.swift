import Foundation

/// JS-interop value formatting shared by the A6.3 ports.
///
/// Two web behaviors have to be reproduced byte-for-byte because their output
/// is either hashed (allergen fingerprints) or written into rows the web app
/// re-reads (CSV export, `components_json`):
///
///  1. `String(number)` / `JSON.stringify(number)` — JS prints integral doubles
///     without a decimal point ("2", not "2.0") and non-integral doubles with
///     the shortest round-trip form ("0.2607938891256041"). Swift's `Double`
///     `description` is also shortest-round-trip, so only the integral case
///     needs special handling.
///  2. `JSON.stringify(string)` — escapes `"`, `\`, and control characters
///     (`\b \t \n \f \r`, else `\u00xx`), leaves everything else (including
///     non-ASCII) raw.
public enum JsValueFormat {
    /// JS number → string for finite doubles (`String(n)` semantics).
    /// Integral values inside the contiguous-integer range print without a
    /// fractional part; everything else uses shortest round-trip.
    public static func numberString(_ value: Double) -> String {
        guard value.isFinite else {
            // JS prints "NaN" / "Infinity"; callers should not feed these.
            return value.isNaN ? "NaN" : (value > 0 ? "Infinity" : "-Infinity")
        }
        if value == value.rounded(), abs(value) < 9_007_199_254_740_992 {
            return String(Int64(value))
        }
        return "\(value)"
    }

    /// `JSON.stringify` of a string value, including the surrounding quotes.
    public static func jsonString(_ value: String) -> String {
        var out = "\""
        for scalar in value.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\u{08}": out += "\\b"
            case "\u{09}": out += "\\t"
            case "\u{0A}": out += "\\n"
            case "\u{0C}": out += "\\f"
            case "\u{0D}": out += "\\r"
            default:
                if scalar.value < 0x20 {
                    out += String(format: "\\u%04x", scalar.value)
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        out += "\""
        return out
    }

    /// `JSON.stringify` of an array of strings (no whitespace, JS escaping).
    public static func jsonStringArray(_ values: [String]) -> String {
        "[" + values.map(jsonString).joined(separator: ",") + "]"
    }

    /// JS default `Array.prototype.sort()` — lexicographic by UTF-16 code unit.
    public static func jsSorted(_ values: [String]) -> [String] {
        values.sorted { a, b in
            let au = Array(a.utf16), bu = Array(b.utf16)
            for i in 0..<min(au.count, bu.count) {
                if au[i] != bu[i] { return au[i] < bu[i] }
            }
            return au.count < bu.count
        }
    }
}
