import SwiftUI
import LariatDB
import LariatModel
import Observation

// MARK: - ViewModel

/// Backs `costing.marginDeltas` — dishes whose per-serving cost moved in the
/// lookback window. Mirrors `app/menu-engineering/margin-deltas/page.jsx`;
/// compute (`MarginDeltasCompute`) and repository (`MarginDeltasRepository`)
/// were ported earlier and are reused as-is. Polls every 3 s (CostingViewModel
/// precedent) since GRDB's ValueObservation can't see cross-process writes.
///
/// Param clamping lives in `MarginDeltaOptions` (windowDays [1,90] default 7,
/// minPctMove [0,1000] default 5) — the pickers only offer the web page's
/// preset values (1/7/30/90 days, 2/5/10/25 %). limit: 200 matches the page.
@Observable @MainActor final class MarginDeltasViewModel {
    var rows: [MarginDeltaRow] = []
    var zeroState = MarginDeltasZeroStateCounts(historyCount: 0, componentsCount: 0)
    var windowDays = 7
    var minPctMove: Double = 5
    var errorText: String?
    var isLoading = true

    let poller = BoardPoller()
    private let repo: MarginDeltasRepository
    private let locationId: String

    init(database: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.locationId = locationId
        self.repo = MarginDeltasRepository(database: database, locationId: locationId)
    }

    func start() {
        poller.start(interval: .seconds(3)) { [weak self] in
            guard let self else { return }
            await self.refresh()
            try BoardPoller.throwIfFailed(self.errorText)
        }
    }

    func stop() { poller.stop() }

    func refresh() async {
        do {
            let options = MarginDeltaOptions(
                locationId: locationId, windowDays: windowDays,
                minPctMove: minPctMove, limit: 200)
            rows = try await repo.load(options: options)
            zeroState = try await repo.zeroStateCounts()
            errorText = nil
            isLoading = false
        } catch {
            errorText = "Fetch error: \(error.localizedDescription)"
            isLoading = false
        }
    }

    /// Which zero-state copy to show (page.jsx L132-139).
    var emptyMessage: String {
        if zeroState.historyCount == 0 {
            return "No price history yet. Run npm run ingest:costing to capture a snapshot."
        }
        if zeroState.componentsCount == 0 {
            return "No dishes wired up yet. Set per-serving qty in Dish components."
        }
        return "No dish margin moves above this threshold."
    }
}

// MARK: - Root view

struct MarginDeltasView: View {
    @State private var vm: MarginDeltasViewModel
    init(database: LariatDatabase) { _vm = State(wrappedValue: MarginDeltasViewModel(database: database)) }

    var body: some View {
        Group {
            if let err = vm.errorText {
                TileDegrade(
                    title: "Database unavailable",
                    message: err,
                    systemImage: "externaldrive.badge.xmark"
                )
            } else if vm.isLoading {
                ProgressView("Loading margin moves…")
            } else {
                MarginDeltasContentView(vm: vm)
            }
        }
        .navigationTitle("Margin moves")
        .task { vm.start() }
        .tracksActiveBoard(vm.poller)
        .onDisappear { vm.stop() }
    }
}

// MARK: - Content

private struct MarginDeltasContentView: View {
    @Bindable var vm: MarginDeltasViewModel

    /// page.jsx WINDOW_OPTIONS / MIN_PCT_OPTIONS.
    private static let windowOptions: [(days: Int, label: String)] = [
        (1, "24h"), (7, "7 days"), (30, "30 days"), (90, "90 days"),
    ]
    private static let minPctOptions: [Double] = [2, 5, 10, 25]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Dishes whose per-serving cost changed in the last \(vm.windowDays) day\(vm.windowDays == 1 ? "" : "s"). Threshold: \(Int(vm.minPctMove))% move.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)

                HStack(spacing: 12) {
                    Picker("Window", selection: $vm.windowDays) {
                        ForEach(Self.windowOptions, id: \.days) { opt in
                            Text(opt.label).tag(opt.days)
                        }
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 320)
                    .onChange(of: vm.windowDays) { _, _ in Task { await vm.refresh() } }

                    Picker("Threshold", selection: $vm.minPctMove) {
                        ForEach(Self.minPctOptions, id: \.self) { pct in
                            Text("\(Int(pct))%").tag(pct)
                        }
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 240)
                    .onChange(of: vm.minPctMove) { _, _ in Task { await vm.refresh() } }

                    Spacer()
                }
                .padding(.horizontal)

                if vm.rows.isEmpty {
                    EmptyState(message: vm.emptyMessage, systemImage: "chart.line.flattrend.xyaxis")
                        .padding(.horizontal)
                } else {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(vm.rows, id: \.dishName) { row in
                            MarginDeltaRowView(row: row)
                            Divider()
                        }
                    }
                    .padding(.horizontal)
                }
            }
            .padding(.vertical)
        }
    }
}

