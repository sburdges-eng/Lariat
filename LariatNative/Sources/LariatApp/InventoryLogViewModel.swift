import Foundation
import LariatDB
import LariatModel
import Observation

/// Inventory LOG board view model — parity with `app/inventory/log/page.jsx` +
/// `POST /api/inventory` (A4.1). Lists today's movements (newest first) and logs
/// a manual movement (free-text qty/delta — the T8 toast shrinkage path is
/// POS-driven, not a hand entry). Audited write, no PIN (/inventory unregulated);
/// actor_source native_cook.
@Observable @MainActor
final class InventoryLogViewModel {
    var rows: [InventoryUpdateRow] = []
    var fetchError: String?
    var actionError: String?
    var showForm = false

    // Log-movement form.
    var item = ""
    var qtyText = ""
    var unit = ""
    var direction = "out"
    var note = ""

    let directions = ["out", "in", "waste"]

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
        do {
            rows = try await repo.listUpdates(date: ShiftDate.todayISO(), locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Could not load inventory log"
        }
    }

    func addMovement() {
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
                    direction: direction,
                    note: note.isEmpty ? nil : note
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
        item = ""; qtyText = ""; unit = ""; direction = "out"; note = ""
    }
}
