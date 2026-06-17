import Foundation

/// Traffic-light severity for the Management rollup tiles, ported from the
/// color rules in `app/management/page.jsx`. Pure + GRDB-free so it unit-tests
/// against the web thresholds without a database.
///
/// Returns `ThresholdColor?` where `nil` mirrors the web `var(--muted)` branch
/// (no data / no signal). `ThresholdColor` (green/yellow/red) is shared with
/// `CostingCompute`.
public enum RollupTileColor {

    /// `varianceColor(pct)` — food-cost variance vs. target.
    /// null → muted; ≥5% → red; ≥2% → yellow; else green.
    public static func variance(pct: Double?) -> ThresholdColor? {
        guard let pct else { return nil }
        if pct >= 5 { return .red }
        if pct >= 2 { return .yellow }
        return .green
    }

    /// `ingestColor(ageMin, status)` — costing-ingest freshness.
    /// Missing age/status or a failed run → red; ≥1440 min (1 day) → red;
    /// ≥60 min → yellow; else green.
    public static func ingest(ageMinutes: Int?, status: String?) -> ThresholdColor? {
        guard let ageMinutes, let status, status != "failed" else { return .red }
        if ageMinutes >= 1440 { return .red }
        if ageMinutes >= 60 { return .yellow }
        return .green
    }

    /// `warningCountColor(n)` — price shocks, depletion issues.
    /// null → muted; any (>0) → yellow; zero → green.
    public static func warningCount(_ n: Int?) -> ThresholdColor? {
        guard let n else { return nil }
        return n > 0 ? .yellow : .green
    }

    /// `packChangeColor(n)` — unacknowledged pack-size changes.
    /// null → muted; any (>0) → yellow; zero → green.
    public static func packChange(_ n: Int?) -> ThresholdColor? {
        guard let n else { return nil }
        return n > 0 ? .yellow : .green
    }

    // NOTE: the web `coverageColor` needs the unlinked / fully_linked /
    // declared_only / partial breakdown, which the native DishCoverageSnapshot
    // does not carry (model gap deferred from P1a). The Menu-items-costed tile
    // therefore renders muted (no traffic-light) until that breakdown is ported.
}
