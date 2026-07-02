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
    private var streamTask: Task<Void, Never>?

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

    func add(task: String, stationId: String, qty: String, priority: PrepPriority, notes: String) async {
        guard !isSaving else { return }
        let trimmed = task.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

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
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }

    // MARK: - lifecycle actions (PATCH)

    func claim(_ id: Int64) async {
        guard ensureCookIdentity() else { return }
        await mutate(id) { repo, ctx in
            _ = try repo.patch(id: id, input: .claimBy(self.cookStore.cookId), context: ctx)
        }
    }

    func releaseClaim(_ id: Int64) async {
        await mutate(id) { repo, ctx in
            _ = try repo.patch(id: id, input: .releaseClaim(cookId: self.cookStore.cookId), context: ctx)
        }
    }

    func setStatus(_ id: Int64, _ status: PrepStatus) async {
        if status != .todo, !ensureCookIdentity() { return }
        await mutate(id) { repo, ctx in
            _ = try repo.patch(id: id, input: .status(status.rawValue, cookId: self.cookStore.cookId), context: ctx)
        }
    }

    // MARK: - delete (DELETE)

    func delete(_ id: Int64) async {
        await mutate(id) { repo, ctx in
            try repo.delete(id: id, context: ctx)
        }
    }

    private func mutate(_ id: Int64, _ work: (PrepRepository, RegulatedWriteContext) throws -> Void) async {
        guard !busyIds.contains(id) else { return }
        busyIds.insert(id)
        actionError = nil
        defer { busyIds.remove(id) }

        let repo = PrepRepository(readDB: readDB, writeDB: writeDB)
        do {
            try work(repo, writeContext())
            await refresh()
        } catch {
            actionError = WriteErrorMapper.message(for: error)
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
