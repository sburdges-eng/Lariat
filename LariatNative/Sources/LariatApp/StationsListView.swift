import SwiftUI
import LariatDB
import LariatModel

struct StationsListView: View {
    @State private var vm: StationsListViewModel
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
            } else if vm.rows.isEmpty {
                ProgressView()
            } else {
                List(vm.rows) { row in
                    NavigationLink(value: row.station.id) {
                        stationRow(row)
                    }
                }
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
        .onDisappear { vm.stop() }
    }

    private func stationRow(_ row: StationListRow) -> some View {
        let tone = StationProgressLabels.tone(for: row.progress)
        return HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(row.station.name).font(.headline)
                Text(StationProgressLabels.label(for: row.progress))
                    .font(.subheadline)
                    .foregroundStyle(toneColor(tone))
            }
            Spacer()
            Circle().fill(toneColor(tone)).frame(width: 10, height: 10)
        }
        .padding(.vertical, 4)
    }

    private func toneColor(_ tone: StationProgressLabels.Tone) -> Color {
        switch tone {
        case .muted: return .secondary
        case .red: return .red
        case .green: return .green
        case .amber: return Color(red: 0.89, green: 0.69, blue: 0.29)
        }
    }
}
