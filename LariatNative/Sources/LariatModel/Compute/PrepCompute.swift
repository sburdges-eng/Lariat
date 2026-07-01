import Foundation

// Pure prep-board rules. Ports:
//   • lib/beoPrepHistory.ts  — parseAmountQty + getPrepMedianForItems (median math)
//   • app/prep/PrepBoard.jsx — station grouping, closed bin, status counts
//   • app/prep/page.jsx      — low-par suggestion suppression
// No I/O: the repository feeds raw rows / amount_qty strings in.

public enum PrepCompute {

    // MARK: - amount_qty coercion (parity with lib/beoPrepHistory.parseAmountQty)

    // Leading numeric token: thousands-comma grouped OR plain, optional decimal,
    // optional leading minus. Mirrors:
    //   /^(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)/
    private static let amountRegex = try! NSRegularExpression(
        pattern: #"^(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)"#
    )

    /// Parse `amount_qty` (TEXT) into a positive finite Double, or nil. Strips a
    /// single trailing unit token ("30 ea" → 30) and thousands commas ("1,000").
    /// Zero / negative are treated as non-numeric sentinel data → nil.
    public static func parseAmountQty(_ raw: String?) -> Double? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        let range = NSRange(trimmed.startIndex..<trimmed.endIndex, in: trimmed)
        guard let match = amountRegex.firstMatch(in: trimmed, range: range),
              let captured = Range(match.range(at: 1), in: trimmed)
        else { return nil }
        let numeric = String(trimmed[captured]).replacingOccurrences(of: ",", with: "")
        guard let n = Double(numeric), n.isFinite, n > 0 else { return nil }
        return n
    }

    // MARK: - median (parity with lib/beoPrepHistory.getPrepMedianForItems)

    private static func median(_ sorted: [Double]) -> Double {
        let n = sorted.count
        if n == 0 { return 0 }
        let mid = n / 2
        if n % 2 == 1 { return sorted[mid] }
        return (sorted[mid - 1] + sorted[mid]) / 2
    }

    /// For each requested item, compute the median of its historical prep
    /// quantities. `rowsByKey` maps `lower(item)` → its `amount_qty` strings
    /// (the repository runs `WHERE LOWER(item) = key` per item). Items are
    /// deduped case-insensitively; items with zero numeric samples are omitted.
    /// Returned map is keyed by `trim().lowercased()`, matching the web contract.
    public static func medianForItems(
        rowsByKey: [String: [String?]],
        items: [String]
    ) -> [String: PrepMedian] {
        var out: [String: PrepMedian] = [:]
        var seen = Set<String>()
        for raw in items {
            let item = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if item.isEmpty { continue }
            let key = item.lowercased()
            if seen.contains(key) { continue }
            seen.insert(key)

            guard let rows = rowsByKey[key], !rows.isEmpty else { continue }
            var nums: [Double] = []
            for r in rows {
                if let n = parseAmountQty(r) { nums.append(n) }
            }
            if nums.isEmpty { continue }
            nums.sort()
            out[key] = PrepMedian(
                key: key,
                item: item,
                median: median(nums),
                samples: nums.count,
                totalRows: rows.count
            )
        }
        return out
    }

    // MARK: - board grouping (parity with PrepBoard.jsx `grouped`)

    /// Open (non-closed) tasks grouped by station. Stations render in catalog
    /// order; unknown stations after known ones; "Any station" ("" key) last.
    public static func groupOpen(
        _ tasks: [PrepTaskRow],
        stations: [KitchenStation]
    ) -> [PrepStationGroup] {
        var buckets: [String: [PrepTaskRow]] = [:]
        var order: [String] = []
        for t in tasks {
            guard let st = t.statusValue, !st.isClosed else { continue }
            let key = t.stationId ?? ""
            if buckets[key] == nil {
                buckets[key] = []
                order.append(key)
            }
            buckets[key]?.append(t)
        }
        let index = Dictionary(uniqueKeysWithValues: stations.enumerated().map { ($1.id, $0) })
        let sortedKeys = order.sorted { a, b in
            if a.isEmpty && !b.isEmpty { return false }   // "" (Any) sorts last
            if b.isEmpty && !a.isEmpty { return true }
            let ai = index[a] ?? 999
            let bi = index[b] ?? 999
            return ai < bi
        }
        return sortedKeys.map { key in
            PrepStationGroup(
                stationId: key,
                stationName: stationName(key, stations: stations),
                tasks: buckets[key] ?? []
            )
        }
    }

    /// Done + skipped tasks (the "Done · N" bin), in the input order.
    public static func closedBin(_ tasks: [PrepTaskRow]) -> [PrepTaskRow] {
        tasks.filter { ($0.statusValue?.isClosed) == true }
    }

    /// Status tallies for the board subtitle.
    public static func counts(_ tasks: [PrepTaskRow]) -> PrepStatusCounts {
        var c = PrepStatusCounts()
        for t in tasks {
            switch t.statusValue {
            case .todo: c.todo += 1
            case .inProgress: c.inProgress += 1
            case .done: c.done += 1
            case .skipped: c.skipped += 1
            case nil: break
            }
        }
        return c
    }

    /// Resolve a station id to its catalog display name; falls back to the id,
    /// then "Any station" for the empty key (parity with PrepBoard.jsx stationName).
    public static func stationName(_ id: String, stations: [KitchenStation]) -> String {
        if let match = stations.first(where: { $0.id == id }) { return match.name }
        return id.isEmpty ? "Any station" : id
    }

    // MARK: - suggestion filtering (parity with page.jsx openTaskIngredients)

    /// Ingredients that already have an OPEN (todo/in_progress) low_par task
    /// today — the page suppresses these from the "below par · suggested" list
    /// so a suggestion the cook already accepted doesn't reappear.
    public static func openLowParIngredients(_ tasks: [PrepTaskRow]) -> Set<String> {
        var out = Set<String>()
        for t in tasks {
            guard let st = t.statusValue, st == .todo || st == .inProgress else { continue }
            guard t.source == "low_par", let ref = t.sourceRef, !ref.isEmpty else { continue }
            out.insert(ref)
        }
        return out
    }
}
