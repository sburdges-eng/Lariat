import Foundation
import LariatDB
import LariatModel
import Observation

@Observable @MainActor
final class StationsListViewModel {
    var rows: [StationListRow] = []
    var fetchError: String?
    private let poller = BoardPoller()

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
        poller.start(interval: .seconds(3)) { [weak self] in
            guard let self else { return }
            await self.refresh()
            try BoardPoller.throwIfFailed(self.fetchError)
        }
    }

    func stop() { poller.stop() }

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
