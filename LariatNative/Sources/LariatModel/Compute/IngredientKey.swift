import Foundation

/// Byte-exact Swift mirror of `lib/ingredientKey.ts::normalizeIngredientKey`
/// (itself a mirror of `scripts/lib/ingredient_key.py` — Python is authoritative).
/// Parity oracle: `tests/fixtures/ingredient_key_parity.json`, loaded verbatim by
/// `IngredientKeyComputeTests`.
///
/// This is the UNIQUE conflict key for inventory count lines: two cooks counting
/// "Chicken Stock" vs "chicken stock" must land on the SAME `inventory_count_lines`
/// row (`UNIQUE(count_id, ingredient, sku)`), so the normalization has to agree
/// with the web route bit-for-bit or a single ingredient splits into two rows.
///
/// Algorithm — matches the JS String operations on raw code units:
///   1. lower-case — Unicode default, locale-independent (`İ` U+0130 → "i" + U+0307,
///      exactly like JS `String.prototype.toLowerCase`)
///   2. trim leading/trailing whitespace (ECMA-262 WhiteSpace ∪ LineTerminator)
///   3. strip a leading bracketed prefix `^\s*\[[^\]]*\]\s*`
///   4. replace every run of non-`[a-z0-9]` with a single space, then trim
///   5. collapse whitespace runs to a single space
///
/// It deliberately does NOT apply Unicode NFC/NFD normalization: a precomposed
/// "ñ" (U+00F1) collapses to a separator ("jalape o") while a decomposed "n"+U+0303
/// keeps the n ("jalapen o"). Both encodings appear in the parity fixture; matching
/// the raw-code-unit behavior is the whole point.
public enum IngredientKey {
    public static func normalize(_ value: String?) -> String {
        guard let value else { return "" }
        // 1. lower-case (String.lowercased is full Unicode, locale-independent —
        //    no NFC/NFD normalization, matching JS toLowerCase).
        let scalars = Array(value.lowercased().unicodeScalars)

        // 2. trim JS-whitespace from both ends, then
        // 3. strip a leading `[ ... ]` bracket prefix.
        var start = 0
        var end = scalars.count
        while start < end, isJSWhitespace(scalars[start]) { start += 1 }
        while end > start, isJSWhitespace(scalars[end - 1]) { end -= 1 }
        // Only when the first non-space scalar is '[' AND a closing ']' follows
        // (matches `\[[^\]]*\]`; an unclosed '[' is left in place). Whitespace
        // after ']' is dropped by step 4's leading-trim, so we needn't skip it here.
        if start < end, scalars[start] == "[" {
            var j = start + 1
            while j < end, scalars[j] != "]" { j += 1 }
            if j < end { start = j + 1 }   // found the matching ']' → drop through it
        }

        // 4 + 5. Emit alnum scalars verbatim; every maximal run of non-alnum
        // becomes exactly one space; leading/trailing runs are dropped (trim).
        let space: Unicode.Scalar = " "
        var out = String.UnicodeScalarView()
        var pendingSpace = false
        var started = false
        for i in start..<end {
            let sc = scalars[i]
            if isAsciiAlnum(sc) {
                if pendingSpace { out.append(space) }
                out.append(sc)
                started = true
                pendingSpace = false
            } else if started {
                pendingSpace = true
            }
        }
        return String(out)
    }

    /// ASCII `[a-z0-9]`. The input is already lower-cased, so only lower-case ASCII
    /// letters can reach here (upper-case was folded in step 1).
    private static func isAsciiAlnum(_ s: Unicode.Scalar) -> Bool {
        (s.value >= 0x61 && s.value <= 0x7A) || (s.value >= 0x30 && s.value <= 0x39)
    }

    /// ECMA-262 String whitespace = WhiteSpace ∪ LineTerminator (what JS `.trim()`
    /// and regex `\s` strip). Enumerated explicitly so trimming stays identical to
    /// the web helper regardless of ICU whitespace-category drift.
    private static func isJSWhitespace(_ s: Unicode.Scalar) -> Bool {
        switch s.value {
        case 0x09, 0x0A, 0x0B, 0x0C, 0x0D,   // TAB LF VT FF CR
             0x20,                            // SPACE
             0xA0,                            // NBSP
             0x1680,                          // OGHAM SPACE MARK
             0x2000...0x200A,                 // EN QUAD … HAIR SPACE
             0x2028, 0x2029,                  // LINE / PARAGRAPH SEPARATOR
             0x202F,                          // NARROW NBSP
             0x205F,                          // MEDIUM MATHEMATICAL SPACE
             0x3000,                          // IDEOGRAPHIC SPACE
             0xFEFF:                          // ZERO WIDTH NO-BREAK SPACE (BOM)
            return true
        default:
            return false
        }
    }
}