// MARK: - Row

private struct MarginDeltaRowView: View {
    let row: MarginDeltaRow

    /// up = per-serving cost INCREASED = bad/red; down = cheaper = good/green
    /// (page.jsx L143: tone = direction === 'up' ? 'red' : 'green').
    private var tone: Color { row.direction == .up ? LariatTheme.bad : LariatTheme.ok }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 1.5)
                .fill(tone)
                .frame(width: 3)

            VStack(alignment: .leading, spacing: 4) {
                Text(row.dishName)
                    .font(.headline)

                // baseline → latest, 4-decimal vendor-price surface (page L163-167).
                HStack(spacing: 4) {
                    Text(formatDollars(row.baselineCost, decimals: 4))
                        .monospacedDigit()
                    Text(marginDeltaDate(row.baselineAt))
                        .foregroundStyle(.secondary)
                    Text("→")
                        .foregroundStyle(.secondary)
                    Text(formatDollars(row.latestCost, decimals: 4))
                        .monospacedDigit()
                    Text(marginDeltaDate(row.latestAt))
                        .foregroundStyle(.secondary)
                }
                .font(.caption)

                // Top 3 contributing vendor SKUs (helper's own ranking — not
                // re-ranked here, page L168-184).
                if !row.topContributors.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        // Key mirrors page.jsx `${vendor}|${sku}|${ingredient}`.
                        ForEach(Array(row.topContributors.enumerated()), id: \.offset) { _, c in
                            HStack(spacing: 4) {
                                Text("•")
                                Text("\(c.vendor) · \(c.sku) · \(c.ingredient)")
                                Text(fmtPct(c.contributionPct))
                                    .fontWeight(.semibold)
                                    .monospacedDigit()
                                    .foregroundStyle(c.contributionPct >= 0 ? LariatTheme.bad : LariatTheme.ok)
                            }
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.top, 2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Text(fmtPct(row.deltaPct))
                .font(.system(.title3, design: .rounded))
                .fontWeight(.heavy)
                .monospacedDigit()
                .foregroundStyle(tone)
                .frame(minWidth: 80, alignment: .trailing)
        }
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(rowAccessibilityLabel)
    }

    /// Verbalizes dish name, baseline→latest price move (with dates), top
    /// contributors, and delta% as one VoiceOver stop. No tone word: `tone`
    /// is a pure function of `deltaPct`'s sign and `fmtPct` already signs the
    /// value (same reasoning as `ShowSettlementView.netDoorSection`).
    private var rowAccessibilityLabel: String {
        var parts = [row.dishName]
        parts.append(
            "\(formatDollars(row.baselineCost, decimals: 4)) on \(marginDeltaDate(row.baselineAt))"
            + " to \(formatDollars(row.latestCost, decimals: 4)) on \(marginDeltaDate(row.latestAt))")
        if !row.topContributors.isEmpty {
            let contributors = row.topContributors.map { c in
                "\(c.vendor) \(c.sku) \(c.ingredient) \(fmtPct(c.contributionPct))"
            }.joined(separator: ", ")
            parts.append("top contributors: \(contributors)")
        }
        parts.append("\(fmtPct(row.deltaPct)) change")
        return parts.joined(separator: ", ")
    }
}

/// `fmtDate` (page.jsx L37-46): "MMM d" from the snapshot's UTC
/// 'yyyy-MM-dd HH:mm:ss'; the raw string on parse failure.
func marginDeltaDate(_ iso: String) -> String {
    let parser = DateFormatter()
    parser.locale = Locale(identifier: "en_US_POSIX")
    parser.timeZone = TimeZone(identifier: "UTC")
    parser.dateFormat = "yyyy-MM-dd HH:mm:ss"
    guard let date = parser.date(from: iso) else { return iso }
    let out = DateFormatter()
    out.locale = Locale(identifier: "en_US_POSIX")
    out.dateFormat = "MMM d"
    return out.string(from: date)
}
