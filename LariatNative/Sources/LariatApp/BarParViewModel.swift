import Foundation
import LariatDB
import LariatModel
import Observation

/// Backs `house.barPar` — parity with `app/bar/par/page.jsx`. Read-only
/// mirror of the inventory par board scoped to beverage categories; bar
/// managers add rows on /inventory/par (the native `inventory.par` board),
/// so this surface stays intentionally read-only.
@Observable @MainActor
final class BarParViewModel {
    private(set) var rows: [BarParRow] = []
    private(set) var loaded = false
    var fetchError: String?
    var showLowOnly = false
    var searchText = ""

    private let readDB: LariatDatabase
    private let locationId: String
    private var pollTask: Task<Void, Never>?

    init(readDB: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.readDB = readDB
        self.locationId = locationId
    }

    var lowCount: Int { rows.filter(\.isLow).count }
    var allCount: Int { rows.count }

    /// Category groups (name asc) over the Low/search-filtered rows —
    /// parity with the page's Map-based grouping.
    var grouped: [(category: String, rows: [BarParRow])] {
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        var visible = showLowOnly ? rows.filter(\.isLow) : rows
        if !q.isEmpty {
            visible = visible.filter {
                $0.ingredient.lowercased().contains(q) || ($0.vendor?.lowercased().contains(q) ?? false)
            }
        }
        let byCat = Dictionary(grouping: visible) { $0.category ?? "Other" }
        return byCat
            .map { (category: $0.key, rows: $0.value) }
            .sorted { $0.category < $1.category }
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
            rows = try await repo.loadParRows(locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Could not load bar par"
        }
        loaded = true
    }
}
