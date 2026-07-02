import Foundation
import LariatDB
import LariatModel
import Observation

/// Backs `house.bar` — parity with `app/bar/page.jsx` (pour-cost dashboard).
/// Read-only: recipes from data/cache/recipes.json + one recipe_costs query
/// per location, joined and toned in `BarCompute`. No writes, no PIN.
@Observable @MainActor
final class BarViewModel {
    private(set) var rows: [BarPourCostRow] = []
    private(set) var counts: [BarTone: Int] = [.red: 0, .yellow: 0, .green: 0, .gray: 0]
    private(set) var loaded = false
    var fetchError: String?
    var searchText = ""

    private let readDB: LariatDatabase
    private let locationId: String
    private let poller = BoardPoller()

    init(readDB: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.readDB = readDB
        self.locationId = locationId
    }

    var visibleRows: [BarPourCostRow] {
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return rows }
        return rows.filter {
            $0.name.lowercased().contains(q) || ($0.category?.lowercased().contains(q) ?? false)
        }
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
        let repo = BarRepository(readDB: readDB)
        do {
            let costRows = try await repo.loadCostRows(locationId: locationId)
            let recipes = BarRecipeLoader.load()
            rows = BarCompute.buildRows(recipes: recipes, costRows: costRows)
            counts = BarCompute.toneCounts(rows)
            fetchError = nil
        } catch {
            fetchError = "Could not load bar program"
        }
        loaded = true
    }
}
