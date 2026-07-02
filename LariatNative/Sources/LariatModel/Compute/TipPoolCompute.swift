import Foundation

// Port of `lib/tipPool.ts` — Colorado COMPS Order #39 §3.3, §3.4 + FLSA tip
// credit (29 CFR 531.52) for the A3 tip-pool board (L3).
//
// Citations:
// - 7 CCR 1103-1 (COMPS Order #39) §3.3 — tip credit, tipped minimum wage,
//   written-notice + makeup obligations.
// - 7 CCR 1103-1 §3.4 — pool-eligibility (must exclude managers/non-tipped
//   staff); employees retain ownership of tips.
// - 29 CFR 531.52 — federal FLSA tip-credit rules.
//
// Money is INTEGER CENTS in this module — never `Double` dollars. Floating-
// point rounding on tips is exactly how FLSA collective actions start. The DB
// schema (`tip_pool_distributions.amount_cents INTEGER NOT NULL`) enforces this
// on the storage side; this module re-checks.
//
// The tip-credit makeup math is ASYMMETRIC: tips/hour floors DOWN (round the
// per-hour tip contribution against the employee) and the total makeup ceils
// UP (employer never short-changes on a sub-cent artifact). The
// `2410¢/8h → 8¢` case is the rounding tripwire — see
// `tests/js/test-tip-pool-rules.mjs`.

/// Colorado COMPS #39 2026 figures (verify annually via CDLE rulemaking).
public enum TipPoolCompute {
    /// Standard minimum wage — $14.81/h (2026). Verify annually.
    public static let stdMinWageCents2026 = 1481
    /// Tipped minimum wage — $11.79/h (2026). Verify annually.
    public static let tippedMinWageCents2026 = 1179
    /// Maximum tip credit — $3.02/h (2026). Verify annually.
    public static let tipCreditCents2026 = 302
    /// Compliance citation — byte-exact, asserted by the parity test.
    public static let citation = "7 CCR 1103-1 §3.3 / §3.4 (COMPS Order #39); 29 CFR 531.52"

    /// Roles whose holders MUST be excluded from a non-traditional tip pool
    /// under COMPS §3.4 (managers, supervisors, owners). Kept short and
    /// conservative; downstream code composes role + flag.
    public static let excludedRoles: Set<String> = [
        "manager",
        "general_manager",
        "gm",
        "owner",
        "executive_chef",
        "sous_chef_manager",
    ]

    // ── Pool eligibility ──────────────────────────────────────────────

    /// COMPS §3.4 / FLSA: tip pools may NOT include managers, supervisors, or
    /// owners. `staffFlags` are the ACTIVE flag rows for the cook (the
    /// `effective_to IS NULL` filter is applied upstream, but this helper ALSO
    /// re-checks: an expired flag — `effectiveTo != nil` — does NOT exclude).
    /// `role` is the cook's role on the given shift — both are checked because a
    /// cook can be promoted mid-period and the role lookup catches the new state
    /// before the flag history is updated. Case-insensitive.
    public static func isPoolEligible(_ staffFlags: [StaffFlag], role: String?) -> Bool {
        if let role, excludedRoles.contains(role.lowercased()) { return false }
        for f in staffFlags {
            if f.effectiveTo != nil { continue }
            let flag = f.flag.lowercased()
            if flag == "manager" || flag == "supervisor" || flag == "owner" || flag == "exempt" {
                return false
            }
        }
        return true
    }

    // ── Tip-credit period validation ──────────────────────────────────

