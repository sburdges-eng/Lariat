import Foundation

// Port of `lib/receiving.ts` — receiving-log temp-check rules (F3 / FDA
// §3-202.11, §3-202.15, §3-101.11, §3-501.16). Every delivery to the back door
// lands here: a truck temp is taken, package integrity eyeballed, the sell-by
// date checked, and one of three decisions is recorded (accept / accept-with-note
// / reject). This module is pure — no DB, no side effects; the repository wraps
// it with the persistence + audit hooks. Thresholds/citations match the JS rule
// module EXACTLY — see tests/js/test-receiving-rules.mjs for the pins.

/// Well-known receiving categories — mirrors JS `RECEIVING_CATEGORIES`. Order is
/// load-bearing (drives the tile grid + the board's default category).
public enum ReceivingCategory: String, CaseIterable, Sendable, Equatable {
    case refrigerated
    case frozen
    case shellEggs = "shell_eggs"
    case hotHeld = "hot_held"
    case dryGoods = "dry_goods"
    case produce
    case shellfish
}

/// Per-category rule — mirrors JS `ReceivingCategoryRule`.
public struct ReceivingCategoryRule: Sendable, Equatable {
    public let id: ReceivingCategory
    public let label: String
    /// Lowest acceptable reading in °F. nil = no floor.
    public let requiredMinF: Double?
    /// Highest acceptable reading in °F. nil = no ceiling.
    public let requiredMaxF: Double?
    /// Upper "accept-with-note" band. Above `requiredMaxF` but ≤ `driftMaxF`
    /// → accept-with-note; above `driftMaxF` → rejected outright.
    public let driftMaxF: Double?
    /// Lower "accept-with-note" band (used for hot-held: 135°F floor, 130°F drift).
    public let driftMinF: Double?
    /// True if a `reading_f` value must be provided at receiving. False for dry
    /// goods and produce where temp is not a CCP.
    public let requiresReading: Bool
    /// FDA §-cite surfaced in the board tile + docs table.
    public let citation: String
}

/// Library-level decision status — mirrors JS `ReceivingStatus`.
public enum ReceivingStatus: String, Sendable, Equatable {
    case ok
    case rejected
    case acceptWithNote = "accept_with_note"
}

/// DB `status` column value — mirrors JS `'accepted' | 'rejected' | 'accepted_with_note'`.
public enum ReceivingDbStatus: String, Sendable, Equatable {
    case accepted
    case rejected
    case acceptedWithNote = "accepted_with_note"
}

/// Tile tone — mirrors JS `ReceivingTileStatus`.
public enum ReceivingTileStatus: String, Sendable, Equatable {
    case green
    case yellow
    case red
    case gray
}

/// Input to `validateReceivingReading` — mirrors JS `ValidateReceivingInput`.
/// `category` is the raw string (may be unknown); the route hard-400s unknown
/// categories upstream but the pure rule stays non-throwing for orphan input.
public struct ReceivingReadingInput: Sendable {
    public let category: String?
    public let readingF: Double?
    public let packageOk: Bool?
    public let expirationDate: String?
    public let receivedAt: String?
    public let receivedQty: Double?
    /// nil OR non-nil sentinel. `.some(nil)` cannot exist; blank strings are
    /// treated as "absent" (matches JS `''` handling).
    public let receivedUnit: String?

    public init(
        category: String?,
        readingF: Double? = nil,
        packageOk: Bool? = nil,
        expirationDate: String? = nil,
        receivedAt: String? = nil,
        receivedQty: Double? = nil,
        receivedUnit: String? = nil
    ) {
        self.category = category
        self.readingF = readingF
        self.packageOk = packageOk
        self.expirationDate = expirationDate
        self.receivedAt = receivedAt
        self.receivedQty = receivedQty
        self.receivedUnit = receivedUnit
    }
}

/// Result of `validateReceivingReading` — mirrors JS `ValidateReceivingResult`.
public struct ReceivingReadingResult: Sendable, Equatable {
    public let status: ReceivingStatus
    public let reason: String?
    public let citation: String?
    public let requiredMaxF: Double?
    /// Non-nil when caller provided `receivedQty`/`receivedUnit` that didn't
    /// type-check. This is a 400-class INPUT error, NOT a HACCP rule decision,
    /// so it travels separately from `status`.
    public let closedLoopError: String?
}

/// One receiving_log-shaped row for the tile aggregator — mirrors JS `ReceivingRow`.
public struct ReceivingClassifyRow: Sendable, Equatable {
    public let category: String
    /// DB status string: 'accepted' | 'rejected' | 'accepted_with_note'.
    public let status: String
    public let createdAt: String?

