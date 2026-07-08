import Foundation
import LariatDB
import LariatModel
import Observation

/// Backs `foh.floor` — parity with `app/floor/page.jsx` + `FloorPlan.jsx`:
/// the dining-room table grid, the per-table status verbs (open → seated →
/// dirty → open, close/reopen), the empty-floor starter set, and the
/// seat-a-reservation flow.
///
/// Writes are `actor_source = native_cook` — /floor is NOT PIN-gated on
/// web; it uses the `lariat_cook` identity (the FloorPlan source itself
/// says it "matches the EightySixBoard pattern"). Cook identity is only
/// required to seat a reservation, exactly the action the web disables
/// without a cook.
@Observable @MainActor
final class FloorViewModel {
    var tables: [DiningTableRow] = []
    var reservations: [FloorReservationRow] = []
    var loaded = false
    var fetchError: String?
    var actionError: String?
    /// Single shared in-flight write — while true, all action buttons
    /// disable (web `busyId` posture).
    var isBusy = false
    var selectedId: String?

    var showCookPicker = false
    var staff: [StaffMember] = []
    var staffUnavailable = false
    let cookStore: CookIdentityStore

    let poller = BoardPoller()
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let locationId: String

    init(
        readDB: LariatDatabase,
        writeDB: LariatWriteDatabase,
        cookStore: CookIdentityStore? = nil,
        locationId: String = LocationScope.resolve()
    ) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.cookStore = cookStore ?? CookIdentityStore.shared
        self.locationId = locationId
        loadStaff()
    }

    var counts: FloorStatusCounts { FloorCompute.statusCounts(tables) }

    var selected: DiningTableRow? {
        guard let selectedId else { return nil }
        return tables.first { $0.id == selectedId }
    }

    func start() {
        poller.start(interval: .seconds(4)) { [weak self] in
            guard let self else { return }
            await self.refresh()
            try BoardPoller.throwIfFailed(self.fetchError)
        }
    }

    func stop() { poller.stop() }

    func refresh() async {
        let repo = DiningTablesRepository(readDB: readDB, writeDB: writeDB)
        do {
            tables = try await repo.list(locationId: locationId)
            reservations = try await repo.openReservationsToday(locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Could not load the floor"
        }
        loaded = true
    }

    /// Status verb tap (FloorPlan `onChangeStatus`). No cook gate — parity
    /// with the web board, which PATCHes status without requiring one.
    func changeStatus(id: String, to status: String) async {
        guard !isBusy else { return }
        isBusy = true
        actionError = nil
        defer { isBusy = false }

        let repo = DiningTablesRepository(readDB: readDB, writeDB: writeDB)
        do {
            try repo.update(
                id: id,
                patch: DiningTablePatch(status: status, cookId: cookStore.cookId),
                context: context()
            )
            await refresh()
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }

    /// Seat a reservation at a table. Requires cook identity (web parity).
    /// One repository call — the seat verb's in-transaction table wiring
    /// already flips the floor square, so the web's redundant second PATCH
    /// (which always 400s 'no change') is not reproduced.
    func seatReservation(reservationId: Int64, tableId: String) async {
        guard !isBusy else { return }
        guard ensureCookIdentity() else { return }
        isBusy = true
        actionError = nil
        defer { isBusy = false }

        let repo = ReservationsRepository(readDB: readDB, writeDB: writeDB)
        do {
            try repo.update(
                id: reservationId,
                patch: ReservationPatch(seat: true, tableId: tableId, cookId: cookStore.cookId),
                context: context()
            )
            await refresh()
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }

    /// Empty-floor starter set (T1–T6). A duplicate id is benign — someone
    /// else may have seeded already (web treats 409 as skip-and-continue).
    func addStarterTables() async {
        guard !isBusy else { return }
        isBusy = true
        actionError = nil
        defer { isBusy = false }

        let repo = DiningTablesRepository(readDB: readDB, writeDB: writeDB)
        for starter in FloorCompute.starterTables {
            do {
                _ = try repo.create(
                    input: DiningTableCreateInput(
                        id: starter.id, name: starter.name, capacity: starter.capacity,
                        x: starter.x, y: starter.y, w: starter.w, h: starter.h,
                        cookId: cookStore.cookId
                    ),
                    context: context()
                )
            } catch DiningTableWriteError.idAlreadyInUse {
                continue
            } catch {
                actionError = WriteErrorMapper.message(for: error)
                return
            }
        }
        await refresh()
    }

    private func context() -> RegulatedWriteContext {
        RegulatedWriteContext.nativeCook(cookId: cookStore.cookId, locationId: locationId)
    }

    private func ensureCookIdentity() -> Bool {
        if cookStore.cookId != nil { return true }
        showCookPicker = true
        return false
    }

    private func loadStaff() {
        do {
            staff = try StaffCatalog.load()
            staffUnavailable = staff.isEmpty
        } catch {
            staff = []
            staffUnavailable = true
        }
    }
}
