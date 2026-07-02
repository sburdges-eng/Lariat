import Foundation

// GRDB-free port of the variance-attribution evidence gatherer from
// `lib/varianceAttribution.ts` (buildVarianceAttribution / listRecentVariancePeriods /
// thresholdColorFor) and `normalizeDishName` (`lib/dishCostBridge.ts:49-55`).
//
// All inputs are caller-supplied value types; no I/O is performed here.
// VarianceAttributionRepository (LariatDB) runs the SELECTs and hands in the raw rows.
//
// Money is `Double` dollars (NOT cents) for this wave. The only rounding calls are
// `Math.round(pct*10)/10` (price-move pct, 1dp) and `Math.round(x*100)/100`
// (delta amount/pct, 2dp) — both mapped to jsRound = floor(x + 0.5), matching JS
// Math.round exactly (including its round-toward-+infinity behavior on negative ties,
// which differs from Swift's `.rounded()`).

public enum VarianceAttributionCompute {

    public static let sectionLimit = 60

    // MARK: - Rounding

    /// JS Math.round = floor(x + 0.5); ties on positive deltas (e.g. 0.5→1) go up,
    /// and ties on negative deltas (e.g. -0.5→0) also go "up" (toward +infinity) —
    /// this differs from Swift's `.rounded()` which is half-away-from-zero.
    private static func jsRound(_ x: Double) -> Double { (x + 0.5).rounded(.down) }
    private static func round1(_ x: Double) -> Double { jsRound(x * 10) / 10 }
    private static func round2(_ x: Double) -> Double { jsRound(x * 100) / 100 }

    // MARK: - Task 1: threshold color + window selection

    /// Wraps `colorFor` from `CostingCompute.swift` — byte-identical to
    /// `thresholdColorFor` in lib/varianceAttribution.ts. Reused, not re-derived.
    public static func thresholdColor(_ pct: Double?) -> ThresholdColor { colorFor(pct) }

    public static func selectWindow(
        baseline: VarianceAttrRow?, current: VarianceAttrRow?,
        hasFrom: Bool, hasTo: Bool, from: String?, to: String?, recentCount: Int
    ) -> VarianceAttrWindowResult {
        if hasFrom || hasTo {
            guard hasFrom, hasTo else {
                return .failed(reason: "both from and to are required to pick an explicit window")
            }
            let f = from ?? "", t = to ?? ""
            if f >= t { return .failed(reason: "from must be an earlier period_end than to") }
            guard let base = baseline else { return .failed(reason: "no variance period found with period_end \(f)") }
            guard let cur = current else { return .failed(reason: "no variance period found with period_end \(t)") }
            return finish(base, cur)
        }
        if recentCount < 2 {
            return .failed(reason: "need at least two variance periods for this location to attribute a move")
        }
        guard let base = baseline, let cur = current else {
            return .failed(reason: "variance periods disappeared mid-read")
        }
        return finish(base, cur)
    }

    private static func toPeriod(_ r: VarianceAttrRow) -> VarianceAttrPeriod {
        VarianceAttrPeriod(periodStart: r.periodStart, periodEnd: r.periodEnd,
            theoreticalCogs: r.theoreticalCogs, actualCogs: r.actualCogs,
            varianceAmount: r.varianceAmount, variancePct: r.variancePct,
            thresholdColor: thresholdColor(r.variancePct))
    }

    private static func finish(_ base: VarianceAttrRow, _ cur: VarianceAttrRow) -> VarianceAttrWindowResult {
        let b = toPeriod(base), c = toPeriod(cur)
        let dAmt: Double? = (b.varianceAmount != nil && c.varianceAmount != nil)
            ? round2(c.varianceAmount! - b.varianceAmount!) : nil
        let dPct: Double? = (b.variancePct != nil && c.variancePct != nil)
            ? round2(c.variancePct! - b.variancePct!) : nil
        return .ok(window: VarianceAttrWindow(from: base.periodEnd, to: cur.periodEnd),
                   delta: VarianceAttrDelta(baseline: b, current: c, deltaAmount: dAmt, deltaPct: dPct))
    }

    // MARK: - Task 2: normalizeDishName

