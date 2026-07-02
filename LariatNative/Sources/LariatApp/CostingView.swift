import SwiftUI
import Charts
import LariatDB
import LariatModel
import Observation

// MARK: - ViewModel

// P1a costing variance shows accounting COGS variance + 28-day trend;
// the web page's recipe-level computeCostVariance card (max/mean/recipes>5%/top-5)
// is not ported in P1a.

@Observable @MainActor final class CostingViewModel {
    var bundle: CostingBundle?
    var menuEngineering: MenuEngineeringResult?
    var varianceTrend: VarianceTrend?
    var abcRows: [AbcRankedRow] = []
    var errorText: String?
    private let poller = BoardPoller()
    private let database: LariatDatabase

    init(database: LariatDatabase) {
        self.database = database
    }

    func start() {
        // recipes.json is the bridge's discovery layer (web getRecipes());
        // loaded once per start — [] when the cache file is absent.
        let repo = CostingRepository(database: database, recipes: DishBridgeRecipeLoader.load())
        // ValueObservation can't see cross-process writes; BoardPoller re-queries
        // every 3 s (mirrors CommandViewModel / AnalyticsViewModel).
        poller.start(interval: .seconds(3)) { [weak self] in
            do {
                let b = try await repo.fetch()
                let me = CostingCompute.computeMenuEngineering(salesLines: b.salesLines)
                let trend = CostingCompute.getVarianceTrend(trendRows: b.varianceTrendRows)
                let abc = CostingCompute.rankByContribution(salesLines: b.salesLines)
                self?.bundle = b
                self?.menuEngineering = me
                self?.varianceTrend = trend
                self?.abcRows = abc
                self?.errorText = nil
            } catch {
                self?.errorText = "Fetch error: \(error.localizedDescription)"
                throw error
            }
        }
    }

    func stop() { poller.stop() }
}

// MARK: - Root view

struct CostingView: View {
    @State private var vm: CostingViewModel
    init(database: LariatDatabase) { _vm = State(wrappedValue: CostingViewModel(database: database)) }

    var body: some View {
        Group {
            if let err = vm.errorText {
                TileDegrade(
                    title: "Database unavailable",
                    message: err,
                    systemImage: "externaldrive.badge.xmark"
                )
            } else if let bundle = vm.bundle,
                      let me = vm.menuEngineering,
                      let trend = vm.varianceTrend {
                CostingContentView(
                    bundle: bundle,
                    menuEngineering: me,
                    varianceTrend: trend,
                    abcRows: vm.abcRows
                )
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Cost checks")
        .task { vm.start() }
        .onDisappear { vm.stop() }
    }
}

// MARK: - Content

private struct CostingContentView: View {
    let bundle: CostingBundle
    let menuEngineering: MenuEngineeringResult
    let varianceTrend: VarianceTrend
    let abcRows: [AbcRankedRow]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {

                Text("Three quick checks before trusting the cost numbers.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)

                // ── Section 1: Variance (accounting COGS) ─────────────────────
                // P1a costing variance shows accounting COGS variance + 28-day trend;
                // the web page's recipe-level computeCostVariance card
                // (max/mean/recipes>5%/top-5) is not ported in P1a.
                VarianceSection(variance: bundle.latestVariance)
                    .padding(.horizontal)

                // ── Section 2: Dish coverage (P0 reuse) ──────────────────────
                DishCoverageSection(coverage: bundle.latestCoverage)
                    .padding(.horizontal)

                // ── Section 3: Menu engineering (quadrant breakdown) ──────────
                // cost_per_unit now comes from the real dish-cost bridge
                // (A4.3 T1) — rows fall to 'unknown' only when the bridge has
                // no data for them (web-identical).
                MenuEngineeringSection(result: menuEngineering)
                    .padding(.horizontal)

                // ── Section 4: Variance trend (28-day COGS sparkline) ─────────
                VarianceTrendSection(trend: varianceTrend)
                    .padding(.horizontal)

                // ── Section 5: ABC ranking ────────────────────────────────────
                AbcSection(rows: abcRows)
                    .padding(.horizontal)
            }
            .padding(.vertical)
        }
    }
}

// MARK: - Section 1: Accounting Variance

private struct VarianceSection: View {
    let variance: AccountingVariance?

