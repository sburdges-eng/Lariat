import Foundation
import LariatDB
import LariatModel
import Observation

@Observable @MainActor
final class StationsListViewModel {
    var rows: [StationListRow] = []
    var fetchError: String?
    private var streamTask: Task<Void, Never>?

    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let catalog: StationCatalog
    private let locationId: String

    init(
        readDB: LariatDatabase,
        writeDB: LariatWriteDatabase,
        catalog: StationCatalog,
        locationId: String = LocationScope.resolve()
    ) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.catalog = catalog
        self.locationId = locationId
    }

    func start() {
        streamTask?.cancel()
        streamTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(for: .seconds(3))
            }
        }
    }

    func stop() { streamTask?.cancel() }

    func refresh() async {
        let repo = LineCheckRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)
        do {
            rows = try await repo.loadStationList(locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Could not load stations"
        }
    }
}