    /// Port of `normalizeDishName` (lib/dishCostBridge.ts:49-55): lowercase, collapse
    /// runs of non-ASCII-alphanumeric characters to a single space, trim. JS's regex
    /// `[^a-z0-9]` is ASCII-only, hence the `ch.isASCII` guard below.
    public static func normalizeDishName(_ s: String?) -> String {
        guard let s, !s.isEmpty else { return "" }
        var out = ""
        var lastWasSep = false
        for ch in s.lowercased() {
            if ch.isASCII && (ch.isLetter || ch.isNumber) {
                out.append(ch)
                lastWasSep = false
            } else if !lastWasSep {
                out.append(" ")
                lastWasSep = true
            }
        }
        return out.trimmingCharacters(in: .whitespaces)
    }

    // MARK: - Task 2: price_moves

    public static func priceMoves(snaps: [PriceSnapRow], linkedIngredients: Set<String>) -> [PriceMoveItem] {
        var order: [String] = []
        var groups: [String: [PriceSnapRow]] = [:]
        for s in snaps {
            let key = "\(s.vendor)|\(s.sku)|\(s.ingredient)"
            if groups[key] == nil { order.append(key) }
            groups[key, default: []].append(s)
        }
        var moves: [PriceMoveItem] = []
        for key in order {
            let arr = groups[key]!
            guard arr.count >= 2, let first = arr.first, let last = arr.last else { continue }
            if first.unitPrice == last.unitPrice { continue }   // no move (nil==nil matches JS null===null)
            let pct: Double?
            if let f = first.unitPrice, let l = last.unitPrice, f != 0 {
                pct = round1(((l - f) / f) * 100)
            } else {
                pct = nil
            }
            moves.append(PriceMoveItem(vendor: first.vendor, sku: first.sku, ingredient: first.ingredient,
                firstPrice: first.unitPrice, lastPrice: last.unitPrice, pctMove: pct,
                firstAt: first.snapshotAt, lastAt: last.snapshotAt, snapshots: arr.count,
                linkedToMenu: linkedIngredients.contains(first.ingredient)))
        }
        // Stable sort by |pctMove ?? 0| DESC (JS Array.sort is stable; equal keys keep insertion order).
        return Array(moves.enumerated().sorted {
            let a = abs($0.element.pctMove ?? 0), b = abs($1.element.pctMove ?? 0)
            if a != b { return a > b }
            return $0.offset < $1.offset
        }.map(\.element).prefix(sectionLimit))
    }

    // MARK: - Task 2: composition_changes

    public static func compositionChanges(rows: [CompRow], from: String, to: String) -> [CompositionChangeItem] {
        rows.map { r in
            let createdPrefix = r.createdAt.map { String($0.prefix(10)) }
            let createdInWindow = r.createdAt != nil && createdPrefix! > from && createdPrefix! <= to
            let target = r.componentType == "recipe" ? r.recipeSlug : r.vendorIngredient
            let qty: String
            if let q = r.qtyPerServing {
                let qtyStr = " × \(jsNum(q)) \(r.unit ?? "")"
                qty = trimTrailingWhitespace(qtyStr)
            } else {
                qty = ""
            }
            let component = "\(target ?? "(unknown)")\(qty)"
            let changedAt: String = createdInWindow ? (r.createdAt ?? "") : (r.updatedAt ?? r.createdAt ?? "")
            return CompositionChangeItem(
                dishName: r.dishName, component: component, componentType: r.componentType,
                changeKind: createdInWindow ? "created" : "updated", changedAt: changedAt)
        }
    }

    /// Mirrors JS String.trimEnd() — trims only trailing whitespace.
    private static func trimTrailingWhitespace(_ s: String) -> String {
        var result = Substring(s)
        while let last = result.last, last.isWhitespace { result.removeLast() }
        return String(result)
    }

    /// Mirrors JS template-literal number stringification (no trailing ".0" for whole numbers).
    private static func jsNum(_ d: Double) -> String {
        if d.isFinite, d == d.rounded(.towardZero), abs(d) < 9.007e15 {
            return String(Int64(d))
        }
        return String(d)
    }

    // MARK: - Task 2: count_corrections