    var body: some View {
        SectionCard(
            title: "Accounting variance",
            emptyTitle: "No variance data yet",
            emptyMessage: "Run the compute engine to populate accounting_variance.",
            emptyIcon: "chart.bar.xaxis",
            isEmpty: variance == nil
        ) {
            if let v = variance {
                VStack(alignment: .leading, spacing: 6) {
                    // Primary KPI: variance_pct
                    HStack(spacing: 8) {
                        let pctStr = v.variancePct.map { String(format: "%.2f%%", $0) } ?? "—"
                        Text(pctStr)
                            .font(.system(.title2, design: .rounded))
                            .bold()
                            .monospacedDigit()
                            .foregroundStyle(variancePctColor(v.variancePct))
                        Text("variance")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    // Theoretical vs actual amounts
                    HStack(spacing: 4) {
                        Text(formatDollars(v.varianceAmount ?? 0.0))
                            .font(.caption)
                            .monospacedDigit()
                        Text("vs")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(formatDollars(v.theoreticalCogs))
                            .font(.caption)
                            .monospacedDigit()
                        Text("theoretical")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    if let snap = v.snapshotAt {
                        Text("as of \(snap.prefix(10))")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
        }
    }

    /// Mirror web: red ≥ 5%, yellow 2–5%, green < 2%.
    private func variancePctColor(_ pct: Double?) -> Color {
        guard let pct else { return .primary }
        let abs = Swift.abs(pct)
        if abs >= 5.0 { return .red }
        if abs >= 2.0 { return .yellow }
        return .green
    }
}

// MARK: - Section 2: Dish Coverage (P0 reuse)

private struct DishCoverageSection: View {
    let coverage: DishCoverageSnapshot?

    var body: some View {
        SectionCard(
            title: "Dish → recipe bridge",
            emptyTitle: "No dish coverage data",
            emptyMessage: "Dish coverage snapshot not yet populated.",
            emptyIcon: "fork.knife",
            isEmpty: coverage == nil
        ) {
            if let c = coverage {
                VStack(alignment: .leading, spacing: 6) {
                    // covered / total
                    HStack(spacing: 8) {
                        let covered = c.coveredDishes ?? 0
                        let total = c.totalDishes ?? 0
                        Text(total > 0 ? "\(covered)/\(total)" : "—")
                            .font(.system(.title2, design: .rounded))
                            .bold()
                            .monospacedDigit()
                        Text("dishes costed")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    if let pct = c.coveragePct {
                        Text(String(format: "%.1f%% costed", pct))
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
        }
    }
}

// MARK: - Section 3: Menu Engineering

private struct MenuEngineeringSection: View {
    let result: MenuEngineeringResult

    // cost_per_unit is bridge-derived since A4.3 T1; every row is 'unknown'
    // only when no dish_components are wired yet — the degrade below points
    // the operator at the fix (same guidance as the web hub's Unknown copy).
    private var allUnknown: Bool {
        result.rows.isEmpty || result.rows.allSatisfy { $0.quadrant == .unknown }
    }

    private func rowsFor(_ quadrant: Quadrant) -> [MenuEngineeringRow] {
        result.rows.filter { $0.quadrant == quadrant }
    }

    var body: some View {
        SectionCard(
            title: "Menu engineering",
            emptyTitle: "No sales data yet",
            emptyMessage: "Populate sales_lines to see quadrant analysis.",
            emptyIcon: "chart.bar.xaxis",
            isEmpty: result.rows.isEmpty
        ) {
            if allUnknown {
                // No bridge data yet — all items fall to 'unknown' until
                // dish_components rows exist (edit them on costing.components).
                TileDegrade(
                    title: "Cost data unavailable",
                    message: "All items fall to unknown quadrant. Wire dish_components for cost_per_unit.",
                    systemImage: "questionmark.circle"
                )
                .frame(height: 100)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    // Thresholds used
                    HStack(spacing: 8) {
                        Text(String(format: "Median margin %.1f%%", result.medianMargin))
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                        Text("·")
                            .foregroundStyle(.tertiary)
                        Text(String(format: "Median pop %.2f", result.medianPop))
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }

                    // 2×2 quadrant grid
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                        QuadrantCell(
                            quadrant: .star,
                            rows: rowsFor(.star),
                            color: .green
                        )
                        QuadrantCell(
                            quadrant: .puzzle,
                            rows: rowsFor(.puzzle),
                            color: .blue
                        )
                        QuadrantCell(
                            quadrant: .plowhorse,
                            rows: rowsFor(.plowhorse),
                            color: .orange
                        )
                        QuadrantCell(
                            quadrant: .dog,
                            rows: rowsFor(.dog),
                            color: .secondary
                        )
                    }

                    // Unknown fallback count
                    let unknownCount = rowsFor(.unknown).count
                    if unknownCount > 0 {
                        Text("\(unknownCount) item(s) have no cost data (unknown quadrant)")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
        }
    }
}

private struct QuadrantCell: View {
    let quadrant: Quadrant
    let rows: [MenuEngineeringRow]
    let color: Color

    private var label: String {
        switch quadrant {
        case .star:      return "Star"
        case .puzzle:    return "Puzzle"
        case .plowhorse: return "Plowhorse"
        case .dog:       return "Dog"
        case .unknown:   return "Unknown"
        }
    }

    private var subtitle: String {
        switch quadrant {
        case .star:      return "high margin · high pop"
        case .puzzle:    return "high margin · low pop"
        case .plowhorse: return "low margin · high pop"
        case .dog:       return "low margin · low pop"
        case .unknown:   return "no cost data"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(color)
                Spacer()
                Text("\(rows.count)")
                    .font(.system(.title3, design: .rounded))
                    .bold()
                    .monospacedDigit()
            }
            Text(subtitle)
                .font(.caption2)
                .foregroundStyle(.tertiary)
            // Top item in this quadrant (by net sales)
            if let top = rows.max(by: { $0.netSales < $1.netSales }) {
                Text(top.itemName)
                    .font(.caption2)
                    .lineLimit(1)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
    }
}

// MARK: - Section 4: Variance Trend

private struct VarianceTrendSection: View {
    let trend: VarianceTrend

    var body: some View {
        SectionCard(
            title: "COGS variance · last \(trend.windowDays) days",
            emptyTitle: "No variance trend data",
            emptyMessage: "Run the compute engine to populate accounting_variance with period_end.",
            emptyIcon: "waveform.path.ecg",
            isEmpty: trend.rowsFound == 0
        ) {
            VStack(alignment: .leading, spacing: 12) {
                // Summary stats
                HStack(spacing: 20) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("current")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text(formatVariancePct(trend.pCurrent))
                            .font(.system(.body, design: .rounded))
                            .bold()
                            .monospacedDigit()
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text("average")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text(formatVariancePct(trend.pAverage))
                            .font(.system(.body, design: .rounded))
                            .bold()
                            .monospacedDigit()
                    }
                    Spacer()
                    Text("\(trend.rowsFound) \(trend.rowsFound == 1 ? "run" : "runs")")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }

                // Sparkline using Swift Charts (mirrors VarianceTrend.jsx SVG bars)
                if !trend.points.isEmpty {
                    VarianceTrendSparkline(points: trend.points)
                        .frame(height: 60)
                }

                Text("Green ≤ 2% · Yellow 2–5% · Red ≥ 5%")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
    }

    private func formatVariancePct(_ pct: Double?) -> String {
        guard let pct else { return "—" }
        return String(format: "%+.1f%%", pct)
    }
}

private struct VarianceTrendSparkline: View {
    let points: [VarianceTrendPoint]

    private func barColor(_ tc: ThresholdColor) -> Color {
        switch tc {
        case .green:  return .green
        case .yellow: return .yellow
        case .red:    return .red
        }
    }

    var body: some View {
        Chart {
            ForEach(Array(points.enumerated()), id: \.offset) { idx, point in
                let pct = Swift.abs(point.variancePct ?? 0.0)
                BarMark(
                    x: .value("Period", idx),
                    y: .value("Variance %", pct)
                )
                .foregroundStyle(barColor(point.thresholdColor))
                .cornerRadius(2)
            }
        }
        .chartXAxis(.hidden)
        .chartYAxis {
            AxisMarks(values: .automatic(desiredCount: 3)) { value in
                if let v = value.as(Double.self) {
                    AxisValueLabel { Text(String(format: "%.0f%%", v)).font(.caption2) }
                    AxisGridLine(stroke: StrokeStyle(dash: [3, 3]))
                }
            }
        }
    }
}

// MARK: - Section 5: ABC Ranking

private struct AbcSection: View {
    let rows: [AbcRankedRow]

    private var linkedRows: [AbcRankedRow] {
        rows.filter { $0.tier != .unranked }
    }

    private func rowsFor(_ tier: AbcTier) -> [AbcRankedRow] {
        rows.filter { $0.tier == tier }
    }

    private func tierShare(_ tier: AbcTier) -> Double {
        let total = rows.reduce(0) { $0 + $1.scoreCents }
        guard total > 0 else { return 0.0 }
        let tierTotal = rowsFor(tier).reduce(0) { $0 + $1.scoreCents }
        return (Double(tierTotal) / Double(total)) * 100.0
    }

    var body: some View {
        SectionCard(
            title: "ABC contribution",
            emptyTitle: "No sales data yet",
            emptyMessage: "Populate sales_lines to compute ABC ranking.",
            emptyIcon: "chart.bar",
            isEmpty: rows.isEmpty
        ) {
            if linkedRows.isEmpty {
                TileDegrade(
                    title: "No costed dishes yet",
                    message: "Wire dish_components for menu items before this section becomes useful.",
                    systemImage: "link.badge.plus"
                )
                .frame(height: 80)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    // Tier summary rows (mirrors AbcTile.jsx TierRow)
                    VStack(spacing: 6) {
                        AbcTierRow(label: "Tier A", rows: rowsFor(.a), share: tierShare(.a))
                        AbcTierRow(label: "Tier B", rows: rowsFor(.b), share: tierShare(.b))
                        AbcTierRow(label: "Tier C", rows: rowsFor(.c), share: tierShare(.c))
                        AbcTierRow(label: "Unranked · no costing", rows: rowsFor(.unranked), share: 0.0)
                    }

                    // Top-5 in tier A (mirrors AbcTile.jsx topA slice)
                    let topA = rowsFor(.a).prefix(5)
                    if !topA.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Top \(topA.count) in tier A")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .textCase(.uppercase)
                                .tracking(1)

                            ForEach(Array(topA.enumerated()), id: \.offset) { idx, r in
                                HStack(spacing: 6) {
                                    Text("\(idx + 1)")
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                        .frame(width: 16, alignment: .trailing)
                                        .monospacedDigit()

                                    Text(r.itemName)
                                        .font(.caption)
                                        .lineLimit(1)
                                        .frame(maxWidth: .infinity, alignment: .leading)

                                    let marginPerUnit = r.qty > 0
                                        ? formatDollars(r.contributionDollars / r.qty, decimals: 2)
                                        : "—"
                                    Text("\(marginPerUnit) margin/unit · \(Int(r.qty)) sold")
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                        .monospacedDigit()
                                }
                            }
                        }
                        .padding(.top, 4)
                    }
                }
            }
        }
    }
}

private struct AbcTierRow: View {
    let label: String
    let rows: [AbcRankedRow]
    let share: Double

    var body: some View {
        HStack {
            Text(label)
                .font(.caption)
            Spacer()
            let count = rows.count
            Text("\(count) \(count == 1 ? "dish" : "dishes") · \(Int(share.rounded()))% of margin")
                .font(.caption)
                .foregroundStyle(.secondary)
                .monospacedDigit()
        }
    }
}

// MARK: - Shared section card wrapper

private struct SectionCard<Content: View>: View {
    let title: String
    let emptyTitle: String
    let emptyMessage: String
    let emptyIcon: String
    let isEmpty: Bool
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
                .tracking(2)

            if isEmpty {
                TileDegrade(
                    title: emptyTitle,
                    message: emptyMessage,
                    systemImage: emptyIcon
                )
                .frame(height: 100)
            } else {
                content()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                    .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }
}
