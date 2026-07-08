import SwiftUI
import Charts
import LariatDB
import LariatModel
import Observation

// MARK: - ViewModel

@Observable @MainActor final class AnalyticsViewModel {
    var bundle: AnalyticsBundle?
    var summary: AnalyticsSummary?
    var errorText: String?
    let poller = BoardPoller()
    private let database: LariatDatabase

    init(database: LariatDatabase) {
        self.database = database
    }

    func start() {
        let repo = AnalyticsRepository(database: database)
        // ValueObservation can't see cross-process writes; BoardPoller re-queries
        // every 3 s (mirrors CommandViewModel polling pattern).
        poller.start(interval: .seconds(3)) { [weak self] in
            do {
                let b = try await repo.fetch()
                let s = AnalyticsCompute.summarize(bundle: b)
                self?.bundle = b
                self?.summary = s
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

struct AnalyticsView: View {
    @State private var vm: AnalyticsViewModel
    init(database: LariatDatabase) { _vm = State(wrappedValue: AnalyticsViewModel(database: database)) }

    var body: some View {
        Group {
            if let summary = vm.summary, let bundle = vm.bundle {
                // Keep stale data on a transient poll error (e.g. momentary
                // SQLITE_BUSY) — inline banner instead of blanking the board.
                VStack(spacing: 0) {
                    if let err = vm.errorText {
                        StaleDataBanner(message: err)
                    }
                    AnalyticsContentView(summary: summary, bundle: bundle)
                }
            } else if let err = vm.errorText {
                TileDegrade(
                    title: "Database unavailable",
                    message: err,
                    systemImage: "externaldrive.badge.xmark"
                )
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Sales numbers")
        .task { vm.start() }
        .tracksActiveBoard(vm.poller)
        .onDisappear { vm.stop() }
    }
}

// MARK: - Content

private struct AnalyticsContentView: View {
    let summary: AnalyticsSummary
    let bundle: AnalyticsBundle

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {

                // Subtitle (mirrors web: period label + caption)
                VStack(alignment: .leading, spacing: 4) {
                    if !summary.periodLabel.isEmpty {
                        Text(summary.periodLabel)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    Text("Toast sales and Shamrock spend. Pull fresh numbers after the weekly update.")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                .padding(.horizontal)

                // ── KPI header row ────────────────────────────────────────────
                KpiHeaderRow(summary: summary, spendMonths: bundle.spend.count)
                    .padding(.horizontal)

                // ── Chart 1: Daily revenue trend (line/area) ──────────────────
                DailyTrendChart(daily: bundle.daily)
                    .padding(.horizontal)

                // ── Chart 2 + 3: DOW and Hourly side by side ─────────────────
                HStack(alignment: .top, spacing: 16) {
                    DowComparisonChart(pairs: summary.dowPairs)
                    HourlyComparisonChart(pairs: summary.hourlyPairs)
                }
                .padding(.horizontal)

                // ── Chart 4: Monthly Shamrock spend ───────────────────────────
                SpendChart(spend: bundle.spend)
                    .padding(.horizontal)

                // ── Top items table ───────────────────────────────────────────
                TopItemsView(items: summary.topItems)
                    .padding(.horizontal)
            }
            .padding(.vertical)
        }
    }
}

// MARK: - KPI header

private struct KpiHeaderRow: View {
    let summary: AnalyticsSummary
    let spendMonths: Int

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 180))], spacing: 16) {
            // Current period revenue
            KpiCard(label: "Current period revenue") {
                if summary.dailyCurrentTotal > 0 {
                    Text(formatDollars(summary.dailyCurrentTotal))
                        .font(.system(.title2, design: .rounded))
                        .bold()
                        .monospacedDigit()
                } else {
                    Text("—")
                        .font(.system(.title2, design: .rounded))
                        .bold()
                        .foregroundStyle(.secondary)
                }
                // YoY delta — shown only when priorRev > 0
                if let delta = summary.yoyDelta {
                    HStack(spacing: 2) {
                        Image(systemName: delta >= 0 ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill")
                            .font(.caption2)
                        Text(String(format: "%.1f%% vs prior", abs(delta)))
                            .font(.caption)
                            .bold()
                    }
                    .foregroundStyle(delta >= 0 ? Color.green : Color.red)
                }
            }

            // Avg check — shown only when non-nil and finite (web: `avgCheck != null && isFinite(avgCheck)`)
            KpiCard(label: "Avg check") {
                if let avg = summary.avgCheck, avg.isFinite {
                    Text(formatDollars(avg, decimals: 2))
                        .font(.system(.title2, design: .rounded))
                        .bold()
                        .monospacedDigit()
                } else {
                    Text("—")
                        .font(.system(.title2, design: .rounded))
                        .bold()
                        .foregroundStyle(.secondary)
                }
            }

            // Trading days
            KpiCard(label: "Trading days") {
                Text(summary.tradingDays > 0 ? "\(summary.tradingDays)" : "—")
                    .font(.system(.title2, design: .rounded))
                    .bold()
                    .monospacedDigit()
            }

            // Shamrock spend  (web: "Shamrock spend ({spend.length} mo)")
            KpiCard(label: "Shamrock spend (\(spendMonths) mo)") {
                if summary.totalSpend > 0 {
                    Text(formatDollars(summary.totalSpend))
                        .font(.system(.title2, design: .rounded))
                        .bold()
                        .monospacedDigit()
                } else {
                    Text("—")
                        .font(.system(.title2, design: .rounded))
                        .bold()
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

private struct KpiCard<Content: View>: View {
    let label: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Chart 1: Daily revenue trend

private struct DailyTrendChart: View {
    let daily: [AnalyticsDailyRow]

    var body: some View {
        ChartCard(
            title: "Daily revenue — last \(daily.count) trading days",
            isEmpty: daily.isEmpty,
            emptyTitle: "No daily data yet"
        ) {
            Chart {
                ForEach(Array(daily.enumerated()), id: \.offset) { idx, row in
                    let val = row.netSales ?? 0.0
                    AreaMark(
                        x: .value("Date", row.shiftDate),
                        y: .value("Revenue", val)
                    )
                    .foregroundStyle(
                        LinearGradient(
                            colors: [Color.orange.opacity(0.3), Color.orange.opacity(0.02)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .interpolationMethod(.catmullRom)

                    LineMark(
                        x: .value("Date", row.shiftDate),
                        y: .value("Revenue", val)
                    )
                    .foregroundStyle(Color.orange)
                    .lineStyle(StrokeStyle(lineWidth: 2))
                    .interpolationMethod(.catmullRom)
                }
            }
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 6)) { value in
                    if let dateStr = value.as(String.self) {
                        AxisValueLabel { Text(formatShiftDate(dateStr)).font(.caption2) }
                        AxisGridLine()
                    }
                }
            }
            .chartYAxis {
                AxisMarks(values: .automatic(desiredCount: 5)) { value in
                    if let v = value.as(Double.self) {
                        AxisValueLabel { Text(formatCompact(v)).font(.caption2) }
                        AxisGridLine(stroke: StrokeStyle(dash: [3, 3]))
                    }
                }
            }
            .frame(height: 180)
        }
    }
}

// MARK: - Chart 2: Day-of-week comparison

private struct DowComparisonChart: View {
    let pairs: [AnalyticsSummary.DowPair]

    var body: some View {
        ChartCard(
            title: "Revenue by day",
            isEmpty: pairs.isEmpty,
            emptyTitle: "No day-of-week data yet"
        ) {
            Chart {
                ForEach(pairs, id: \.dayOfWeek) { pair in
                    let dayLabel = dayName(pair.dayOfWeek)
                    BarMark(
                        x: .value("Day", dayLabel),
                        y: .value("Revenue", pair.current.netSales ?? 0.0),
                        width: .ratio(0.4)
                    )
                    .foregroundStyle(Color.orange)
                    .position(by: .value("Period", "Current"))

                    if let prior = pair.prior {
                        BarMark(
                            x: .value("Day", dayLabel),
                            y: .value("Revenue", prior.netSales ?? 0.0),
                            width: .ratio(0.4)
                        )
                        .foregroundStyle(Color.secondary.opacity(0.5))
                        .position(by: .value("Period", "Prior"))
                    }
                }
            }
            .chartForegroundStyleScale([
                "Current": Color.orange,
                "Prior": Color.secondary.opacity(0.5)
            ])
            .chartLegend(position: .bottom)
            .chartXAxis {
                AxisMarks { value in
                    AxisValueLabel { Text(value.as(String.self) ?? "").font(.caption2) }
                }
            }
            .chartYAxis {
                AxisMarks(values: .automatic(desiredCount: 3)) { value in
                    if let v = value.as(Double.self) {
                        AxisValueLabel { Text(formatCompact(v)).font(.caption2) }
                        AxisGridLine(stroke: StrokeStyle(dash: [3, 3]))
                    }
                }
            }
            .frame(height: 200)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Chart 3: Hourly revenue curve

private struct HourlyComparisonChart: View {
    let pairs: [AnalyticsSummary.HourlyPair]

    // Mirror web: only plot hours with net_sales > 500 (active hours).
    // Card visibility uses the UNFILTERED pairs so a low-volume environment
    // (all hours ≤ $500) still renders the near-flat curve rather than hiding the card.
    private var activePairs: [AnalyticsSummary.HourlyPair] {
        pairs.filter { ($0.current.netSales ?? 0) > 500 }
    }

    var body: some View {
        ChartCard(
            title: "Hourly revenue curve",
            isEmpty: pairs.isEmpty,
            emptyTitle: "No hourly data yet"
        ) {
            Chart {
                // Prior year — dashed line
                ForEach(activePairs, id: \.hour24) { pair in
                    if let prior = pair.prior {
                        LineMark(
                            x: .value("Hour", formatHour(pair.hour24)),
                            y: .value("Revenue", prior.netSales ?? 0.0),
                            series: .value("Period", "Prior")
                        )
                        .foregroundStyle(Color.secondary.opacity(0.6))
                        .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
                        .interpolationMethod(.catmullRom)
                    }
                }
                // Current year — solid line + area
                ForEach(activePairs, id: \.hour24) { pair in
                    AreaMark(
                        x: .value("Hour", formatHour(pair.hour24)),
                        y: .value("Revenue", pair.current.netSales ?? 0.0),
                        series: .value("Period", "Current")
                    )
                    .foregroundStyle(Color.orange.opacity(0.12))
                    .interpolationMethod(.catmullRom)

                    LineMark(
                        x: .value("Hour", formatHour(pair.hour24)),
                        y: .value("Revenue", pair.current.netSales ?? 0.0),
                        series: .value("Period", "Current")
                    )
                    .foregroundStyle(Color.orange)
                    .lineStyle(StrokeStyle(lineWidth: 2))
                    .interpolationMethod(.catmullRom)
                }
            }
            .chartForegroundStyleScale([
                "Current": Color.orange,
                "Prior": Color.secondary.opacity(0.6)
            ])
            .chartLegend(position: .bottom)
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 6)) { value in
                    AxisValueLabel { Text(value.as(String.self) ?? "").font(.caption2) }
                }
            }
            .chartYAxis {
                AxisMarks(values: .automatic(desiredCount: 3)) { value in
                    if let v = value.as(Double.self) {
                        AxisValueLabel { Text(formatCompact(v)).font(.caption2) }
                        AxisGridLine(stroke: StrokeStyle(dash: [3, 3]))
                    }
                }
            }
            .frame(height: 200)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Chart 4: Monthly Shamrock spend

private struct SpendChart: View {
    let spend: [AnalyticsSpendRow]

    var body: some View {
        ChartCard(
            title: "Monthly Shamrock spend",
            isEmpty: spend.isEmpty,
            emptyTitle: "No spend data yet"
        ) {
            Chart {
                ForEach(spend, id: \.month) { row in
                    BarMark(
                        x: .value("Month", formatMonth(row.month)),
                        y: .value("Spend", row.shamrockTotalSpend ?? 0.0)
                    )
                    .foregroundStyle(Color(hue: 0.36, saturation: 0.25, brightness: 0.55)) // sage/brass tone
                    .cornerRadius(2)
                }
            }
            .chartXAxis {
                AxisMarks { value in
                    AxisValueLabel { Text(value.as(String.self) ?? "").font(.caption2) }
                }
            }
            .chartYAxis {
                AxisMarks(values: .automatic(desiredCount: 4)) { value in
                    if let v = value.as(Double.self) {
                        AxisValueLabel { Text(formatCompact(v)).font(.caption2) }
                        AxisGridLine(stroke: StrokeStyle(dash: [3, 3]))
                    }
                }
            }
            .frame(height: 160)
        }
    }
}

// MARK: - Top items

private struct TopItemsView: View {
    let items: [AnalyticsTopItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Top sellers by net sales")
                .font(.caption)
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
                .tracking(2)

            if items.isEmpty {
                TileDegrade(
                    title: "No sales data yet",
                    message: "Run the analytics ingest to populate top sellers.",
                    systemImage: "chart.bar.xaxis"
                )
                .frame(height: 80)
            } else {
                let maxRev = items.compactMap(\.rev).max() ?? 1.0
                VStack(spacing: 6) {
                    ForEach(Array(items.enumerated()), id: \.offset) { idx, item in
                        HStack(spacing: 8) {
                            Text("\(idx + 1)")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                                .frame(minWidth: 20, alignment: .trailing)
                                .monospacedDigit()

                            Text(item.itemName)
                                .font(.caption)
                                .fontWeight(.semibold)
                                .lineLimit(1)
                                .frame(maxWidth: .infinity, alignment: .leading)

                            Text(formatDollars(item.rev ?? 0, decimals: 0))
                                .font(.caption2)
                                .monospacedDigit()
                                .foregroundStyle(.secondary)

                            GeometryReader { geo in
                                RoundedRectangle(cornerRadius: 2)
                                    .fill(Color.orange)
                                    .frame(
                                        width: geo.size.width * CGFloat((item.rev ?? 0) / maxRev),
                                        height: 6
                                    )
                                    .frame(maxHeight: .infinity)
                            }
                            .frame(width: 80, height: 10)
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("Rank \(idx + 1), \(item.itemName), \(formatDollars(item.rev ?? 0, decimals: 0))")
                    }
                }
                .padding()
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }
}

// MARK: - Chart card wrapper

private struct ChartCard<Content: View>: View {
    let title: String
    let isEmpty: Bool
    let emptyTitle: String
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
                    message: "Data will appear after ingest.",
                    systemImage: "chart.line.uptrend.xyaxis"
                )
                .frame(height: 120)
            } else {
                content()
            }
        }
        .padding()
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
    }
}

// MARK: - Formatting helpers

/// "2024-03-15" → "Mar 15"
private func formatShiftDate(_ iso: String) -> String {
    let parts = iso.split(separator: "-")
    guard parts.count == 3,
          let month = Int(parts[1]),
          let day = Int(parts[2]),
          month >= 1, month <= 12 else { return iso }
    let months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
    return "\(months[month - 1]) \(day)"
}

/// "2024-03" → "03" (mirrors web: `month.replace(/^\d{4}-/, '')`)
private func formatMonth(_ month: String) -> String {
    if let idx = month.firstIndex(of: "-") {
        let after = month.index(after: idx)
        return String(month[after...])
    }
    return month
}

/// hour_24 integer → "12a", "1p", etc. (mirrors web fmtHour)
private func formatHour(_ h: Int) -> String {
    switch h {
    case 0:  return "12a"
    case 1..<12: return "\(h)a"
    case 12: return "12p"
    default: return "\(h - 12)p"
    }
}

/// Compact dollar formatter for axis labels: $1.2K, $1.5M
private func formatCompact(_ value: Double) -> String {
    if abs(value) >= 1_000_000 {
        return String(format: "$%.1fM", value / 1_000_000)
    } else if abs(value) >= 1_000 {
        return String(format: "$%.0fK", value / 1_000)
    } else {
        return String(format: "$%.0f", value)
    }
}

/// Toast TEXT day key (`Mon`…`Sun`) for chart axis labels.
private func dayName(_ dow: String) -> String {
    dow
}