    public static func countCorrections(audits: [AuditRow], closed: [ClosedCountRow]) -> [CountCorrectionItem] {
        let auditItems: [CountCorrectionItem] = audits.map { a in
            var transition: String?
            if let payload = a.payloadJson, let data = payload.data(using: .utf8) {
                if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let t = obj["transition"] as? String {
                    transition = t
                }
                // malformed payload — leave transition nil (mirrors JS try/catch)
            }
            return CountCorrectionItem(
                kind: "audit", entity: a.entity, action: a.action, transition: transition,
                actorCookId: a.actorCookId, entityId: a.entityId, countId: nil, lines: nil,
                label: nil, countDate: nil, at: a.createdAt)
        }
        let closedItems: [CountCorrectionItem] = closed.map { c in
            CountCorrectionItem(
                kind: "count_closed", entity: nil, action: nil, transition: nil, actorCookId: nil,
                entityId: nil, countId: c.id, lines: c.lines, label: c.label, countDate: c.countDate,
                at: c.closedAt)
        }
        // Closed counts come FIRST (lib:411 `[...closedItems, ...auditItems]`).
        return Array((closedItems + auditItems).prefix(sectionLimit))
    }

    // MARK: - Task 2: unresolved_depletions

    public static func unresolvedDepletions(
        sales: [SalesLineRow], components: [CompRow],
        from: String, to: String, dateLikeCount: Int, totalCount: Int
    ) -> (items: [UnresolvedDepletionItem], note: String?) {
        let windowed = dateLikeCount > 0 || totalCount == 0
        let resolvedNames = Set(components.map { normalizeDishName($0.dishName) })

        var filtered = sales.filter { !resolvedNames.contains(normalizeDishName($0.itemName)) }
        if windowed {
            filtered = filtered.filter { line in
                guard let label = line.periodLabel, isDateLike(label) else { return false }
                return label > from && label <= to
            }
        }

        // GROUP BY (item_name, period_label), SUM(quantity_sold), ROUND(SUM(net_sales),2).
        struct GroupKey: Hashable { let itemName: String; let periodLabel: String? }
        var order: [GroupKey] = []
        var qtySums: [GroupKey: Double] = [:]
        var qtyAnyNonNil: [GroupKey: Bool] = [:]
        var netSums: [GroupKey: Double] = [:]
        var netAnyNonNil: [GroupKey: Bool] = [:]
        for line in filtered {
            let key = GroupKey(itemName: line.itemName, periodLabel: line.periodLabel)
            if qtySums[key] == nil { order.append(key) }
            qtySums[key, default: 0] += line.quantitySold ?? 0
            if line.quantitySold != nil { qtyAnyNonNil[key] = true }
            netSums[key, default: 0] += line.netSales ?? 0
            if line.netSales != nil { netAnyNonNil[key] = true }
        }

        var items: [UnresolvedDepletionItem] = order.map { key in
            UnresolvedDepletionItem(
                itemName: key.itemName, periodLabel: key.periodLabel,
                qtySold: (qtyAnyNonNil[key] == true) ? qtySums[key] : nil,
                netSales: (netAnyNonNil[key] == true) ? round2(netSums[key] ?? 0) : nil)
        }

        // ORDER BY net_sales DESC, item_name ASC (stable).
        items = items.enumerated().sorted { lhs, rhs in
            let a = lhs.element.netSales ?? 0, b = rhs.element.netSales ?? 0
            if a != b { return a > b }
            if lhs.element.itemName != rhs.element.itemName { return lhs.element.itemName < rhs.element.itemName }
            return lhs.offset < rhs.offset
        }.map(\.element)

        items = Array(items.prefix(sectionLimit))

        let note = windowed
            ? nil
            : "period_label values for this location are not date-like; showing all-time unresolved depletions instead of the window."
        return (items, note)
    }

    /// GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' — exactly 10 chars, digits and dashes
    /// in the YYYY-MM-DD shape (no calendar validation, matching the SQLite GLOB pattern).
    private static func isDateLike(_ s: String) -> Bool {
        guard s.count == 10 else { return false }
        let chars = Array(s)
        for i in 0..<10 {
            let c = chars[i]
            if i == 4 || i == 7 {
                if c != "-" { return false }
            } else if !c.isASCII || !c.isNumber {
                return false
            }
        }
        return true
    }
}