    /// COMPS §3.3 / FLSA tip-credit math: the employer may pay the lower tipped
    /// minimum wage if (cash wage + tips) over the period averages at least the
    /// standard minimum wage. If it falls short, the employer owes the makeup.
    ///
    /// Returns `ok=true, makeupCents=0` when compliant; `ok=false, makeupCents>0`
    /// when the employer owes the makeup. All money in INTEGER CENTS; hours are
    /// a real number (timesheets are typically tenths of an hour).
    ///
    /// ASYMMETRIC ROUNDING (do NOT collapse to away-from-zero):
    ///   - `tipsPerHour = floor(tips / hours)`  (round DOWN, against employee)
    ///   - `makeup      = ceil(shortfall * hours)` (round UP, employer bears)
    public static func validateTipCreditPeriod(_ input: TipCreditPeriodInput) -> TipCreditResult {
        let requiredFloor = input.tippedMinWageCents + input.tipCreditCents

        // Integer-cents invariant. (All four money fields are typed `Int`, so a
        // non-integer literal cannot reach here from Swift call sites — the check
        // is kept for parity with the JS `isInt` guard and to document intent.)
        if !input.hoursWorked.isFinite || input.hoursWorked < 0 {
            return TipCreditResult(
                ok: false, makeupCents: 0, effectiveHourlyCents: 0,
                requiredFloorCents: requiredFloor,
                reason: "hours_worked must be a non-negative number"
            )
        }
        if input.hourlyWageCents < input.tippedMinWageCents {
            return TipCreditResult(
                ok: false, makeupCents: 0, effectiveHourlyCents: 0,
                requiredFloorCents: requiredFloor,
                reason: "cash wage \(input.hourlyWageCents)¢/h is below tipped minimum (\(input.tippedMinWageCents)¢/h)"
            )
        }
        if input.hoursWorked == 0 {
            return TipCreditResult(
                ok: true, makeupCents: 0, effectiveHourlyCents: input.hourlyWageCents,
                requiredFloorCents: requiredFloor, reason: nil
            )
        }

        // tips/h in integer cents — round DOWN (floor). `Math.floor` in JS.
        let tipsPerHourCents = Int((Double(input.tipsReceivedCents) / input.hoursWorked).rounded(.down))
        let effectiveHourlyCents = input.hourlyWageCents + tipsPerHourCents
        let shortfallPerHour = requiredFloor - effectiveHourlyCents
        if shortfallPerHour <= 0 {
            return TipCreditResult(
                ok: true, makeupCents: 0, effectiveHourlyCents: effectiveHourlyCents,
                requiredFloorCents: requiredFloor, reason: nil
            )
        }
        // Total makeup: round UP (ceil) so the employer never short-changes by a
        // sub-cent rounding artifact. `Math.ceil` in JS.
        let makeupCents = Int((Double(shortfallPerHour) * input.hoursWorked).rounded(.up))
        return TipCreditResult(
            ok: false, makeupCents: makeupCents, effectiveHourlyCents: effectiveHourlyCents,
            requiredFloorCents: requiredFloor,
            reason: "tips + cash wage averaged \(effectiveHourlyCents)¢/h, below \(requiredFloor)¢/h floor"
        )
    }

    // ── Pool summary ──────────────────────────────────────────────────

    /// Aggregate distributions into total, per-cook totals, and per-kind totals.
    /// Pure integer summation. Non-representable amounts (impossible with `Int`,
    /// but the semantic skip-guard is kept for parity with the JS `isInt`
    /// defense-in-depth) are skipped. The `by_kind` map is seeded with all three
    /// kinds at 0 so an empty pool returns explicit zeros (matches the JS shape).
    public static func summarizePool(_ distributions: [TipDistributionRow]) -> PoolSummary {
        var byCook: [String: Int] = [:]
        var byKind: [TipKind: Int] = [.tip_pool: 0, .service_charge: 0, .direct_tip: 0]
        var total = 0
        for row in distributions {
            // `Int` cannot be non-integer; the guard mirrors the JS `isInt` skip.
            total += row.amountCents
            byCook[row.cookId, default: 0] += row.amountCents
            byKind[row.kind, default: 0] += row.amountCents
        }
        return PoolSummary(totalCents: total, byCook: byCook, byKind: byKind)
    }

    // ── Row validation ────────────────────────────────────────────────

    /// Cheap shape guard for the write path. Confirms `amount_cents` is a
    /// non-negative INTEGER (zero allowed), `kind` is one of the three allowed
    /// values, `shift_date` matches `^\d{4}-\d{2}-\d{2}$`, and `pool_ref`/`cook_id`
    /// are non-empty. Run BEFORE touching the DB so a bad row never reaches the
    /// CHECK constraint. Parity with the JS `validateDistributionShape`.
    public static func validateDistributionShape(_ input: DistributionShape) -> DistributionValidation {
        guard let shiftDate = input.shiftDate, isYMD(shiftDate) else {
            return DistributionValidation(ok: false, reason: "shift_date must be YYYY-MM-DD")
        }
        guard let poolRef = input.poolRef, !poolRef.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return DistributionValidation(ok: false, reason: "pool_ref is required")
        }
        guard let cookId = input.cookId, !cookId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return DistributionValidation(ok: false, reason: "cook_id is required")
        }
        guard let kind = input.kind, TipKind(rawValue: kind) != nil else {
            return DistributionValidation(ok: false, reason: "kind must be tip_pool, service_charge, or direct_tip")
        }
        guard let amount = input.amountCents, amount >= 0 else {
            return DistributionValidation(ok: false, reason: "amount_cents must be a non-negative integer (cents — no floats)")
        }
        return DistributionValidation(ok: true, reason: nil)
    }

    /// `^\d{4}-\d{2}-\d{2}$`.
    static func isYMD(_ s: String) -> Bool {
        let parts = s.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2 else { return false }
        return parts.allSatisfy { $0.allSatisfy(\.isNumber) }
    }
}

