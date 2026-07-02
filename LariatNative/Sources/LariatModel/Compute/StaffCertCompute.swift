import Foundation

// Pure (no I/O) validation + tone math for the staff-certifications board.
// Ports the shape rules of `app/api/certifications/route.js` (clip / cert_type
// allow-set / YYYY-MM-DD guard / patchable-column projection) and the tone
// thresholds of `CertBoard.jsx`'s `withStatus`.
//
// The tone thresholds are DELIBERATELY identical to the private
// `CommandCompute.classifyCerts` / `midnightLocal` logic — local-midnight parse
// of `yyyy-MM-dd`, whole-day floor via `floor((exp - now)/86400)`, `<0` red /
// `<=30` amber — so this board and the Command cert-expiry alert never disagree.
// `classifyCerts` is `private` in CommandCompute (and must not be edited), so
// the day-delta helper is re-derived here byte-for-byte rather than shared.
//
// Compliance: CO 6 CCR 1010-2 §2-102 (CFPM on duty during service).

public enum StaffCertCompute {

    /// CO 6 CCR 1010-2 §2-102 — a Certified Food Protection Manager must be on
    /// duty during service. Carried for parity with the board subtitle copy.
    public static let citation = "CO 6 CCR 1010-2 §2-102"

    /// `^\d{4}-\d{2}-\d{2}$` — the route's `dateRe`. Optional dates that are
    /// present must match this or the write is rejected (web 400).
    private static let dateRe = try! NSRegularExpression(pattern: #"^\d{4}-\d{2}-\d{2}$"#)

    // MARK: - String clipping (parity with route `clip`)

    /// `clip(s, max)`: non-string → nil; trim → null-if-empty → prefix(max).
    /// Swift receives already-typed `String?`, so the "non-string → nil" arm is
    /// modeled as the nil input.
    public static func clip(_ s: String?, max: Int) -> String? {
        guard let s else { return nil }
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : String(t.prefix(max))
    }

    /// True iff a present date string matches `YYYY-MM-DD`. `nil` is allowed
    /// (optional field). Mirrors `issued_on && !dateRe.test(...)` — an empty /
    /// whitespace value has already been clipped to nil upstream.
    public static func isValidDate(_ s: String?) -> Bool {
        guard let s else { return true }
        let range = NSRange(s.startIndex..., in: s)
        return dateRe.firstMatch(in: s, range: range) != nil
    }

    // MARK: - cert_type allow-set (parity with route CERT_TYPES + DB CHECK)

    /// Parse + validate the cert_type BEFORE any INSERT. Returns the canonical
    /// `StaffCertType` or nil for out-of-set (so the repository throws
    /// `validationFailed`, never a raw SQLite CHECK error). Input is clipped to
    /// 32 chars first (parity with `clip(body.cert_type, 32)`).
    public static func parseCertType(_ raw: String?) -> StaffCertType? {
        guard let clipped = clip(raw, max: 32) else { return nil }
        return StaffCertType(rawValue: clipped)
    }

    // MARK: - Tone classification (parity with CommandCompute.classifyCerts)

    /// `new Date(s + 'T00:00:00')` — local-midnight parse (no Z). Cert deltas are
    /// whole-day differences so the timezone offset cancels. IDENTICAL to
    /// `CommandCompute.midnightLocal`.
    private static let localCalDay: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone.current
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    private static func midnightLocal(_ ymd: String) -> Date? { localCalDay.date(from: ymd) }

    /// Whole-day floor delta from `today` to `expires`. `nil` when either date is
    /// unparseable or `expires` is nil. `days = floor((exp - now)/86400)` — the
    /// exact CommandCompute formula.
    public static func daysUntilExpiry(today: String, expires: String?) -> Int? {
        guard let expires, let now = midnightLocal(today), let exp = midnightLocal(expires) else {
            return nil
        }
        return Int(floor((exp.timeIntervalSince1970 - now.timeIntervalSince1970) / 86400.0))
    }

    /// Tone for one cert row — mirrors `CertBoard.jsx`'s `withStatus`:
    /// inactive → muted; no expiry / unparseable → muted; `<0` red; `<=30` amber;
    /// else green. The `<0`/`<=30` cutoffs match `classifyCerts` (expired vs
    /// expiring-30d) so the board and the Command alert never disagree.
    public static func tone(active: Int, expiresOn: String?, today: String) -> StaffCertTone {
        if active == 0 { return .muted }
        guard let days = daysUntilExpiry(today: today, expires: expiresOn) else { return .muted }
        if days < 0 { return .red }
        if days <= 30 { return .amber }
        return .green
    }
}