    public init(category: String, status: String, createdAt: String? = nil) {
        self.category = category
        self.status = status
        self.createdAt = createdAt
    }
}

/// Per-category tile summary — mirrors JS `CategorySummary`.
public struct ReceivingCategorySummary: Sendable, Equatable, Identifiable {
    public let category: ReceivingCategory
    public let label: String
    public let citation: String
    public let requiresReading: Bool
    public let requiredMaxF: Double?
    public let requiredMinF: Double?
    public let driftMaxF: Double?
    public let driftMinF: Double?
    public let total: Int
    public let accepted: Int
    public let acceptedWithNote: Int
    public let rejected: Int
    public let status: ReceivingTileStatus
    public let lastAt: String?

    public var id: ReceivingCategory { category }
}

public enum ReceivingCompute {
    // Absolute sanity range for readings (broken probe / typo guard) — mirrors
    // JS ABS_MIN_F / ABS_MAX_F.
    static let absoluteMinF: Double = -100
    static let absoluteMaxF: Double = 500

    /// Max corrective/rejection note length — web rejects longer with a 400.
    public static let correctiveNoteMaxLength = 500
    /// Max received_unit length (closed-loop) — web rejects longer with a 400.
    public static let receivedUnitMaxLength = 32

    /// The rule table, keyed by category. Numbers/citations are authoritative in
    /// the web `lib/` module — ported verbatim.
    public static let rules: [ReceivingCategory: ReceivingCategoryRule] = [
        .refrigerated: ReceivingCategoryRule(
            id: .refrigerated, label: "Refrigerated",
            requiredMinF: nil, requiredMaxF: 41, driftMaxF: 45, driftMinF: nil,
            requiresReading: true,
            citation: "FDA §3-202.11(B) / §3-501.16(A)(2) — PHF/TCS cold at receiving ≤ 41°F"
        ),
        .frozen: ReceivingCategoryRule(
            id: .frozen, label: "Frozen",
            requiredMinF: nil, requiredMaxF: 10, driftMaxF: 25, driftMinF: nil,
            requiresReading: true,
            citation: "FDA §3-202.11(C) — frozen PHF/TCS received frozen (≤ 10°F practical; >25°F reject as thawed)"
        ),
        .shellEggs: ReceivingCategoryRule(
            id: .shellEggs, label: "Shell eggs",
            requiredMinF: nil, requiredMaxF: 45, driftMaxF: 50, driftMinF: nil,
            requiresReading: true,
            citation: "FDA §3-202.11(A) — shell eggs received at ≤ 45°F ambient air"
        ),
        .hotHeld: ReceivingCategoryRule(
            id: .hotHeld, label: "Hot-held",
            requiredMinF: 135, requiredMaxF: nil, driftMaxF: nil, driftMinF: 130,
            requiresReading: true,
            citation: "FDA §3-202.11(D) / §3-501.16(A)(1) — hot-held at receiving ≥ 135°F"
        ),
        .dryGoods: ReceivingCategoryRule(
            id: .dryGoods, label: "Dry goods",
            requiredMinF: nil, requiredMaxF: nil, driftMaxF: nil, driftMinF: nil,
            requiresReading: false,
            citation: "FDA §3-202.15 — package integrity; §3-101.11 safe/unadulterated"
        ),
        .produce: ReceivingCategoryRule(
            id: .produce, label: "Produce",
            requiredMinF: nil, requiredMaxF: nil, driftMaxF: nil, driftMinF: nil,
            requiresReading: false,
            citation: "FDA §3-202.15 package integrity; §3-202.110 cut leafy greens 41°F (if pre-cut)"
        ),
        .shellfish: ReceivingCategoryRule(
            id: .shellfish, label: "Shellfish (shellstock)",
            requiredMinF: nil, requiredMaxF: 45, driftMaxF: 50, driftMinF: nil,
            requiresReading: true,
            citation: "FDA §3-202.11(F) — shellstock ≤ 45°F; §3-203.12 — 90-day tag retention"
        ),
    ]

    /// Category ids in registry order (mirrors `RECEIVING_CATEGORIES`).
    public static let categories: [ReceivingCategory] = ReceivingCategory.allCases

    /// Mirror of `getReceivingRule`. Returns nil for unknown/non-string category.
    public static func rule(for category: String?) -> ReceivingCategoryRule? {
        guard let category, let cat = ReceivingCategory(rawValue: category) else { return nil }
        return rules[cat]
    }

