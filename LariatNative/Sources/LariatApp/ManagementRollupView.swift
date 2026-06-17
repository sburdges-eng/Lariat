import SwiftUI
import LariatDB
import LariatModel
import Observation

@Observable @MainActor final class ManagementRollupViewModel {
    var snapshot: RollupSnapshot?
    var errorText: String?
    private var streamTask: Task<Void, Never>?

    func start() {
        streamTask?.cancel()
        do {
            let repo = ManagementRollupRepository(database: try LariatDatabase())
            streamTask = Task { [weak self] in
                for await s in repo.stream() {
                    await MainActor.run {
                        self?.snapshot = s
                        self?.errorText = nil
                    }
                }
            }
        } catch {
            errorText = "Can't open lariat.db at \(resolveDatabasePath()): \(error.localizedDescription)"
        }
    }

    func stop() { streamTask?.cancel() }
}

struct ManagementRollupView: View {
    @State private var vm = ManagementRollupViewModel()

    var body: some View {
        Group {
            if let err = vm.errorText {
                TileDegrade(
                    title: "Database unavailable",
                    message: err,
                    systemImage: "externaldrive.badge.xmark"
                )
            } else if let s = vm.snapshot {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 220))], spacing: 16) {
                        Tile(
                            title: "COGS variance",
                            value: s.variance.map { formatDollars($0.actualCogs - $0.theoreticalCogs) } ?? "—",
                            sub: s.variance?.variancePct.map { String(format: "%.1f%%", $0) }
                        )
                        Tile(
                            title: "Dish coverage",
                            value: s.coverage?.coveragePct.map { String(format: "%.1f%%", $0) } ?? "—",
                            sub: s.coverage.map { "\($0.coveredDishes ?? 0)/\($0.totalDishes ?? 0)" }
                        )
                        Tile(
                            title: "Pack-size changes",
                            value: "\(s.unacknowledgedPackSizeChanges)",
                            sub: "unacknowledged"
                        )
                    }
                    .padding()
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Management")
        .task { vm.start() }
        .onDisappear { vm.stop() }
    }
}

private struct Tile: View {
    let title: String
    let value: String
    var sub: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.system(.title, design: .rounded)).bold()
            if let sub { Text(sub).font(.caption2).foregroundStyle(.tertiary) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
    }
}
