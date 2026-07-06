import SwiftUI
import LariatDB
import LariatModel
import Observation

// MARK: - ViewModel

/// Backs `costing.menuEngineering` — the menu-performance hub
/// (`app/menu-engineering/page.tsx`): per-dish quadrant table fed by the
/// REAL dish-cost bridge (A4.3 T1), coverage counters, unlinked-revenue
/// call-out, the plowhorse hazard banner, and the past-prep-median column
/// (`beo_prep_history` via `BeoPrepHistoryRepository.prepMedians`, page.tsx
/// L63-76). Polls every 3 s (sibling VM precedent).
@Observable @MainActor final class MenuEngineeringViewModel {
    var result: BridgedMenuEngineeringResult?
    var coverageReport: DishCoverageReport?
    var prepMedians: [String: BeoPrepMedian] = [:]
    var lastComputeRun: String?
    var errorText: String?
    var isLoading = true
    var query = ""

    private let poller = BoardPoller()
    private let repo: MenuEngineeringRepository
    private let prepRepo: BeoPrepHistoryRepository
    private let recipes: [BridgeRecipe]
    private let locationId: String

    init(database: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.repo = MenuEngineeringRepository(database: database, locationId: locationId)
        self.prepRepo = BeoPrepHistoryRepository(database: database)
        self.locationId = locationId
        // recipes.json discovery layer — [] when absent (web getRecipes parity).
        self.recipes = DishBridgeRecipeLoader.load()
    }

    func start() {
        poller.start(interval: .seconds(3)) { [weak self] in
            guard let self else { return }
            await self.refresh()
            try BoardPoller.throwIfFailed(self.errorText)
        }
    }

    func stop() { poller.stop() }

    private func refresh() async {
        do {
            let bundle = try await repo.fetch()
            let map = DishCostBridge.buildDishComponentMap(
                recipes: recipes,
                recipeCosts: bundle.bridgeInputs.recipeCosts,
                vendorPrices: bundle.bridgeInputs.vendorPrices,
                orderGuideItems: bundle.bridgeInputs.orderGuideItems,
                dishComponents: bundle.bridgeInputs.dishComponents)
            result = DishCostBridge.computeMenuEngineering(sales: bundle.sales, map: map)
            coverageReport = DishCostBridge.computeDishCoverage(sales: bundle.sales, map: map)
            lastComputeRun = bundle.lastComputeRun
            // Past-prep medians (page.tsx L63-76): exact case-insensitive
            // match on item_name — no fuzzy matching; this column has to be
            // precise to work as a planning number. A median failure keeps
            // the board alive with an empty map (web try/catch parity).
            do {
                let names = (result?.rows ?? []).map(\.itemName)
                prepMedians = try await prepRepo.prepMedians(items: names, locationId: locationId)
            } catch {
                prepMedians = [:]
            }
            errorText = nil
            isLoading = false
        } catch {
            errorText = "Fetch error: \(error.localizedDescription)"
            isLoading = false
        }
    }

    /// Prep-median lookup — key shape parity with page.tsx L204-210:
    /// `trim()` THEN `toLowerCase()` (matches `keyedItems`' key derivation).
    func prepMedian(for itemName: String) -> BeoPrepMedian? {
        prepMedians[itemName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()]
    }

    /// Web sort (page.tsx L52-57): unlinked rows last, everything else by
    /// net sales DESC. Stable, mirroring JS Array.sort.
    var sortedRows: [BridgedMenuEngineeringRow] {
        guard let rows = result?.rows else { return [] }
        return rows.enumerated().sorted { a, b in
            let aUnlinked = a.element.linkState == .unlinked
            let bUnlinked = b.element.linkState == .unlinked
            if aUnlinked != bUnlinked { return !aUnlinked }
            if a.element.netSales != b.element.netSales { return a.element.netSales > b.element.netSales }
            return a.offset < b.offset
        }.map(\.element)
    }

