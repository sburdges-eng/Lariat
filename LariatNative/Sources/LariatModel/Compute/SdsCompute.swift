import Foundation

// Port of `lib/sds.ts` — SDS-registry validation (paired with POST /api/sds).
//
// Safety Data Sheets are required by OSHA's Hazard Communication Standard
// (29 CFR 1910.1200). `sds_registry.product_name` is NOT NULL; everything else
// is optional. The validator type-checks each field, range-checks length against
// the web route's clip() limits, enforces the GHS hazard-class enum (HCS 2012
// Annex 1), validates last_reviewed as a REAL ISO calendar date, and validates
// url as http(s). Pure module: no I/O, no DB, no clock read. Numbers/citations
// and messages match the JS rule module exactly — see tests/js/test-sds-rules.mjs.

public enum SdsCompute {

    // ── Citations (single source of truth — parity with lib/sds.ts) ────

    /// OSHA HazCom — the SDS regulation itself.
    public static let citation =
        "OSHA 29 CFR 1910.1200 — Hazard Communication Standard (HCS 2012, GHS-aligned)"

    /// §1910.1200(g) — employer must maintain SDSes for each hazardous chemical
    /// and ensure they are readily accessible to employees on every shift.
    public static let retentionCitation =
        "OSHA 29 CFR 1910.1200(g) — SDS for each hazardous chemical, accessible to employees on every shift"

    // ── GHS hazard-class enum (HCS 2012 Annex 1) ──────────────────────

    /// Container-label hazard class. Collapsed to the inspector-facing top level
    /// used on Lariat's printed binder index. Accepted case-insensitively and
    /// canonicalized to lowercase. Order matches `GHS_HAZARD_CLASSES` in lib/sds.ts
    /// so the error message enumerates them in the same order.
    public static let ghsHazardClasses: [String] = [
        "flammable",
        "oxidizer",
        "corrosive",
        "toxic",
        "irritant",
        "health_hazard",
        "environmental",
        "compressed_gas",
        "explosive",
    ]

    private static let ghsHazardSet = Set(ghsHazardClasses)

    // ── Field-length bounds (mirror the route's clip() limits) ────────

    public static let productNameMaxLen = 200
    public static let manufacturerMaxLen = 200
    public static let hazardClassMaxLen = 100
    public static let storageLocationMaxLen = 200
    public static let pdfPathMaxLen = 300
    public static let urlMaxLen = 300
    public static let cookIdMaxLen = 64
    public static let lastReviewedMaxLen = 32

    // ── Normalized output ─────────────────────────────────────────────

    /// Normalized snapshot mirroring the JS `NormalizedSds`. All strings trimmed;
    /// absent optional fields are nil. `hazardClass` is canonicalized to its
    /// lowercase enum value when present. `active` is 0/1 or nil (route defaults 1).
    public struct NormalizedSds: Sendable, Equatable {
        public let productName: String
        public let manufacturer: String?
        public let hazardClass: String?
        public let storageLocation: String?
        public let pdfPath: String?
        public let url: String?
        public let lastReviewed: String?
        public let active: Int?
        public let cookId: String?
    }

    /// Validation result — mirrors the JS `ValidateResult` discriminated union.
    public enum ValidateResult: Sendable, Equatable {
        case ok(NormalizedSds)
        case failure(String)

        public var isOk: Bool { if case .ok = self { return true }; return false }
        public var reason: String? { if case .failure(let r) = self { return r }; return nil }
        public var value: NormalizedSds? { if case .ok(let v) = self { return v }; return nil }
    }

    // ── Helpers ───────────────────────────────────────────────────────

    private static let isoDateRE = try! NSRegularExpression(pattern: "^\\d{4}-\\d{2}-\\d{2}$")

    private static func matchesIsoDate(_ s: String) -> Bool {
        let range = NSRange(s.startIndex..<s.endIndex, in: s)
        return isoDateRE.firstMatch(in: s, range: range) != nil
    }

    /// Outcome of an optional-string field check. Mirrors the JS
    /// `{ ok, value } | { ok: false, reason }` shape without needing an
    /// `Error`-conforming failure type.
    private enum FieldCheck {
        case value(String?)
        case failed(String)
    }

    /// Optional-string check: nil ⇒ value(nil); non-string is impossible in
    /// Swift's typed input, so this only length-bounds + trims. (The JS
    /// type-check for non-string values is exercised at the decoding boundary.)
    private static func checkOptionalString(
        _ v: String?, field: String, maxLen: Int
    ) -> FieldCheck {
        guard let v else { return .value(nil) }
        if v.count > maxLen {
            return .failed("\(field) length \(v.count) exceeds the \(maxLen)-char limit")
        }
        let trimmed = v.trimmingCharacters(in: .whitespacesAndNewlines)
        return .value(trimmed.isEmpty ? nil : trimmed)
    }

    // ── Validator (parity with validateSds) ───────────────────────────

