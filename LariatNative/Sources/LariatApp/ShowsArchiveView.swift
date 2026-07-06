import SwiftUI
import LariatDB
import LariatModel
import Observation

/// Shows archive — native port of `app/shows/archive` (`ArchiveSearch.jsx` +
/// `GET /api/shows?op=archive`). Read-only: band-substring search
/// (`.searchable`) + era-year filter over `shows_archive`. PIN-gated
/// whole-board (web SENSITIVE_PREFIXES parity).
struct ShowsArchiveView: View {
    @State private var gateModel: ShowsGateModel
    @State private var vm: ShowsArchiveViewModel

    init(database: LariatDatabase, writeDatabase: LariatWriteDatabase?) {
        _gateModel = State(wrappedValue: ShowsGateModel(database: database, writeDatabase: writeDatabase))
        _vm = State(wrappedValue: ShowsArchiveViewModel(database: database))
    }

    var body: some View {
        ShowsGatedBoard(gateModel: gateModel, title: "Show archive") {
            content
                .task { vm.start() }
                .onDisappear { vm.stop() }
        }
    }

    @ViewBuilder
    private var content: some View {
        if let err = vm.fetchError, vm.rows.isEmpty {
            TileDegrade(title: "Could not load the archive", message: err, systemImage: "archivebox")
        } else {
            List {
                Section {
                    Picker("Era", selection: $vm.era) {
                        Text("All eras").tag(nil as Int?)
                        ForEach(vm.eras, id: \.self) { era in
                            Text(String(era)).tag(era as Int?)
                        }
                    }
                    .pickerStyle(.menu)
                }
                Section("Shows (\(vm.rows.count))") {
                    if vm.rows.isEmpty {
                        EmptyState(message: "No archived shows match.", systemImage: "archivebox")
                    } else {
                        ForEach(vm.rows) { row in
                            HStack {
                                Text(row.showDate).foregroundStyle(.secondary)
                                    .frame(minWidth: 100, alignment: .leading)
                                Text(row.bandName)
                                Spacer()
                                if let era = row.eraYear {
                                    Text(String(era)).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            .font(.callout)
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
            }
            .searchable(text: $vm.query, prompt: "Search bands")
            .onChange(of: vm.query) { Task { await vm.refresh() } }
            .onChange(of: vm.era) { Task { await vm.refresh() } }
        }
    }
}

/// Archive view model — polls every 5 s and re-queries on filter changes.
@Observable @MainActor
final class ShowsArchiveViewModel {
    var rows: [ShowsArchiveRow] = []
    var eras: [Int] = []
    var query = ""
    var era: Int?
    var fetchError: String?

    private let database: LariatDatabase
    private let locationId: String
    private let poller = BoardPoller()

    init(database: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.database = database
        self.locationId = locationId
    }

    func start() {
        poller.start(interval: .seconds(5)) { [weak self] in
            guard let self else { return }
            await self.refresh()
            try BoardPoller.throwIfFailed(self.fetchError)
        }
    }

    func stop() { poller.stop() }

    func refresh() async {
        let repo = ShowsRepository(readDB: database, locationId: locationId)
        do {
            let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
            rows = try await repo.archiveSearch(q: q.isEmpty ? nil : q, era: era)
            eras = try await repo.archiveEras()
            fetchError = nil
        } catch {
            fetchError = "Could not load the archive"
        }
    }
}
