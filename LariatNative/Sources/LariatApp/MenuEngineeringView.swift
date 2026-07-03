import SwiftUI
import LariatDB
import LariatModel
import Observation

// Standalone Menu Engineering screen — the native port of app/menu-engineering/page.tsx.
//
// Reuses the shared cost engine rather than duplicating it: CostingRepository
// supplies the aggregated sales lines and CostingCompute.computeMenuEngineering
// performs the quadrant classification (the same pipeline that backs the
// "Cost checks" screen's quadrant grid). This screen adds the detail the grid
// omits: a full per-item table and the "Critical Margin Hazards" call-out,
// shaped by MenuEngineeringPresentation.
//
// PARITY GAP (inherited from CostingCompute): cost_per_unit is read from a
// staging column production does not yet populate, so items may fall to the
// 'unknown' quadrant until the dish_components → recipe_costs rollup is ported.

// MARK: - ViewModel

@Observable @MainActor final class MenuEngineeringViewModel {
    var result: MenuEngineeringResult?
    var errorText: String?
    private var streamTask: Task<Void, Never>?
    private let database: LariatDatabase

    init(database: LariatDatabase) {
        self.database = database
    }

    func start() {
        streamTask?.cancel()
        let repo = CostingRepository(database: database)
        streamTask = Task { [weak self] in
            // Poll every 3 s — mirrors CostingViewModel; ValueObservation can't
            // see the web app's cross-process writes to lariat.db.
            while !Task.isCancelled {
                do {
                    let bundle = try await repo.fetch()
                    let me = CostingCompute.computeMenuEngineering(salesLines: bundle.salesLines)
                    await MainActor.run {
                        self?.result = me
                        self?.errorText = nil
                    }
                } catch {
                    await MainActor.run {
                        self?.errorText = "Fetch error: \(error.localizedDescription)"
                    }
                }
                try? await Task.sleep(for: .seconds(3))
            }
        }
    }

    func stop() { streamTask?.cancel() }
}

// MARK: - Root view

struct MenuEngineeringView: View {
    @State private var vm: MenuEngineeringViewModel
    init(database: LariatDatabase) {
        _vm = State(wrappedValue: MenuEngineeringViewModel(database: database))
    }

    var body: some View {
        Group {
            if let err = vm.errorText {
                TileDegrade(
                    title: "Database unavailable",
                    message: err,
                    systemImage: "externaldrive.badge.xmark"
                )
            } else if let result = vm.result {
                MenuEngineeringContentView(result: result)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Menu Engineering")
        .task { vm.start() }
        .onDisappear { vm.stop() }
    }
}

// MARK: - Content

private struct MenuEngineeringContentView: View {
    let result: MenuEngineeringResult

    private var hazards: [MenuEngineeringRow] {
        MenuEngineeringPresentation.hazards(result.rows)
    }

    private var tableRows: [MenuEngineeringRow] {
        MenuEngineeringPresentation.sortedForTable(result.rows)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("What each dish makes us, and how often it sells. Stars sell a lot and make money; dogs do neither.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                HStack(spacing: 8) {
                    Text(String(format: "Median margin %.1f%%", result.medianMargin))
                    Text("·").foregroundStyle(.tertiary)
                    Text(String(format: "Median popularity %.2f", result.medianPop))
                }
                .font(.caption)
                .foregroundStyle(.tertiary)

                if !hazards.isEmpty {
                    MarginHazardsBanner(rows: hazards)
                }

                if result.rows.isEmpty {
                    TileDegrade(
                        title: "No sales data yet",
                        message: "Populate sales_lines to see menu performance.",
                        systemImage: "chart.bar.xaxis"
                    )
                    .frame(height: 120)
                } else {
                    MenuEngineeringTable(rows: tableRows)
                }
            }
            .padding()
        }
    }
}

// MARK: - Critical margin hazards banner

private struct MarginHazardsBanner: View {
    let rows: [MenuEngineeringRow]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Critical margin hazards", systemImage: "exclamationmark.triangle.fill")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.orange)

            Text("High-volume plowhorses below \(Int(MenuEngineeringPresentation.marginHazardThresholdPct))% margin — reprice or swap a cheaper component before margin drift sinks the night.")
                .font(.caption2)
                .foregroundStyle(.secondary)

            ForEach(rows, id: \.itemName) { row in
                HStack {
                    Text(row.itemName)
                        .font(.caption)
                        .lineLimit(1)
                    Spacer()
                    Text(row.marginPct.map { String(format: "%.1f%%", $0) } ?? "—")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .monospacedDigit()
                        .foregroundStyle(.red)
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
    }
}

// MARK: - Per-item table

private struct MenuEngineeringTable: View {
    let rows: [MenuEngineeringRow]

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 6) {
            GridRow {
                Text("Item").gridColumnAlignment(.leading)
                Text("Qty").gridColumnAlignment(.trailing)
                Text("Net $").gridColumnAlignment(.trailing)
                Text("Avg $").gridColumnAlignment(.trailing)
                Text("Cost/u").gridColumnAlignment(.trailing)
                Text("Margin %").gridColumnAlignment(.trailing)
                Text("Quadrant").gridColumnAlignment(.leading)
            }
            .font(.caption2)
            .fontWeight(.semibold)
            .foregroundStyle(.secondary)
            .textCase(.uppercase)

            Divider()

            ForEach(rows, id: \.itemName) { row in
                GridRow {
                    Text(row.itemName)
                        .font(.caption)
                        .lineLimit(1)
                    Text(String(format: "%.0f", row.qty))
                        .font(.caption).monospacedDigit()
                    Text(formatDollars(row.netSales))
                        .font(.caption).monospacedDigit()
                    Text(formatDollars(row.avgPrice, decimals: 2))
                        .font(.caption).monospacedDigit()
                    Text(row.costPerUnit.map { formatDollars($0, decimals: 2) } ?? "—")
                        .font(.caption).monospacedDigit()
                    Text(row.marginPct.map { String(format: "%.1f%%", $0) } ?? "—")
                        .font(.caption).monospacedDigit()
                        .foregroundStyle(marginColor(row.marginPct))
                    QuadrantBadge(quadrant: row.quadrant)
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
    }

    /// Mirror the web table: margins under the hazard threshold render red.
    private func marginColor(_ pct: Double?) -> Color {
        guard let pct else { return .secondary }
        return pct < MenuEngineeringPresentation.marginHazardThresholdPct ? .red : .primary
    }
}

// MARK: - Quadrant badge

private struct QuadrantBadge: View {
    let quadrant: Quadrant

    var body: some View {
        Text(label)
            .font(.caption2)
            .fontWeight(.semibold)
            .foregroundStyle(color)
    }

    // Labels + colors mirror CostingView's QuadrantCell for a consistent palette.
    private var label: String {
        switch quadrant {
        case .star:      return "Star"
        case .puzzle:    return "Puzzle"
        case .plowhorse: return "Plowhorse"
        case .dog:       return "Dog"
        case .unknown:   return "Unknown"
        }
    }

    private var color: Color {
        switch quadrant {
        case .star:      return .green
        case .puzzle:    return .blue
        case .plowhorse: return .orange
        case .dog:       return .secondary
        case .unknown:   return .gray
        }
    }
}
