import Foundation

// Deal-point parser + talent payout math — value-parity port of
// `lib/dealPoints.ts` plus the PUT /deal route's `validateDeal`. No I/O.
// Money is INTEGER cents end-to-end; USD→cents conversion rounds at the
// boundary; ONLY the vs bonus floors (venue-favorable — see below).

public enum DealPointsCompute {
    /// Web `emptyDeal()`.
    public static func emptyDeal() -> DealPoint {
        DealPoint(guaranteeCents: 0, vsPctAfterCosts: nil, costsOffTop: [], buyoutCents: 0)
    }

    /// Web `parseDeal(row)` — converts a `show_deals` row into a `DealPoint`.
    /// Throws `.badDealRow` on malformed `costs_off_top_json` with the web's
    /// "parseDeal: bad costs_off_top_json — …" message shape.
    public static func parseDeal(_ row: ShowDealRow) throws -> DealPoint {
        let costs: [DealCost]
        do {
            guard let data = row.costsOffTopJson.data(using: .utf8),
                  let parsed = try? JSONSerialization.jsonObject(with: data) else {
                throw SettlementError.badDealRow("not valid JSON")
            }
            guard let arr = parsed as? [Any] else {
                throw SettlementError.badDealRow("costs_off_top_json must be an array")
            }
            costs = try arr.enumerated().map { i, item in
                guard let obj = item as? [String: Any],
                      let label = obj["label"] as? String,
                      let centsNum = obj["cents"] as? NSNumber,
                      CFGetTypeID(centsNum) != CFBooleanGetTypeID() else {
                    throw SettlementError.badDealRow("costs_off_top_json[\(i)] missing label/cents")
                }
                return DealCost(label: label, cents: Int(jsRound(centsNum.doubleValue)))
            }
        } catch let e as SettlementError {
            if case .badDealRow(let msg) = e {
                throw SettlementError.badDealRow("parseDeal: bad costs_off_top_json — \(msg)")
            }
            throw e
        }
        return DealPoint(
            guaranteeCents: row.guaranteeCents,
            vsPctAfterCosts: row.vsPctAfterCosts,
            costsOffTop: costs,
            buyoutCents: row.buyoutCents
        )
    }

    // ── External / raw-JSON deal shape (USD) ──────────────────────────

    /// Web `parseDealTerms(dealJson)` — defensive parser for an unknown JSON
    /// blob (pass the `JSONSerialization` value). Throws `.invalidDealShape`
    /// with the exact web "InvalidDealShape: …" messages.
    public static func parseDealTerms(_ dealJson: Any?) throws -> DealTerms {
        guard let raw = dealJson as? [String: Any] else {
            throw SettlementError.invalidDealShape("InvalidDealShape: deal must be a non-null object")
        }

        guard raw.keys.contains("guarantee_usd") else {
            throw SettlementError.invalidDealShape("InvalidDealShape: guarantee_usd is required")
        }
        let guarantee = try assertNumeric(raw["guarantee_usd"], "guarantee_usd")
        if guarantee < 0 {
            throw SettlementError.invalidDealShape("InvalidDealShape: guarantee_usd must be >= 0")
        }

        var vsPct: Double?? = nil
        if raw.keys.contains("vs_pct_after_costs") {
            if raw["vs_pct_after_costs"] is NSNull {
                vsPct = .some(nil)
            } else {
                let pct = try assertNumeric(raw["vs_pct_after_costs"], "vs_pct_after_costs")
                if pct < 0 || pct > 1 {
                    throw SettlementError.invalidDealShape("InvalidDealShape: vs_pct_after_costs must be in [0, 1]")
                }
                vsPct = .some(pct)
            }
        }

        var costsOffTop: [DealTermsCostItem]?
        // Web parity: an explicit JSON null is REJECTED ("must be an array") —
        // only an absent key means no costs. Don't conflate null with undefined.
        if let costsRaw = raw["costs_off_top"] {
            guard let arr = costsRaw as? [Any] else {
                throw SettlementError.invalidDealShape("InvalidDealShape: costs_off_top must be an array")
            }
            costsOffTop = try arr.enumerated().map { i, item in
                guard let obj = item as? [String: Any] else {
                    throw SettlementError.invalidDealShape("InvalidDealShape: costs_off_top[\(i)] must be an object")
                }
                guard let label = obj["label"] as? String else {
                    throw SettlementError.invalidDealShape("InvalidDealShape: costs_off_top[\(i)].label must be a string")
                }
                let amount = try assertNumeric(obj["amount_usd"], "costs_off_top[\(i)].amount_usd")
                return DealTermsCostItem(label: label, amountUsd: amount)
            }
        }

        var buyoutUsd: Double?
        // Web parity: explicit null throws ("must be a finite number"); only an
        // absent key means no buyout. assertNumeric rejects NSNull for us.
        if let buyoutRaw = raw["buyout_usd"] {
            let b = try assertNumeric(buyoutRaw, "buyout_usd")
            if b < 0 {
                throw SettlementError.invalidDealShape("InvalidDealShape: buyout_usd must be >= 0")
            }
            buyoutUsd = b
        }

        return DealTerms(
            guaranteeUsd: guarantee,
            vsPctAfterCosts: vsPct,
            costsOffTop: costsOffTop,
            buyoutUsd: buyoutUsd
        )
    }

