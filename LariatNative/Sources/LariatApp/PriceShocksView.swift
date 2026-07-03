import SwiftUI
import Charts
import LariatDB
import LariatModel
import Observation

// MARK: - ViewModel

/// Backs `costing.priceShocks` — the vendor SKUs that moved price recently
/// board. Mirrors `app/costing/price-shocks/page.jsx`. Polls every 3 s
/// (`CostingViewModel` precedent) since GRDB's `ValueObservation` can't see
/// cross-process writes from the web app.
///
/// No PIN gate on this read board (native manager-tier reads don't gate
/// today; the web gates `/costing` via middleware only). No write path — no
/// `AuditedWriteRunner`.
@Observable @MainActor final class PriceShocksViewModel {
    var rows: [PriceShockRow] = []
    var impact: [String: PriceShockImpact] = [:]
    var historyCount: Int = 0
    var windowDays = 7
    var minPctMove: Double = 5
    var errorText: String?
    var isLoading = true

    /// Drill-down selection state — tapping a shock row opens `PriceHistoryView`
    /// via `.sheet(item:)`. `costing.prices` is NOT a sidebar tile.
    var selected: PriceShockRow?
    var series: PriceSeriesResult?
    var seriesErrorText: String?

    private let poller = BoardPoller()
    private let database: LariatDatabase
    private let repo: PriceShockRepository

    init(database: LariatDatabase) {
        self.database = database
        self.repo = PriceShockRepository(database: database)
    }

    func start() {
        poller.start(interval: .seconds(3)) { [weak self] in
            guard let self else { return }
            await self.refresh()
            try BoardPoller.throwIfFailed(self.errorText)
        }
    }

    func stop() { poller.stop() }

    /// Internal (not private): the window/threshold pickers trigger an
    /// immediate re-query on change so the board never shows a stale beat
    /// while waiting for the next 3 s poll tick.
    func refresh() async {
        do {
            let options = PriceShockOptions(windowDays: windowDays, minPctMove: minPctMove)
            let loadedRows = try await repo.load(options: options)
            let ingredients = Array(Set(loadedRows.map(\.ingredient))).sorted()
            let loadedImpact = try await repo.impact(ingredients: ingredients)
            let count = try await repo.historyCount()
            self.rows = loadedRows
            self.impact = loadedImpact
            self.historyCount = count
            self.errorText = nil
            self.isLoading = false
        } catch {
            self.errorText = "Fetch error: \(error.localizedDescription)"
            self.isLoading = false
        }
    }

    /// Loads the price-history series for the selected shock row's (vendor,
    /// sku) — the drill-down `PriceHistoryView` reads `series` off this VM.
    func select(_ row: PriceShockRow) async {
        selected = row
        seriesErrorText = nil
        do {
            // limit: 500 matches the web drill-down caller
            // (app/costing/prices/[vendor]/[sku]/page.jsx:98).
            series = try await repo.series(options: PriceSeriesOptions(vendor: row.vendor, sku: row.sku, limit: 500))
        } catch {
            series = nil
            seriesErrorText = "Fetch error: \(error.localizedDescription)"
        }
    }

    func clearSelection() {
        selected = nil
        series = nil
        seriesErrorText = nil
    }
}

// MARK: - Formatting helpers (verbatim ports of page.jsx:37-47)

/// `fmtPct` — `page.jsx:37-42`. Signed 1-decimal percent; `nil`/non-finite -> "—".
func fmtPct(_ n: Double?) -> String {
    guard let n, n.isFinite else { return "—" }
    let sign = n > 0 ? "+" : ""
    return String(format: "%@%.1f%%", sign, n)
}

/// `fmtPrice` — `page.jsx:44-47`, `formatDollars(n, { decimals: 4 })`.
func fmtPrice(_ n: Double?) -> String {
    formatDollars(n ?? 0, decimals: 4)
}

// MARK: - Root view

