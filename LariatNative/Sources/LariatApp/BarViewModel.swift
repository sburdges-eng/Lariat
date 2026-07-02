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
    private var pollTask: Task<Void, Never>?

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
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }

    func stop() { pollTask?.cancel() }

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
