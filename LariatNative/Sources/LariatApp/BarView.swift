import SwiftUI
import LariatDB
import LariatModel

/// Native port of `/bar` — cocktail pour costs at a glance. Manager-facing
/// analytics; read-only (no PIN on the web either). Thresholds: ≤ 18 % green,
/// 18–22 % yellow, > 22 % red; gray rows explain what's missing.
struct BarView: View {
    @State private var vm: BarViewModel
    private let navigate: (String) -> Void

    init(readDB: LariatDatabase, navigate: @escaping (String) -> Void) {
        _vm = State(wrappedValue: BarViewModel(readDB: readDB))
        self.navigate = navigate
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.rows.isEmpty {
                TileDegrade(title: "Could not load bar program", message: err, systemImage: "wineglass")
            } else if !vm.loaded {
                ProgressView("Loading pour costs…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                content
            }
        }
        .navigationTitle("Bar program")
        .task { vm.start() }
        .onDisappear { vm.stop() }
        .toolbar {
            ToolbarItem {
                Button("Bar par") { navigate("house.barPar") }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        List {
            Section("Pour-cost distribution") {
                distribution
            }
            if vm.rows.isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Bar setup not ready").font(.headline)
                        Text("No bar recipes are ready for pour-cost tracking yet. Add cocktail recipes with menu prices and recipe costs, then this board will sort them.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
            } else {
                Section {
                    ForEach(vm.visibleRows) { row in
                        pourRow(row)
                    }
                    if vm.visibleRows.isEmpty {
                        EmptyState(message: "No cocktails match the search.", systemImage: "magnifyingglass")
                    }
                }
            }
        }
        .searchable(text: $vm.searchText, prompt: "Search cocktails")
    }

    @ViewBuilder
    private var distribution: some View {
        // Same buckets + labels as the web stats card.
        HStack(spacing: 18) {
            countBadge(vm.counts[.green] ?? 0, "on target", "≤ \(Int(BarCompute.pourCostGreenMax))%", LariatTheme.ok)
            countBadge(vm.counts[.yellow] ?? 0, "watch", "\(Int(BarCompute.pourCostGreenMax))–\(Int(BarCompute.pourCostYellowMax))%", LariatTheme.warn)
            countBadge(vm.counts[.red] ?? 0, "over", "> \(Int(BarCompute.pourCostYellowMax))%", LariatTheme.bad)
            countBadge(vm.counts[.gray] ?? 0, "unpriced", "missing cost or menu", LariatTheme.muted)
        }
        .padding(.vertical, 2)
    }

    private func countBadge(_ n: Int, _ label: String, _ meta: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("\(n) \(label)")
                .font(.callout.bold())
                .foregroundStyle(color)
            Text(meta)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func pourRow(_ row: BarPourCostRow) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text(row.name).font(.callout.weight(.semibold))
                    if let category = row.category {
                        Text(category.uppercased())
                            .font(.caption2)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.secondary.opacity(0.4)))
                            .foregroundStyle(.secondary)
                    }
                }
                Text("Cost \(money(row.costPerPour)) / pour · Menu \(money(row.menuPrice))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if let pct = row.pourCostPct {
                Text(String(format: "%.1f%%", pct))
                    .font(.title3.bold())
                    .foregroundStyle(color(for: row.tone))
            } else {
                Text(row.grayReason ?? "unpriced")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(pourRowAccessibilityLabel(row))
    }

    /// Verbalizes the pour-cost tone otherwise conveyed only by the trailing
    /// percentage's color — same wording `distribution`'s badges already use.
    private func pourRowAccessibilityLabel(_ row: BarPourCostRow) -> String {
        var parts = [row.name]
        if let category = row.category { parts.append(category) }
        parts.append("Cost \(money(row.costPerPour)) per pour, Menu \(money(row.menuPrice))")
        if let pct = row.pourCostPct {
            parts.append(String(format: "%.1f%% pour cost, %@", pct, toneWord(row.tone)))
        } else {
            parts.append(row.grayReason ?? "unpriced")
        }
        return parts.joined(separator: ", ")
    }

    /// No pre-existing `Tone`/word helper to reuse — `color(for:)` (elsewhere in
    /// this file) only maps to `Color`, not words. New helper, same case order.
    private func toneWord(_ tone: BarTone) -> String {
        switch tone {
        case .red: return "over"
        case .yellow: return "watch"
        case .green: return "on target"
        case .gray: return "unpriced"
        }
    }

    /// `formatDollars` parity — '—' when null.
    private func money(_ v: Double?) -> String {
        guard let v else { return "—" }
        return formatDollars(v, decimals: 2)
    }

    private func color(for tone: BarTone) -> Color {
        switch tone {
        case .red: return LariatTheme.bad
        case .yellow: return LariatTheme.warn
        case .green: return LariatTheme.ok
        case .gray: return LariatTheme.muted
        }
    }
}