struct PriceShocksView: View {
    @State private var vm: PriceShocksViewModel
    init(database: LariatDatabase) { _vm = State(wrappedValue: PriceShocksViewModel(database: database)) }

    var body: some View {
        Group {
            if let err = vm.errorText {
                TileDegrade(
                    title: "Database unavailable",
                    message: err,
                    systemImage: "externaldrive.badge.xmark"
                )
            } else if vm.isLoading {
                ProgressView()
            } else {
                PriceShocksContentView(vm: vm)
            }
        }
        .navigationTitle("Price shocks")
        .task { vm.start() }
        .onDisappear { vm.stop() }
        .sheet(item: Binding(
            get: { vm.selected },
            set: { newValue in if newValue == nil { vm.clearSelection() } }
        )) { row in
            PriceHistoryView(row: row, series: vm.series, errorText: vm.seriesErrorText)
        }
    }
}

private struct PriceShocksContentView: View {
    @Bindable var vm: PriceShocksViewModel

    /// page.jsx WINDOW_OPTIONS / MIN_PCT_OPTIONS (price-shocks L26-34).
    private static let windowOptions: [(days: Int, label: String)] = [
        (1, "24h"), (7, "7 days"), (14, "14 days"), (30, "30 days"), (90, "90 days"),
    ]
    private static let minPctOptions: [Double] = [5, 10, 25]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Vendor SKUs that changed price in the last \(vm.windowDays) day\(vm.windowDays == 1 ? "" : "s"). Threshold: \(fmtThreshold(vm.minPctMove))% move.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)

                // Window / threshold pickers (MarginDeltasContentView pattern).
                HStack(spacing: 12) {
                    Picker("Window", selection: $vm.windowDays) {
                        ForEach(Self.windowOptions, id: \.days) { opt in
                            Text(opt.label).tag(opt.days)
                        }
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 400)
                    .onChange(of: vm.windowDays) { _, _ in Task { await vm.refresh() } }

                    Picker("Threshold", selection: $vm.minPctMove) {
                        ForEach(Self.minPctOptions, id: \.self) { pct in
                            Text("\(Int(pct))%").tag(pct)
                        }
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 200)
                    .onChange(of: vm.minPctMove) { _, _ in Task { await vm.refresh() } }

                    Spacer()
                }
                .padding(.horizontal)

                if vm.rows.isEmpty {
                    TileDegrade(
                        title: vm.historyCount == 0 ? "No price history yet" : "No price moves",
                        message: vm.historyCount == 0
                            ? "No price history yet. Run npm run ingest:costing to capture a snapshot."
                            : "No vendor price moves above this threshold in the window.",
                        systemImage: "chart.line.flattrend.xyaxis"
                    )
                    .padding(.horizontal)
                } else {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(vm.rows) { row in
                            PriceShockRowView(row: row, impact: vm.impact[row.ingredient])
                                .contentShape(Rectangle())
                                .onTapGesture {
                                    Task { await vm.select(row) }
                                }
                            Divider()
                        }
                    }
                    .padding(.horizontal)
                }
            }
            .padding(.vertical)
        }
    }

    private func fmtThreshold(_ v: Double) -> String {
        // minPctMove is often a whole number (5, 10, 25); avoid "5.0" noise.
        v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v)
    }
}

private struct PriceShockRowView: View {
    let row: PriceShockRow
    let impact: PriceShockImpact?

    private var tone: Color { row.direction == .up ? .red : .green }

