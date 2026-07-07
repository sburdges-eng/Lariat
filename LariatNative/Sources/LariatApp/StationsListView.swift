import SwiftUI
import LariatDB
import LariatModel

struct StationsListView: View {
    @State private var vm: StationsListViewModel
    @State private var query = ""
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let catalog: StationCatalog

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase, catalog: StationCatalog) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.catalog = catalog
        _vm = State(wrappedValue: StationsListViewModel(readDB: readDB, writeDB: writeDB, catalog: catalog))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.rows.isEmpty {
                TileDegrade(title: "Could not load stations", message: err, systemImage: "externaldrive.badge.xmark")
            } else if !vm.hasLoaded {
                ProgressView("Loading stations…")
            } else if vm.rows.isEmpty {
                EmptyState(
                    message: "No stations configured — check data/cache/stations.json",
                    systemImage: "square.grid.2x2"
                )
            } else {
                List {
                    if filteredRows.isEmpty {
                        EmptyState(message: "No stations match “\(query)”", systemImage: "magnifyingglass")
                    }
                    ForEach(filteredRows) { row in
                        NavigationLink(value: row.station.id) {
                            stationRow(row)
                        }
                    }
                }
                .searchable(text: $query, prompt: "Find a station")
                .navigationDestination(for: String.self) { stationId in
                    StationChecklistView(
                        stationId: stationId,
                        readDB: readDB,
                        writeDB: writeDB,
                        catalog: catalog
                    )
                }
            }
        }
        .navigationTitle("Stations")
        .task { vm.start() }
        .tracksActiveBoard(vm.poller)
        .onDisappear { vm.stop() }
    }

    private func stationRow(_ row: StationListRow) -> some View {
        let tone = StationProgressLabels.tone(for: row.progress)
        return HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(row.station.name).font(.headline)
                Text(StationProgressLabels.label(for: row.progress))
                    .font(.subheadline)
                    .foregroundStyle(LariatTheme.color(for: tone))
            }
            Spacer()
            Circle().fill(LariatTheme.color(for: tone)).frame(width: 10, height: 10)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(row.station.name), \(StationProgressLabels.label(for: row.progress))")
    }

    private var filteredRows: [StationListRow] {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return vm.rows }
        return vm.rows.filter { $0.station.name.localizedCaseInsensitiveContains(q) }
    }
}
