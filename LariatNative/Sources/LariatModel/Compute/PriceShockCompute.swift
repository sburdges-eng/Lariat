import Foundation

/// Pure port of `lib/vendorPricesRepo.ts#listPriceShocks` (L419-604) — vendor
/// SKUs whose unit price moved by more than a threshold over a lookback
/// window, with the live `vendor_prices` row overlaid as the true latest
/// comparison point. GRDB-free: the repository queries `vendor_prices_history`
/// + `vendor_prices` and hands the rows in.
///
/// `inputs` MUST arrive pre-sorted `vendor, sku, ingredient, snapshot_at ASC,
/// source_order ASC, row_order ASC` (mirrors the UNION ALL ORDER BY at
/// vendorPricesRepo.ts:482) so first-seen per (vendor,sku,ingredient) key is
/// the baseline and the last is the latest (pre-overlay).
///
/// **No rounding in compute** — `deltaPct` is kept full precision; rounding is
/// a display concern only (`fmtPct`'s `.toFixed(1)` in the view layer).
public enum PriceShockCompute {
    private struct Group {
        let vendor: String
        let sku: String
        let ingredient: String
        var category: String?
        var baselineUnitPrice: Double?
        var baselineAt: String?
        var latestUnitPrice: Double?
        var latestAt: String?
        var pointCount: Int = 0
    }

    public static func compute(inputs: [PriceShockInput], live: [PriceShockLive], options: PriceShockOptions) -> [PriceShockRow] {
        var groups: [String: Group] = [:]
        var groupOrder: [String] = []

        for r in inputs {
            let key = "\(r.vendor)|\(r.sku)|\(r.ingredient)"
            if var g = groups[key] {
                g.pointCount += 1
                g.latestUnitPrice = r.unitPrice
                g.latestAt = r.snapshotAt
                // category may have been null on the first row but populated
                // later; keep the most recent non-null (vendorPricesRepo.ts:535).
                if let c = r.category { g.category = c }
                groups[key] = g
            } else {
                groups[key] = Group(
                    vendor: r.vendor, sku: r.sku, ingredient: r.ingredient,
                    category: r.category,
                    baselineUnitPrice: r.unitPrice, baselineAt: r.snapshotAt,
                    latestUnitPrice: r.unitPrice, latestAt: r.snapshotAt,
                    pointCount: 1)
                groupOrder.append(key)
            }
        }

        // Overlay the LIVE current price as the latest comparison point. Only
        // groups that already have an in-window history baseline are
        // overridden; a live row with no baseline can't yield a % change and
        // is skipped (vendorPricesRepo.ts:551-571).
        //
        // Point-count note: at the SQL layer, a live `vendor_prices` row whose
        // `imported_at` falls inside the lookback window is ALSO selected by
        // the UNION query (the second leg, `vendorPricesRepo.ts:474-481`), so
        // it independently contributes to `point_count` there. This pure
        // compute function receives `inputs` and `live` as two separate
        // parameters (so it can be exercised without duplicating that SQL
        // union), so the overlay step here increments `pointCount` itself to
        // preserve the same observable outcome: a single history snapshot
        // plus one live overlay is two observations, satisfying the
        // `pointCount >= 2` gate as it does end-to-end on the web (see
        // "surfaces a fresh-ingest price move that lives only in
        // vendor_prices" in tests/js/test-price-shocks.mjs, where a lone
        // history row + a live row DOES surface a shock).
        for r in live {
            let key = "\(r.vendor)|\(r.sku)|\(r.ingredient)"
            guard var g = groups[key] else { continue }
            g.latestUnitPrice = r.unitPrice
            g.latestAt = r.importedAt ?? g.latestAt
            g.pointCount += 1
            if let c = r.category, g.category == nil { g.category = c }
            groups[key] = g
        }

        var out: [PriceShockRow] = []
        for key in groupOrder {
            let g = groups[key]!
            guard let baseline = g.baselineUnitPrice, let baselineAt = g.baselineAt,
                  let latest = g.latestUnitPrice, let latestAt = g.latestAt,
                  g.pointCount >= 2, baseline > 0
            else { continue }
            let deltaPct = (latest - baseline) / baseline * 100
            guard abs(deltaPct) >= options.minPctMove else { continue }
            out.append(PriceShockRow(
                vendor: g.vendor, sku: g.sku, ingredient: g.ingredient, category: g.category,
                baselineUnitPrice: baseline, baselineAt: baselineAt,
                latestUnitPrice: latest, latestAt: latestAt,
                deltaPct: deltaPct, direction: deltaPct > 0 ? .up : .down))
        }

        // Stable sort by |deltaPct| DESC (preserve insertion order on ties —
        // parity with JS's stable Array.sort + Map insertion order).
        let sorted = out.enumerated().sorted { a, b in
            let da = abs(a.element.deltaPct), db = abs(b.element.deltaPct)
            if da != db { return da > db }
            return a.offset < b.offset
        }.map(\.element)
        return Array(sorted.prefix(options.limit))
    }
}

/// Pure port of `lib/vendorPricesRepo.ts#listPriceSeries` delta rule (derived
/// from the wave brief + repo doc L300-317; there is no dedicated JS oracle
/// for `listPriceSeries` itself). Guards BOTH endpoints non-nil (stricter than
/// the web drill-down page, which only guards `first`, see
/// `app/costing/prices/[vendor]/[sku]/page.jsx:124-127` — deliberate
/// hardening, not a parity match; web would produce `NaN` for a nil `last`,
/// this returns `nil`).
public enum PriceSeriesCompute {
    public static func summarize(points: [PriceSeriesPoint]) -> Double? {
        guard points.count >= 2 else { return nil }
        guard let first = points.first?.unitPrice, let last = points.last?.unitPrice else { return nil }
        guard first > 0 else { return nil }
        return (last - first) / first * 100
    }
}
