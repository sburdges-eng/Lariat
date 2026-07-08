import Foundation
import LariatDB
import LariatModel
import Observation

/// Inventory WASTE board view model — parity with `app/inventory/waste/page.jsx`
/// + `POST /api/inventory` (direction='waste') (A4.1). Shows a most-wasted-by-item
/// rollup and the recent waste rows over a range window (1/7/30 days), and logs a
/// waste entry. Audited write, no PIN; actor_source native_cook.
@Observable @MainActor
final class InventoryWasteViewModel {
    var recent: [InventoryUpdateRow] = []
    var byItem: [WasteByItemRow] = []
    var fetchError: String?
    var actionError: String?
    var days = 7 { didSet { Task { await refresh() } } }
    var showForm = false

    // Log-waste form.
    var item = ""
    var stationId = ""
    var qtyText = ""
    var unit = ""
    var reason = ""

    let ranges = [1, 7, 30]

    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let locationId: String
    let poller = BoardPoller()

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase, locationId: String = LocationScope.resolve()) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.locationId = locationId
    }

    private var repo: InventoryUpdateRepository { InventoryUpdateRepository(readDB: readDB, writeDB: writeDB) }

    func start() {
        poller.start(interval: .seconds(5)) { [weak self] in
            guard let self else { return }
            await self.refresh()
            try BoardPoller.throwIfFailed(self.fetchError)
        }
    }

    func stop() { poller.stop() }

    func refresh() async {
        let clamped = InventoryWaste.clampDays(Double(days))
        let since = InventoryWaste.sinceDate(today: ShiftDate.todayISO(), days: clamped)
        do {
            async let recentRows = repo.wasteRecent(since: since, locationId: locationId)
            async let items = repo.wasteByItem(since: since, locationId: locationId)
            recent = try await recentRows
            byItem = try await items
            fetchError = nil
        } catch {
            fetchError = "Could not load waste log"
        }
    }

    func logWaste() {
        actionError = nil
        guard !item.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            actionError = "Item is required."
            return
        }
        do {
            _ = try repo.logUpdate(
                input: InventoryLogInput(
                    item: item,
                    qty: Double(qtyText),
                    unit: unit.isEmpty ? nil : unit,
                    direction: "waste",
                    note: reason.isEmpty ? nil : reason,
                    stationId: stationId.isEmpty ? nil : stationId
                ),
                context: .nativeCook(cookId: nil, locationId: locationId)
            )
            resetForm()
            showForm = false
            Task { await refresh() }
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }

    private func resetForm() {
        item = ""; stationId = ""; qtyText = ""; unit = ""; reason = ""
    }
}