    public static func validate(
        productName: String?,
        manufacturer: String? = nil,
        hazardClass: String? = nil,
        storageLocation: String? = nil,
        pdfPath: String? = nil,
        url: String? = nil,
        lastReviewed: String? = nil,
        active: Bool? = nil,
        cookId: String? = nil
    ) -> ValidateResult {
        // 1. product_name — required, non-empty, length-bounded.
        guard let productName else {
            return .failure("product_name is required")
        }
        if productName.count > productNameMaxLen {
            return .failure("product_name length \(productName.count) exceeds the \(productNameMaxLen)-char limit")
        }
        let productNameValue = productName.trimmingCharacters(in: .whitespacesAndNewlines)
        if productNameValue.isEmpty {
            return .failure("product_name is required")
        }

        // 2. manufacturer — optional string.
        let mfr: String?
        switch checkOptionalString(manufacturer, field: "manufacturer", maxLen: manufacturerMaxLen) {
        case .failed(let r): return .failure(r)
        case .value(let v): mfr = v
        }

        // 3. hazard_class — optional, must be in the GHS enum (case-insensitive).
        var hazardClassValue: String? = nil
        if let hazardClass {
            if hazardClass.count > hazardClassMaxLen {
                return .failure("hazard_class length \(hazardClass.count) exceeds the \(hazardClassMaxLen)-char limit")
            }
            let candidate = hazardClass.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if !candidate.isEmpty {
                if !ghsHazardSet.contains(candidate) {
                    return .failure("hazard_class must be one of: \(ghsHazardClasses.joined(separator: ", "))")
                }
                hazardClassValue = candidate
            }
        }

        // 4. storage_location — optional string.
        let storage: String?
        switch checkOptionalString(storageLocation, field: "storage_location", maxLen: storageLocationMaxLen) {
        case .failed(let r): return .failure(r)
        case .value(let v): storage = v
        }

        // 5. pdf_path — optional string.
        let pdf: String?
        switch checkOptionalString(pdfPath, field: "pdf_path", maxLen: pdfPathMaxLen) {
        case .failed(let r): return .failure(r)
        case .value(let v): pdf = v
        }

        // 6. url — optional, must be http(s) if present.
        var urlValue: String? = nil
        if let url {
            if url.count > urlMaxLen {
                return .failure("url length \(url.count) exceeds the \(urlMaxLen)-char limit")
            }
            let trimmedUrl = url.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmedUrl.isEmpty {
                let lower = trimmedUrl.lowercased()
                if !(lower.hasPrefix("http://") || lower.hasPrefix("https://")) {
                    return .failure("url must start with http:// or https://")
                }
                urlValue = trimmedUrl
            }
        }

        // 7. last_reviewed — optional, must be a REAL YYYY-MM-DD calendar date.
        var lastReviewedValue: String? = nil
        if let lastReviewed {
            if lastReviewed.count > lastReviewedMaxLen {
                return .failure("last_reviewed length \(lastReviewed.count) exceeds the \(lastReviewedMaxLen)-char limit")
            }
            if !matchesIsoDate(lastReviewed) {
                return .failure("last_reviewed must match YYYY-MM-DD")
            }
            // Round-trip parse to catch phantom dates like 2026-02-30 (JS Date.parse
            // silently normalizes them). Parity with lib/dateMarks.ts::parseDateStrict.
            if !isRealCalendarDate(lastReviewed) {
                return .failure("last_reviewed is not a real calendar date")
            }
            lastReviewedValue = lastReviewed
        }

        // 8. active — optional boolean → 0/1.
        var activeValue: Int? = nil
        if let active {
            activeValue = active ? 1 : 0
        }

        // 9. cook_id — optional string.
        let cook: String?
        switch checkOptionalString(cookId, field: "cook_id", maxLen: cookIdMaxLen) {
        case .failed(let r): return .failure(r)
        case .value(let v): cook = v
        }

        return .ok(NormalizedSds(
            productName: productNameValue,
            manufacturer: mfr,
            hazardClass: hazardClassValue,
            storageLocation: storage,
            pdfPath: pdf,
            url: urlValue,
            lastReviewed: lastReviewedValue,
            active: activeValue,
            cookId: cook
        ))
    }

    /// True when `s` (already known to match YYYY-MM-DD) names a real calendar
    /// date. Rejects phantom dates (2026-02-30, 2025-13-01, 2026-04-31) the way
    /// the JS validator does by round-tripping Y/M/D through a UTC calendar.
    static func isRealCalendarDate(_ s: String) -> Bool {
        let parts = s.split(separator: "-").map { Int($0) }
        guard parts.count == 3, let y = parts[0], let m = parts[1], let d = parts[2] else {
            return false
        }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let comps = DateComponents(year: y, month: m, day: d)
        guard let date = calendar.date(from: comps) else { return false }
        let round = calendar.dateComponents([.year, .month, .day], from: date)
        return round.year == y && round.month == m && round.day == d
    }
}