    /// `.searchable` filter on dish name (native convention; the web page has
    /// no search — filtering is additive, never changes the data).
    var visibleRows: [BridgedMenuEngineeringRow] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return sortedRows }
        return sortedRows.filter { $0.itemName.lowercased().contains(q) }
    }

    /// Critical margin hazards (page.tsx L59-61): high-volume plowhorses
    /// below the 20% margin floor.
    var hazards: [BridgedMenuEngineeringRow] {
        sortedRows.filter { $0.quadrant == .plowhorse && ($0.marginPct ?? 100) < 20.0 }
    }
}

// MARK: - Root view

struct MenuEngineeringView: View {
    @State private var vm: MenuEngineeringViewModel
    private let navigate: (String) -> Void

    init(database: LariatDatabase, navigate: @escaping (String) -> Void = { _ in }) {
        _vm = State(wrappedValue: MenuEngineeringViewModel(database: database))
        self.navigate = navigate
    }

    var body: some View {
        Group {
            if let err = vm.errorText {
                TileDegrade(
                    title: "Database unavailable",
                    message: err,
                    systemImage: "externaldrive.badge.xmark"
                )
            } else if vm.isLoading {
                ProgressView("Loading menu performance…")
            } else {
                MenuEngineeringContentView(vm: vm, navigate: navigate)
            }
        }
        .navigationTitle("Menu performance")
        .searchable(text: Binding(get: { vm.query }, set: { vm.query = $0 }), prompt: "Find a dish")
        .task { vm.start() }
        .onDisappear { vm.stop() }
    }
}

// MARK: - Quadrant / link-state styling (page.tsx Q + LINK_BADGE)

private func quadrantLabel(_ q: Quadrant) -> String {
    switch q {
    case .star: return "Star"
    case .plowhorse: return "Plowhorse"
    case .puzzle: return "Puzzle"
    case .dog: return "Dog"
    case .unknown: return "Unknown"
    }
}

private func quadrantColor(_ q: Quadrant) -> Color {
    switch q {
    case .star: return LariatTheme.ok
    case .plowhorse: return LariatTheme.warn
    case .puzzle: return .blue
    case .dog: return LariatTheme.muted
    case .unknown: return LariatTheme.muted
    }
}

private func quadrantDescription(_ q: Quadrant) -> String {
    switch q {
    case .star: return "High margin & popularity. Protect availability — never 86 a star."
    case .plowhorse: return "Low margin, high popularity. Reprice or sub a cheaper component before margin drift sinks the night."
    case .puzzle: return "High margin, low popularity. Push it on specials boards — the room does not know it exists."
    case .dog: return "Low margin & popularity. Cut from the menu unless it anchors a category."
    case .unknown: return "Need cost data — wire dish_components first."
    }
}

private func linkBadge(_ s: DishLinkState) -> (label: String, color: Color) {
    switch s {
    case .fullyLinked: return ("linked", LariatTheme.ok)
    case .partial: return ("partial", LariatTheme.warn)
    case .declaredOnly: return ("no qty entered", LariatTheme.warn)
    case .unlinked: return ("no recipe link", LariatTheme.bad)
    }
}

// MARK: - Content

