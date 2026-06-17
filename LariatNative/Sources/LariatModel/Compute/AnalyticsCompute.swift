import Foundation

// GRDB-free port of the KPI derivations in `app/analytics/page.jsx`.
//
// Task 9 (AnalyticsRepository) runs all SELECTs and packs the raw row-sets
// into an `AnalyticsBundle`. This module does ONLY the counting / derivation
// that the page performs AFTER its queries. No database, no clock.
//
// KPI semantics match the page exactly (null/zero-guard comments reference
// the JS expression that is being mirrored):

// MARK: - Output summary

/// All derived KPIs produced from an AnalyticsBundle.
public struct AnalyticsSummary {

    // ── Scalar KPIs ─────────────────────────────────────────────────────────

    /// Σ daily.net_sales for comparison_group=1
    /// JS: `daily.reduce((s,r) => s + (r.net_sales||0), 0)`
    public let dailyCurrentTotal: Double

    /// YoY delta %  — nil when priorRev == 0
    /// JS: `priorRev > 0 ? ((dailyCurrentTotal - priorRev)/priorRev)*100 : null`
    public let yoyDelta: Double?

    /// Average check — nil when daily is empty or total orders == 0
    /// JS: `daily.length > 0 ? dailyCurrentTotal / Σorders : null`
    public let avgCheck: Double?

    /// Number of distinct shift_date rows in cg=1
    /// JS: `daily.length || '—'`
    public let tradingDays: Int

    /// Period label from date_range column (empty string if nil)
    /// JS: `dateRange?.date_range || ''`
    public let periodLabel: String

    /// Σ shamrock_total_spend
    /// JS: `spend.reduce((s,r) => s + (r.shamrock_total_spend||0), 0)`
    public let totalSpend: Double

    // ── Comparison series ───────────────────────────────────────────────────

    /// Day-of-week current-vs-prior pairs, keyed by day_of_week
    public let dowPairs: [DowPair]

    /// Hourly current-vs-prior pairs, keyed by hour_24
    public let hourlyPairs: [HourlyPair]

    /// Top items, ordered by rev DESC (passed through as-is from repository)
    public let topItems: [AnalyticsTopItem]

    // ── Nested types ────────────────────────────────────────────────────────

    public struct DowPair {
        /// Toast TEXT key (`Mon`…`Sun`) — stable ForEach identity after dedupe.
        public let dayOfWeek: String
        public let current: AnalyticsDowRow
        public let prior: AnalyticsDowRow?
        public init(dayOfWeek: String, current: AnalyticsDowRow, prior: AnalyticsDowRow?) {
            self.dayOfWeek = dayOfWeek; self.current = current; self.prior = prior
        }
    }

    public struct HourlyPair {
        public let hour24: Int
        public let current: AnalyticsHourlyRow
        public let prior: AnalyticsHourlyRow?
        public init(hour24: Int, current: AnalyticsHourlyRow, prior: AnalyticsHourlyRow?) {
            self.hour24 = hour24; self.current = current; self.prior = prior
        }
    }
}

// MARK: - Compute

public enum AnalyticsCompute {

    /// Derives all KPIs from a raw `AnalyticsBundle`, mirroring the JS page exactly.
    public static func summarize(bundle: AnalyticsBundle) -> AnalyticsSummary {

        // ── dailyCurrentTotal ────────────────────────────────────────────────
        // JS: daily.reduce((s, r) => s + (r.net_sales || 0), 0)
        let dailyCurrentTotal = bundle.daily.reduce(0.0) { $0 + ($1.netSales ?? 0.0) }

        // ── yoyDelta ─────────────────────────────────────────────────────────
        // JS: priorRev > 0 ? ((dailyCurrentTotal - priorRev) / priorRev) * 100 : null
        // bundle.dailyPriorRev is now Optional; apply the 0-default here so that
        // "no prior rows" (nil) and "prior == 0.0" both produce nil yoyDelta.
        let priorRev = bundle.dailyPriorRev ?? 0.0
        let yoyDelta: Double? = priorRev > 0
            ? ((dailyCurrentTotal - priorRev) / priorRev) * 100.0
            : nil

        // ── avgCheck ─────────────────────────────────────────────────────────
        // JS: daily.length > 0 ? dailyCurrentTotal / Σorders : null
        //
        // DELIBERATE DIVERGENCE from JS: when daily.length > 0 but Σorders == 0,
        // JavaScript computes dailyCurrentTotal / 0 → Infinity, then the render
        // layer suppresses it via `avgCheck != null && isFinite(avgCheck)`.
        // Swift returns nil directly in that case — observationally identical
        // (the UI shows no avg check in both paths) but strictly safer for
        // Swift consumers who should not have to guard against Infinity.
        let totalOrders = bundle.daily.reduce(0) { $0 + ($1.orders ?? 0) }
        let avgCheck: Double? = (bundle.daily.count > 0 && totalOrders > 0)
            ? dailyCurrentTotal / Double(totalOrders)
            : nil

        // ── tradingDays ──────────────────────────────────────────────────────
        let tradingDays = bundle.daily.count

        // ── periodLabel ──────────────────────────────────────────────────────
        // JS: dateRange?.date_range || ''
        let periodLabel = bundle.dateRange ?? ""

        // ── totalSpend ───────────────────────────────────────────────────────
        // JS: spend.reduce((s, r) => s + (r.shamrock_total_spend || 0), 0)
        let totalSpend = bundle.spend.reduce(0.0) { $0 + ($1.shamrockTotalSpend ?? 0.0) }

        // ── DOW pairs ────────────────────────────────────────────────────────
        // Mirrors AnalyticsCharts DowBars: dedupe by day_of_week (last row wins),
        // then emit Mon→Sun in chart order for stable SwiftUI ForEach identity.
        let currentDowMap = Dictionary(
            bundle.dowCurrent.map { ($0.dayOfWeek, $0) },
            uniquingKeysWith: { _, last in last }
        )
        let priorDowMap = Dictionary(
            bundle.dowPrior.map { ($0.dayOfWeek, $0) },
            uniquingKeysWith: { _, last in last }
        )
        let orderedDays = ToastWeekday.chartOrder.filter { currentDowMap[$0] != nil }
        let extraDays = Set(currentDowMap.keys)
            .subtracting(ToastWeekday.chartOrder)
            .sorted()
        let dowPairs = (orderedDays + extraDays).map { day in
            AnalyticsSummary.DowPair(
                dayOfWeek: day,
                current: currentDowMap[day]!,
                prior: priorDowMap[day]
            )
        }

        // ── Hourly pairs ─────────────────────────────────────────────────────
        let priorHourMap = Dictionary(
            bundle.hourlyPrior.map { ($0.hour24, $0) },
            uniquingKeysWith: { first, _ in first }
        )
        let hourlyPairs = bundle.hourlyCurrent.map { curr in
            AnalyticsSummary.HourlyPair(
                hour24: curr.hour24,
                current: curr,
                prior: priorHourMap[curr.hour24]
            )
        }

        return AnalyticsSummary(
            dailyCurrentTotal: dailyCurrentTotal,
            yoyDelta: yoyDelta,
            avgCheck: avgCheck,
            tradingDays: tradingDays,
            periodLabel: periodLabel,
            totalSpend: totalSpend,
            dowPairs: dowPairs,
            hourlyPairs: hourlyPairs,
            topItems: bundle.top
        )
    }
}
