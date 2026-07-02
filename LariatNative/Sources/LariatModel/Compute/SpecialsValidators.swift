import Foundation

/// Byte-parity port of `lib/specialsValidators.ts` — pure validators for the
/// saved-specials persistence layer. No I/O, no DB. Error copy matches the web
/// module verbatim (it surfaces in operator-facing UI).
///
/// Type-system note: the web guards `typeof input !== 'string'` /
/// `typeof input !== 'number'` branches exist because JSON bodies are untyped;
/// Swift callers are statically typed so those branches vanish. Length checks
/// use UTF-16 code units to match JS `String.prototype.length` / `.slice`.
public enum SpecialsValidationError: Error, Equatable, Sendable, LocalizedError {
    case nameRequired
    case nameTooLong
    case slugLength
    case slugCharset
    case yieldQtyInvalid
    case yieldUnitRequired
    case yieldUnitTooLong
    case categoryTooLong
    case invalidJson(field: String)

    public var errorDescription: String? {
        switch self {
        case .nameRequired: return "name required"
        case .nameTooLong: return "name max \(SpecialsValidators.nameMax) chars"
        case .slugLength: return "slug 1–\(SpecialsValidators.slugMax) chars"
        case .slugCharset: return "slug must match ^[a-z0-9-]+$"
        case .yieldQtyInvalid: return "yield_qty must be a positive finite number"
        case .yieldUnitRequired: return "yield_unit required"
        case .yieldUnitTooLong: return "yield_unit max \(SpecialsValidators.yieldUnitMax) chars"
        case .categoryTooLong: return "category max \(SpecialsValidators.categoryMax) chars"
        case .invalidJson(let field): return "invalid \(field) JSON"
        }
    }
}

public enum SpecialsValidators {
    public static let nameMax = 200
    public static let slugMax = 80
    public static let yieldUnitMax = 32
    /// Route-layer cap on the export `category` field
    /// (`app/api/specials/saved/[id]/export/route.js` CATEGORY_MAX).
    public static let categoryMax = 64

    /// Length caps on user-editable text fields (web SCRATCH_NOTES_MAX etc.).
    /// `ai_answer` is intentionally NOT capped — clipping mid-LLM-response
    /// would corrupt the recipe / cost breakdown (web comment, audit §5).
    public static let scratchNotesMax = 4000
    public static let pantryTextMax = 4000
    public static let promptTextMax = 2000

    /// List-view snippet cap (`app/api/specials/saved/route.js` SNIPPET_MAX).
    public static let snippetMax = 120

    static let allowedPatchKeys: Set<String> = ["name", "scratch_notes"]

    private static let slugRegex = try! NSRegularExpression(pattern: "^[a-z0-9-]+$")

    // MARK: clipText

    /// `clipText` — empty string for nil/empty; slice to `max` UTF-16 units.
    public static func clipText(_ input: String?, max: Int) -> String {
        guard let input, !input.isEmpty else { return "" }
        return sliceUTF16(input, max: max)
    }

    /// JS `String.prototype.slice(0, max)` over UTF-16 code units. If the cut
    /// would split a surrogate pair, back off one unit (JS keeps the lone
    /// surrogate, which is an invalid string — dropping it is the closest
    /// well-formed behavior).
    static func sliceUTF16(_ s: String, max: Int) -> String {
        guard max > 0 else { return "" }
        guard s.utf16.count > max else { return s }
        var units = Array(s.utf16.prefix(max))
        if let last = units.last, (0xD800...0xDBFF).contains(last) { units.removeLast() }
        return String(utf16CodeUnits: units, count: units.count)
    }

    static func utf16Length(_ s: String) -> Int { s.utf16.count }

    // MARK: validateName

    public static func validateName(_ input: String) throws -> String {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { throw SpecialsValidationError.nameRequired }
        if utf16Length(trimmed) > nameMax { throw SpecialsValidationError.nameTooLong }
        return trimmed
    }

    // MARK: validateSlug

    public static func validateSlug(_ input: String) throws -> String {
        let len = utf16Length(input)
        if len < 1 || len > slugMax { throw SpecialsValidationError.slugLength }
        let range = NSRange(input.startIndex..., in: input)
        if slugRegex.firstMatch(in: input, range: range) == nil {
            throw SpecialsValidationError.slugCharset
        }
        return input
    }

    // MARK: validateYieldQty

    public static func validateYieldQty(_ input: Double) throws -> Double {
        if !input.isFinite || input <= 0 { throw SpecialsValidationError.yieldQtyInvalid }
        return input
    }

    // MARK: validateYieldUnit

    public static func validateYieldUnit(_ input: String) throws -> String {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { throw SpecialsValidationError.yieldUnitRequired }
        if utf16Length(trimmed) > yieldUnitMax { throw SpecialsValidationError.yieldUnitTooLong }
        return trimmed
    }

    // MARK: validateCategory (export route layer)

    public static func validateCategory(_ input: String?) throws -> String {
        guard let input else { return "" }
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if utf16Length(trimmed) > categoryMax { throw SpecialsValidationError.categoryTooLong }
        return trimmed
    }

    // MARK: validatePatchKeys

    public struct PatchKeyResult: Equatable, Sendable {
        public let ok: Bool
        public let rejected: [String]
    }

    /// Empty body → not ok with empty `rejected` (the route maps that to
    /// "no fields to update"); unknown keys → not ok listing them.
    public static func validatePatchKeys(_ keys: [String]) -> PatchKeyResult {
        if keys.isEmpty { return PatchKeyResult(ok: false, rejected: []) }
        let rejected = keys.filter { !allowedPatchKeys.contains($0) }
        if !rejected.isEmpty { return PatchKeyResult(ok: false, rejected: rejected) }
        return PatchKeyResult(ok: true, rejected: [])
    }

    // MARK: validateJsonField

    /// `coerceJsonField` string/null branches: nil → nil; a string must parse
    /// as JSON and is stored verbatim. (The web's object branch serializes an
    /// already-parsed JS body value — a JSON-transport concern with no native
    /// analogue; native callers hand the repository a JSON string or nil.)
    public static func validateJsonField(_ raw: String?, field: String) throws -> String? {
        guard let raw else { return nil }
        guard let data = raw.data(using: .utf8),
              (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])) != nil
        else {
            throw SpecialsValidationError.invalidJson(field: field)
        }
        return raw
    }

    // MARK: snippet

    /// List-view snippet: collapse whitespace runs to one space, trim, cap at
    /// 120 UTF-16 units (`app/api/specials/saved/route.js snippet()`).
    public static func snippet(_ s: String?) -> String {
        guard let s else { return "" }
        let collapsed = s.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return sliceUTF16(collapsed, max: snippetMax)
    }
}