    /// Web `dealTermsToDealPoint(terms)` — USD → cents; round at this
    /// boundary so downstream math is always integer cents.
    public static func dealTermsToDealPoint(_ terms: DealTerms) -> DealPoint {
        DealPoint(
            guaranteeCents: Int(jsRound(terms.guaranteeUsd * 100)),
            vsPctAfterCosts: terms.vsPctAfterCosts.flatMap { $0 },
            costsOffTop: (terms.costsOffTop ?? []).map {
                DealCost(label: $0.label, cents: Int(jsRound($0.amountUsd * 100)))
            },
            buyoutCents: Int(jsRound((terms.buyoutUsd ?? 0) * 100))
        )
    }

    // ── Payout math ───────────────────────────────────────────────────

    /// Web `computeTalentPayout`. Rounding convention — venue-favorable
    /// floor: `Math.floor(overage × vsPct)` is intentional; on any non-clean
    /// overage the talent loses the fractional cent per show (long-running
    /// deal-buyer convention; docs/PHASE2_PLAN.md §B; 2026-05-02 breaker §5
    /// P3 finding). The other rounds in this module use round at INPUT
    /// boundaries; only the bonus floors.
    public static func computeTalentPayout(
        deal: DealPoint,
        ticketRevenueCents: Int
    ) -> TalentPayout {
        let costsOffTopCents = deal.costsOffTop.reduce(0) { $0 + $1.cents }
        let overage = max(0, ticketRevenueCents - costsOffTopCents - deal.guaranteeCents)
        let vsBonusCents: Int
        if let pct = deal.vsPctAfterCosts {
            vsBonusCents = Int((Double(overage) * pct).rounded(.down))
        } else {
            vsBonusCents = 0
        }
        let totalCents = deal.guaranteeCents + vsBonusCents + deal.buyoutCents
        return TalentPayout(
            guaranteeCents: deal.guaranteeCents,
            vsBonusCents: vsBonusCents,
            buyoutCents: deal.buyoutCents,
            totalCents: totalCents
        )
    }

    // ── Route validation (PUT /api/shows/[id]/deal → 422) ─────────────

    /// Web `validateDeal(d)` — returns the exact web error string, or nil
    /// when the deal is acceptable.
    public static func validateDeal(_ d: DealPoint?) -> String? {
        guard let d else { return "deal: must be an object" }
        if d.guaranteeCents < 0 { return "guaranteeCents: non-negative integer required" }
        if d.buyoutCents < 0 { return "buyoutCents: non-negative integer required" }
        if let pct = d.vsPctAfterCosts, !(pct >= 0 && pct <= 1) {
            return "vsPctAfterCosts: null or 0-1"
        }
        for (i, c) in d.costsOffTop.enumerated() {
            if c.cents < 0 { return "costsOffTop[\(i)].cents: non-negative integer required" }
        }
        return nil
    }

    // ── helpers ───────────────────────────────────────────────────────

    private static func assertNumeric(_ val: Any?, _ field: String) throws -> Double {
        guard let n = val as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(),
              n.doubleValue.isFinite else {
            throw SettlementError.invalidDealShape("InvalidDealShape: \(field) must be a finite number")
        }
        return n.doubleValue
    }

    /// JS `Math.round` — half toward +infinity.
    static func jsRound(_ x: Double) -> Double {
        (x + 0.5).rounded(.down)
    }
}