// ── Value types (mirror the JS interfaces in lib/tipPool.ts) ──────────

/// One of the three distribution categories — matches the DB CHECK constraint
/// and the JS `TipKind` union.
public enum TipKind: String, Codable, Sendable, Equatable, Hashable, CaseIterable {
    case tip_pool
    case service_charge
    case direct_tip
}

/// Active/expired staff flag the eligibility helper reads. `effectiveTo == nil`
/// means the flag is currently active. Mirrors the JS `StaffFlag`.
public struct StaffFlag: Sendable, Equatable {
    public let cookId: String
    public let flag: String
    public let effectiveTo: String?

    public init(cookId: String, flag: String, effectiveTo: String?) {
        self.cookId = cookId
        self.flag = flag
        self.effectiveTo = effectiveTo
    }
}

/// Input to the tip-credit period math. Money is `Int` cents; hours is `Double`.
/// Mirrors the JS `TipCreditPeriodInput`.
public struct TipCreditPeriodInput: Sendable, Equatable {
    public let tippedMinWageCents: Int
    public let tipCreditCents: Int
    public let hourlyWageCents: Int
    public let tipsReceivedCents: Int
    public let hoursWorked: Double

    public init(
        tippedMinWageCents: Int,
        tipCreditCents: Int,
        hourlyWageCents: Int,
        tipsReceivedCents: Int,
        hoursWorked: Double
    ) {
        self.tippedMinWageCents = tippedMinWageCents
        self.tipCreditCents = tipCreditCents
        self.hourlyWageCents = hourlyWageCents
        self.tipsReceivedCents = tipsReceivedCents
        self.hoursWorked = hoursWorked
    }
}

/// Result of the tip-credit period math. Mirrors the JS `TipCreditResult`.
public struct TipCreditResult: Sendable, Equatable {
    public let ok: Bool
    public let makeupCents: Int
    public let effectiveHourlyCents: Int
    public let requiredFloorCents: Int
    public let reason: String?

    public init(ok: Bool, makeupCents: Int, effectiveHourlyCents: Int, requiredFloorCents: Int, reason: String?) {
        self.ok = ok
        self.makeupCents = makeupCents
        self.effectiveHourlyCents = effectiveHourlyCents
        self.requiredFloorCents = requiredFloorCents
        self.reason = reason
    }
}

/// Aggregate summary of a pool. Mirrors the JS `PoolSummary`.
public struct PoolSummary: Sendable, Equatable {
    public let totalCents: Int
    public let byCook: [String: Int]
    public let byKind: [TipKind: Int]

    public init(totalCents: Int, byCook: [String: Int], byKind: [TipKind: Int]) {
        self.totalCents = totalCents
        self.byCook = byCook
        self.byKind = byKind
    }
}

/// Loose input to the shape validator (fields optional, as they arrive from a
/// write request). Mirrors the JS `DistributionShape`.
public struct DistributionShape: Sendable, Equatable {
    public let shiftDate: String?
    public let poolRef: String?
    public let cookId: String?
    public let role: String?
    public let kind: String?
    public let amountCents: Int?
    public let note: String?

    public init(
        shiftDate: String?,
        poolRef: String?,
        cookId: String?,
        role: String? = nil,
        kind: String?,
        amountCents: Int?,
        note: String? = nil
    ) {
        self.shiftDate = shiftDate
        self.poolRef = poolRef
        self.cookId = cookId
        self.role = role
        self.kind = kind
        self.amountCents = amountCents
        self.note = note
    }
}

/// Result of the shape validator. Mirrors the JS `DistributionValidation`.
public struct DistributionValidation: Sendable, Equatable {
    public let ok: Bool
    public let reason: String?

    public init(ok: Bool, reason: String?) {
        self.ok = ok
        self.reason = reason
    }
}