    // ── Closed-loop field check (mirror of `checkClosedLoopFields`) ────

    /// Type/range-check the optional inventory fields. Returns nil when both are
    /// absent (opt-out) OR both valid; a 400-class error string when malformed.
    static func checkClosedLoopFields(qty: Double?, unit: String?) -> String? {
        let qtyProvided = qty != nil
        let unitTrimmed = unit?.trimmingCharacters(in: .whitespacesAndNewlines)
        let unitProvided = (unitTrimmed?.isEmpty == false)
        if !qtyProvided && !unitProvided { return nil }

        guard let qtyNum = qty, qtyNum.isFinite else {
            return "received_qty must be a number when capturing closed-loop receiving"
        }
        if !(qtyNum > 0) {
            // Match JS "got ${qtyNum}" — integral values render without a decimal.
            return "received_qty must be greater than 0 (got \(numberText(qtyNum)))"
        }
        guard let unitStr = unitTrimmed, !unitStr.isEmpty else {
            return "received_unit must be a non-empty string when received_qty is provided"
        }
        if unitStr.count > receivedUnitMaxLength {
            return "received_unit too long (max 32 chars; got \(unitStr.count))"
        }
        return nil
    }

    // ── Core decision (mirror of `validateReceivingReading`) ───────────

    /// Pure decision function. No DB, no clock read. Decision order matches the
    /// JS rule module exactly (first match wins).
    public static func validateReceivingReading(_ input: ReceivingReadingInput) -> ReceivingReadingResult {
        let closedLoopError = checkClosedLoopFields(qty: input.receivedQty, unit: input.receivedUnit)

        guard let rule = rule(for: input.category) else {
            // Unknown category → soft accept-with-note (non-throwing path for
            // orphan categories). The route hard-400s these upstream.
            return ReceivingReadingResult(
                status: .acceptWithNote,
                reason: "Unknown category — accept with note",
                citation: nil,
                requiredMaxF: nil,
                closedLoopError: closedLoopError
            )
        }

        // §3-202.15 — compromised package is an outright rejection.
        if input.packageOk == false {
            return ReceivingReadingResult(
                status: .rejected,
                reason: "package integrity compromised — reject per §3-202.15",
                citation: "FDA §3-202.15 — package integrity",
                requiredMaxF: rule.requiredMaxF,
                closedLoopError: closedLoopError
            )
        }

        // §3-101.11 — food past code-required safety date is adulterated.
        if let exp = trimmedNonEmpty(input.expirationDate) {
            if let received = trimmedNonEmpty(input.receivedAt), exp < received {
                return ReceivingReadingResult(
                    status: .rejected,
                    reason: "past sell-by date (\(exp) < \(received)) — reject per §3-101.11",
                    citation: "FDA §3-101.11 — safe, unadulterated, honestly presented",
                    requiredMaxF: rule.requiredMaxF,
                    closedLoopError: closedLoopError
                )
            }
        }

        // Categories without a temp CCP stop here.
        if !rule.requiresReading {
            return ReceivingReadingResult(
                status: .ok, reason: nil, citation: nil,
                requiredMaxF: rule.requiredMaxF, closedLoopError: closedLoopError
            )
        }

        guard let r = input.readingF, r.isFinite else {
            return ReceivingReadingResult(
                status: .rejected,
                reason: "\(rule.label) requires a temperature reading at receiving — no reading recorded",
                citation: rule.citation,
                requiredMaxF: rule.requiredMaxF,
                closedLoopError: closedLoopError
            )
        }
        if r < absoluteMinF || r > absoluteMaxF {
            return ReceivingReadingResult(
                status: .rejected,
                reason: "reading \(numberText(r))°F is off the charts — check the probe and re-take",
                citation: rule.citation,
                requiredMaxF: rule.requiredMaxF,
                closedLoopError: closedLoopError
            )
        }

        let min = rule.requiredMinF
        let max = rule.requiredMaxF
        let dMin = rule.driftMinF
        let dMax = rule.driftMaxF

        // Too-warm side.
        if let max, r > max {
            if let dMax, r <= dMax {
                return ReceivingReadingResult(
                    status: .acceptWithNote,
                    reason: "\(numberText(r))°F is above the \(numberText(max))°F limit but within the \(numberText(dMax))°F drift band — accept only with a corrective action",
                    citation: rule.citation,
                    requiredMaxF: max,
                    closedLoopError: closedLoopError
                )
            }
            return ReceivingReadingResult(
                status: .rejected,
                reason: "\(numberText(r))°F exceeds the \(numberText(dMax ?? max))°F reject limit for \(rule.label)",
                citation: rule.citation,
                requiredMaxF: max,
                closedLoopError: closedLoopError
            )
        }

        // Too-cold side (e.g. hot-held arriving cool).
        if let min, r < min {
            if let dMin, r >= dMin {
                return ReceivingReadingResult(
                    status: .acceptWithNote,
                    reason: "\(numberText(r))°F is below the \(numberText(min))°F floor but within the \(numberText(dMin))°F drift band — accept only with a corrective action",
                    citation: rule.citation,
                    requiredMaxF: max,
                    closedLoopError: closedLoopError
                )
            }
            return ReceivingReadingResult(
                status: .rejected,
                reason: "\(numberText(r))°F is below the \(numberText(dMin ?? min))°F reject floor for \(rule.label)",
                citation: rule.citation,
                requiredMaxF: max,
                closedLoopError: closedLoopError
            )
        }

        return ReceivingReadingResult(
            status: .ok, reason: nil, citation: nil,
            requiredMaxF: max, closedLoopError: closedLoopError
        )
    }