private struct MenuEngineeringContentView: View {
    @Bindable var vm: MenuEngineeringViewModel
    let navigate: (String) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("What each dish makes us, and how often it sells. Stars sell a lot and make money. Dogs do neither.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    if let lastRun = vm.lastComputeRun {
                        Text("Compute Engine Last Ran: \(lastRun)")
                            .font(.caption)
                            .foregroundStyle(LariatTheme.amber)
                    }
                }
                .accessibilityElement(children: .combine)
                .padding(.horizontal)

                if let result = vm.result {
                    CoverageBanner(coverage: result.coverage, navigate: navigate)
                        .padding(.horizontal)
                }

                if let report = vm.coverageReport, !report.unlinkedDishes.isEmpty {
                    UnlinkedDishesCallout(report: report)
                        .padding(.horizontal)
                }

                if !vm.hazards.isEmpty {
                    HazardBanner(hazards: vm.hazards)
                        .padding(.horizontal)
                }

                if let result = vm.result {
                    MedianLegendCard(result: result)
                        .padding(.horizontal)
                }

                if vm.sortedRows.isEmpty {
                    EmptyState(message: "No sales data yet. Populate sales_lines to see menu performance.",
                               systemImage: "chart.bar.xaxis")
                        .padding(.horizontal)
                } else if vm.visibleRows.isEmpty {
                    EmptyState(message: "No dishes match the search.", systemImage: "magnifyingglass")
                        .padding(.horizontal)
                } else {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(vm.visibleRows, id: \.itemName) { row in
                            MenuEngineeringRowView(row: row, prepMedian: vm.prepMedian(for: row.itemName))
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

// MARK: - Coverage banner (page.tsx L98-117)

private struct CoverageBanner: View {
    let coverage: BridgedMenuEngineeringCoverage
    let navigate: (String) -> Void

    private var alarming: Bool { coverage.unlinked > coverage.fullyLinked }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            (Text("Bridge coverage: ").bold()
                + Text("\(coverage.fullyLinked) fully linked · \(coverage.partial) partial · \(coverage.declaredOnly) no qty · \(coverage.unlinked) no recipe link ")
                + Text("(\(coverage.total) dishes total)").foregroundStyle(.secondary))
                .font(.caption)
            if coverage.declaredOnly > 0 || coverage.unlinked > 0 {
                Button {
                    navigate("costing.components")
                } label: {
                    Text("→ Open the dish-components editor to fill in per-serving quantities")
                        .font(.caption)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.blue)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10)
            .stroke(alarming ? LariatTheme.bad : .clear, lineWidth: 1))
    }
}

// MARK: - Unlinked-revenue call-out (page.tsx L119-141)

private struct UnlinkedDishesCallout: View {
    let report: DishCoverageReport

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("No recipe link — biggest revenue gaps")
                .font(.caption)
                .fontWeight(.semibold)
                .textCase(.uppercase)
                .tracking(1)
            Text("These dishes appear in sales but no recipe declares them in menu_items[]. Add the recipe → dish link in data/cache/recipes.json, OR add a dish_components row directly.")
                .font(.caption2)
                .foregroundStyle(.secondary)
            ForEach(report.unlinkedDishes.prefix(10), id: \.itemName) { d in
                (Text(d.itemName).bold()
                    + Text(" — \(formatDollars(d.netSales, decimals: 0)) (\(Int(d.qty)) sold)"))
                    .font(.caption)
            }
            if report.unlinkedDishes.count > 10 {
                Text("+ \(report.unlinkedDishes.count - 10) more")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(LariatTheme.warn, lineWidth: 1))
    }
}

// MARK: - Plowhorse hazard banner (page.tsx L143-159)

private struct HazardBanner: View {
    let hazards: [BridgedMenuEngineeringRow]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Critical Margin Hazards")
                .font(.caption)
                .fontWeight(.semibold)
                .textCase(.uppercase)
                .tracking(1)
                .foregroundStyle(LariatTheme.bad)
            Text("High-volume Plowhorses below 20% margin. Consider catalog alternatives for these heavy movers.")
                .font(.caption2)
                .foregroundStyle(.secondary)
            // One hazard per line (web `.stack` wraps; a non-wrapping HStack
            // truncated dish names once there were more than ~4 hazards).
            VStack(alignment: .leading, spacing: 2) {
                ForEach(hazards, id: \.itemName) { h in
                    Text("\(h.itemName) (\(h.marginPct.map { String(format: "%.1f", $0) } ?? "—")%)")
                        .font(.caption)
                        .bold()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(LariatTheme.bad, lineWidth: 1))
    }
}

// MARK: - Median + quadrant legend (page.tsx L161-172)

private struct MedianLegendCard: View {
    let result: BridgedMenuEngineeringResult

