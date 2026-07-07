import Foundation
import LariatDB
import LariatModel
import Observation

@Observable @MainActor
final class PrepViewModel {
    var snapshot: PrepBoardSnapshot?
    var fetchError: String?
    var actionError: String?
    var isSaving = false
    private var busyIds: Set<Int64> = []
    let poller = BoardPoller()

    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    let cookStore: CookIdentityStore
    private let stations: [KitchenStation]
    private let locationId: String

    var showCookPicker = false
    var staff: [StaffMember] = []
    var staffUnavailable = false

    var stationOptions: [KitchenStation] { stations }
    var cookId: String? { cookStore.cookId }

    init(
        readDB: LariatDatabase,
        writeDB: LariatWriteDatabase,
        stations: [KitchenStation],
        cookStore: CookIdentityStore? = nil,
        locationId: String = LocationScope.resolve()
    ) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.stations = stations
        self.cookStore = cookStore ?? CookIdentityStore.shared
        self.locationId = locationId
        loadStaff()
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
        let repo = PrepRepository(readDB: readDB, writeDB: writeDB)
        do {
            snapshot = try await repo.load(locationId: locationId, stations: stations)
            fetchError = nil
        } catch {
            fetchError = "Could not load prep board"
        }
    }

    func isBusy(_ id: Int64) -> Bool { busyIds.contains(id) }

    // MARK: - add (POST)

    /// Returns true only when the task write committed (the view clears its
    /// drafts on true, never on a silent early return).
    @discardableResult
    func add(task: String, stationId: String, qty: String, priority: PrepPriority, notes: String) async -> Bool {
        guard !isSaving else { return false }
        let trimmed = task.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }

        isSaving = true
        actionError = nil
        defer { isSaving = false }

        let repo = PrepRepository(readDB: readDB, writeDB: writeDB)
        do {
            _ = try repo.create(
                input: PrepTaskCreateInput(
                    task: trimmed,
                    shiftDate: ShiftDate.todayISO(),
                    stationId: stationId.isEmpty ? nil : stationId,
                    qty: qty.isEmpty ? nil : qty,
                    notes: notes.isEmpty ? nil : notes,
                    priority: priority.rawValue,
                    assignedCookId: cookStore.cookId,
                    cookId: cookStore.cookId
                ),
                context: writeContext()
            )
            await refresh()
            return true
        } catch {
            actionError = WriteErrorMapper.message(for: error)
            return false
        }
    }

    // MARK: - lifecycle actions (PATCH)

    @discardableResult
    func claim(_ id: Int64) async -> Bool {
        guard ensureCookIdentity() else { return false }
        return await mutate(id) { repo, ctx in
            _ = try repo.patch(id: id, input: .claimBy(self.cookStore.cookId), context: ctx)
        }
    }

    @discardableResult
    func releaseClaim(_ id: Int64) async -> Bool {
        await mutate(id) { repo, ctx in
            _ = try repo.patch(id: id, input: .releaseClaim(cookId: self.cookStore.cookId), context: ctx)
        }
    }

    @discardableResult
    func setStatus(_ id: Int64, _ status: PrepStatus) async -> Bool {
        if status != .todo, !ensureCookIdentity() { return false }
        return await mutate(id) { repo, ctx in
            _ = try repo.patch(id: id, input: .status(status.rawValue, cookId: self.cookStore.cookId), context: ctx)
        }
    }

    // MARK: - delete (DELETE)

    @discardableResult
    func delete(_ id: Int64) async -> Bool {
        await mutate(id) { repo, ctx in
            try repo.delete(id: id, context: ctx)
        }
    }

    private func mutate(_ id: Int64, _ work: (PrepRepository, RegulatedWriteContext) throws -> Void) async -> Bool {
        guard !busyIds.contains(id) else { return false }
        busyIds.insert(id)
        actionError = nil
        defer { busyIds.remove(id) }

        let repo = PrepRepository(readDB: readDB, writeDB: writeDB)
        do {
            try work(repo, writeContext())
            await refresh()
            return true
        } catch {
            actionError = WriteErrorMapper.message(for: error)
            return false
        }
    }

    private func writeContext() -> RegulatedWriteContext {
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