    /// "Used in" text — verbatim port of `page.jsx:227-231`: dishes first
    /// (slice 5, "and N more"), else recipes (slice 3, "and N more"), else
    /// the not-used fallback string.
    private var usedInText: String {
        let dishes = impact?.dishes ?? []
        let recipes = impact?.recipes ?? []
        if !dishes.isEmpty {
            let shown = dishes.prefix(5).joined(separator: ", ")
            return dishes.count > 5 ? "\(shown) and \(dishes.count - 5) more" : shown
        } else if !recipes.isEmpty {
            let shown = recipes.prefix(3).joined(separator: ", ")
            return recipes.count > 3 ? "\(shown) and \(recipes.count - 3) more" : shown
        }
        return "Not currently used in any costed recipe or dish."
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.ingredient)
                    .font(.headline)
                Text("\(row.vendor) · \(row.sku)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            PriceMoveSparkline(row: row)
                .frame(width: 60, height: 36)

            Text(fmtPct(row.deltaPct))
                .font(.system(.body, design: .rounded))
                .bold()
                .monospacedDigit()
                .foregroundStyle(tone)
                .frame(width: 72, alignment: .trailing)

            VStack(alignment: .leading, spacing: 2) {
                Text("\(fmtPrice(row.baselineUnitPrice)) → \(fmtPrice(row.latestUnitPrice))")
                    .font(.caption)
                    .monospacedDigit()
                Text(usedInText)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 10)
    }
}

/// Mirrors `PriceMoveSparkline` (`page.jsx:102-124`) — a simple two/three-point
/// trend line colored by direction.
private struct PriceMoveSparkline: View {
    let row: PriceShockRow

    var body: some View {
        Chart {
            LineMark(x: .value("Point", 0), y: .value("Price", row.baselineUnitPrice))
            LineMark(x: .value("Point", 1), y: .value("Price", row.latestUnitPrice))
        }
        .foregroundStyle(row.direction == .up ? .red : .green)
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .chartLegend(.hidden)
    }
}

// MARK: - Price history drill-down (selection state, NOT a route)

/// `costing.prices` drill-down — reached only via `vm.selected` (a shock row
/// tap), never a `FeatureCatalog` descriptor / sidebar tile. Mirrors
/// `app/costing/prices/[vendor]/[sku]/page.jsx`.
struct PriceHistoryView: View {
    let row: PriceShockRow
    let series: PriceSeriesResult?
    let errorText: String?

    var body: some View {
        NavigationStack {
            Group {
                if let errorText {
                    TileDegrade(title: "Database unavailable", message: errorText, systemImage: "externaldrive.badge.xmark")
                } else if let series {
                    if series.points.isEmpty {
                        TileDegrade(title: "No history yet", message: "No history yet for this SKU.", systemImage: "chart.line.flattrend.xyaxis")
                    } else {
                        PriceHistoryContentView(row: row, series: series)
                    }
                } else {
                    ProgressView()
                }
            }
            .navigationTitle(row.ingredient)
        }
    }
}

private struct PriceHistoryContentView: View {
    let row: PriceShockRow
    let series: PriceSeriesResult

    private var tone: Color { row.direction == .up ? .red : .green }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("\(row.vendor) · \(row.sku)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                HStack(spacing: 8) {
                    Text(fmtPct(series.deltaPct))
                        .font(.system(.title2, design: .rounded))
                        .bold()
                        .monospacedDigit()
                        .foregroundStyle(tone)
                    Text("over \(series.points.count) snapshots")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Chart(Array(series.points.enumerated()), id: \.offset) { _, point in
                    if let price = point.unitPrice {
                        LineMark(x: .value("Snapshot", point.snapshotAt), y: .value("Price", price))
                        PointMark(x: .value("Snapshot", point.snapshotAt), y: .value("Price", price))
                    }
                }
                .foregroundStyle(tone)
                .chartXAxis(.hidden)
                .frame(height: 160)

                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(series.points.reversed().enumerated()), id: \.offset) { _, point in
                        HStack {
                            // A nil unit_price snapshot renders as a dash, not
                            // "$0.0000" (drill-down display only). vendor_prices_history.unit_price
                            // is nullable in the web-owned schema.
                            Text(point.unitPrice == nil ? "—" : fmtPrice(point.unitPrice))
                                .font(.body)
                                .monospacedDigit()
                            Spacer()
                            Text(point.snapshotAt)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Divider()
                    }
                }
            }
            .padding()
        }
    }
}