    private static let legendOrder: [Quadrant] = [.star, .plowhorse, .puzzle, .dog, .unknown]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(String(format: "Median margin (matched items): %.1f%%", result.medianMargin))
                .font(.caption)
                .foregroundStyle(.secondary)
            ForEach(Self.legendOrder, id: \.self) { q in
                (Text(quadrantLabel(q)).bold().foregroundStyle(quadrantColor(q))
                    + Text(" — \(quadrantDescription(q))").foregroundStyle(.secondary))
                    .font(.caption2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
    }
}

// MARK: - Dish row (page.tsx table L174-272)

private struct MenuEngineeringRowView: View {
    let row: BridgedMenuEngineeringRow
    let prepMedian: BeoPrepMedian?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(row.itemName)
                    .font(.headline)
                let badge = linkBadge(row.linkState)
                Text(badge.label)
                    .font(.caption2)
                    .bold()
                    .foregroundStyle(badge.color)
                Spacer()
                Text(quadrantLabel(row.quadrant))
                    .font(.caption)
                    .bold()
                    .foregroundStyle(quadrantColor(row.quadrant))
            }
            .accessibilityElement(children: .combine)

            HStack(spacing: 14) {
                stat("Qty", String(format: "%.0f", row.qty))
                prepMedianStat(prepMedian)
                stat("Net $", formatDollars(row.netSales, decimals: 2))
                stat("Avg $", formatDollars(row.avgPrice, decimals: 2))
                stat("Cost/u", row.costPerUnit.map { formatDollars($0, decimals: 2) } ?? "—")
                marginStat(row.marginPct)
            }

            if !row.components.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(row.components.enumerated()), id: \.offset) { _, c in
                        componentLine(c)
                    }
                }
                .padding(.top, 2)
            }
        }
        .padding(.vertical, 8)
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.caption2).foregroundStyle(.tertiary)
            Text(value).font(.caption).monospacedDigit()
        }
        .accessibilityElement(children: .combine)
    }

    /// Prep-median cell (page.tsx L202-221): the median rounded to a whole
    /// number plus a muted "(N)" sample count; "—" when no `beo_prep_history`
    /// rows match this item name.
    private func prepMedianStat(_ m: BeoPrepMedian?) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("Prep median").font(.caption2).foregroundStyle(.tertiary)
            if let m {
                (Text(String(format: "%.0f", m.median)).monospacedDigit()
                    + Text(" (\(m.samples))").foregroundStyle(.secondary))
                    .font(.caption)
                    .help("\(m.samples) event\(m.samples == 1 ? "" : "s") contributed")
            } else {
                Text("—").font(.caption).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// Margin cell: red + bold below the 20% floor (page.tsx L225-227) — the
    /// one confirmed color-only signal in this row.
    private func marginStat(_ marginPct: Double?) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("Margin %").font(.caption2).foregroundStyle(.tertiary)
            if let m = marginPct {
                Text(String(format: "%.1f%%", m))
                    .font(.caption)
                    .monospacedDigit()
                    .bold(m < 20)
                    .foregroundStyle(m < 20 ? LariatTheme.bad : .primary)
            } else {
                Text("—").font(.caption)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(marginStatAccessibilityLabel(marginPct))
    }

    private func marginStatAccessibilityLabel(_ marginPct: Double?) -> String {
        guard let m = marginPct else { return "Margin %: —" }
        var text = "Margin %: \(String(format: "%.1f%%", m))"
        if m < 20 { text += ", below the 20% floor" }
        return text
    }

    /// One component sub-line (page.tsx L231-265): R/D tag, display name,
    /// qty·unit or "(no qty)", computed $, and non-ok status flags.
    private func componentLine(_ c: DishComponentResolved) -> some View {
        HStack(spacing: 4) {
            Text(c.componentType == "vendor_item" ? "D" : "R")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(c.componentType == "vendor_item" ? .blue : LariatTheme.ok)
            Text(c.displayName)
            if let qty = c.qtyPerServing, let unit = c.unit {
                Text("· \(qty.formatted()) \(unit)")
            } else {
                Text("· (no qty)")
            }
            if let cost = c.perServingCost {
                Text("= \(formatDollars(cost, decimals: 2))")
                    .foregroundStyle(.secondary)
            }
            if c.status != .ok && c.status != .noDishComponent {
                Text("[\(c.status.rawValue)]")
                    .foregroundStyle(LariatTheme.bad)
            }
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
        .accessibilityElement(children: .combine)
    }
}