    // ── Tile aggregator (mirror of `classifyDeliveries`) ───────────────

    /// Aggregate today's receiving rows into one tile per known category. Rows
    /// with an unknown category are silently dropped. `expectAllCategories`
    /// (default true) renders a gray tile for every category with no rows.
    public static func classifyDeliveries(
        _ rows: [ReceivingClassifyRow],
        expectAllCategories: Bool = true
    ) -> [ReceivingCategorySummary] {
        var grouped: [ReceivingCategory: [ReceivingClassifyRow]] = [:]
        for r in rows {
            guard let rule = rule(for: r.category) else { continue }
            grouped[rule.id, default: []].append(r)
        }

        // `expectAllCategories` false ⇒ only categories that appeared, in
        // first-seen order (mirrors JS `Array.from(grouped.keys())`).
        let catIds: [ReceivingCategory]
        if expectAllCategories {
            catIds = categories
        } else {
            var seen: [ReceivingCategory] = []
            for r in rows {
                guard let rule = rule(for: r.category) else { continue }
                if !seen.contains(rule.id) { seen.append(rule.id) }
            }
            catIds = seen
        }

        var out: [ReceivingCategorySummary] = []
        for id in catIds {
            guard let rule = rules[id] else { continue }
            let bucket = grouped[id] ?? []
            var accepted = 0, withNote = 0, rejected = 0
            var lastAt: String?
            for r in bucket {
                switch r.status {
                case "accepted": accepted += 1
                case "accepted_with_note": withNote += 1
                case "rejected": rejected += 1
                default: break
                }
                if let at = r.createdAt, (lastAt == nil || at > lastAt!) { lastAt = at }
            }
            let status: ReceivingTileStatus
            if rejected > 0 { status = .red }
            else if withNote > 0 { status = .yellow }
            else if accepted > 0 { status = .green }
            else { status = .gray }

            out.append(ReceivingCategorySummary(
                category: id, label: rule.label, citation: rule.citation,
                requiresReading: rule.requiresReading,
                requiredMaxF: rule.requiredMaxF, requiredMinF: rule.requiredMinF,
                driftMaxF: rule.driftMaxF, driftMinF: rule.driftMinF,
                total: bucket.count, accepted: accepted, acceptedWithNote: withNote,
                rejected: rejected, status: status, lastAt: lastAt
            ))
        }
        return out
    }

    // ── Status helpers (mirror of `dbStatusFor` / `libStatusFor`) ──────

    public static func dbStatus(for status: ReceivingStatus) -> ReceivingDbStatus {
        switch status {
        case .ok: return .accepted
        case .rejected: return .rejected
        case .acceptWithNote: return .acceptedWithNote
        }
    }

    public static func libStatus(for dbStatus: String) -> ReceivingStatus {
        switch dbStatus {
        case "accepted": return .ok
        case "accepted_with_note": return .acceptWithNote
        default: return .rejected
        }
    }

    // ── shared string helpers ──────────────────────────────────────────

    private static func trimmedNonEmpty(_ value: String?) -> String? {
        guard let value else { return nil }
        let t = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    /// Render a Double the way JS string-interpolates a number: integral values
    /// have no trailing `.0` (e.g. `41`, not `41.0`), fractional values keep
    /// their digits (e.g. `43.5`).
    static func numberText(_ v: Double) -> String {
        if v == v.rounded() && abs(v) < 1e15 {
            return String(Int64(v))
        }
        // Match JS Number → string for non-integral values.
        return String(format: "%g", v)
    }
}
