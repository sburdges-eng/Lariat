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
        // The overlay ONLY overrides the authoritative latest price/time — it
        // must NOT touch `pointCount`. Faithful to the web: `point_count` is
        // incremented solely in the UNION loop (vendorPricesRepo.ts:526); the
        // separate overlay loop (vendorPricesRepo.ts:563-571) overrides the
        // latest price/snapshot but never bumps the count.
        //
        // In the repository, `inputs` is the full UNION (history + IN-WINDOW
        // live, whose live leg is window-gated by
        // `COALESCE(imported_at, now) >= now - windowDays`,
        // vendorPricesRepo.ts:478), while `live` is a separate WINDOW-LESS
        // latest query. So an in-window live row is ALREADY counted via
        // `inputs`; a bump here would double-count it and — worse — falsely
        // surface a shock for a group whose ONLY live row is OUT-OF-WINDOW
        // (that stale row appears in `live` but NOT in `inputs`, so it must
        // stay a single-point group and be skipped by the `pointCount >= 2`
        // gate). The fresh-ingest oracle ("surfaces a fresh-ingest price move
        // that lives only in vendor_prices") passes because that in-window
        // live row is part of the UNION `inputs` the repository builds.
        for r in live {
            let key = "\(r.vendor)|\(r.sku)|\(r.ingredient)"
            guard var g = groups[key] else { continue }
            g.latestUnitPrice = r.unitPrice
            g.latestAt = r.importedAt ?? g.latestAt
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
