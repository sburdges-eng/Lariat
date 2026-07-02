import Foundation
import LariatDB
import LariatModel
import Observation

@Observable @MainActor
final class DateMarkViewModel {
    var snapshot: DateMarkBoardSnapshot?
    var fetchError: String?
    var actionError: String?
    var isSaving = false
    var showCookPicker = false

    let cookStore: CookIdentityStore
    var staff: [StaffMember] = []
    var staffUnavailable = false

    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let locationId: String
    private let poller = BoardPoller()

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

    func start() {
        poller.start(interval: .seconds(3)) { [weak self] in
            guard let self else { return }
            await self.refresh()
            try BoardPoller.throwIfFailed(self.fetchError)
        }
    }

    func stop() { poller.stop() }

    func refresh() async {
        let repo = DateMarkRepository(readDB: readDB, writeDB: writeDB)
        do {
            snapshot = try await repo.load(locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Could not load date marks"
        }
    }

    func create(item: String, preparedOn: String, batchRef: String) async {
        guard !isSaving else { return }
        guard ensureCookIdentity() else { return }
        isSaving = true
        actionError = nil
        defer { isSaving = false }

        let repo = DateMarkRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: cookStore.cookId, locationId: locationId)
        do {
            _ = try repo.create(
                input: DateMarkCreateInput(
                    item: item,
                    preparedOn: preparedOn,
                    batchRef: batchRef.isEmpty ? nil : batchRef,
                    cookId: cookStore.cookId
                ),
                context: context
            )
            await refresh()
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }

    func discard(id: Int64, reason: DateMarkDiscardReason) async {
        guard !isSaving else { return }
        guard ensureCookIdentity() else { return }
        isSaving = true
        actionError = nil
        defer { isSaving = false }

        let repo = DateMarkRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: cookStore.cookId, locationId: locationId)
        do {
            _ = try repo.discard(id: id, reason: reason, context: context)
            await refresh()
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }

    func status(for row: DateMarkRow) -> ExpiringBatchStatus? {
        snapshot?.scan.first(where: { $0.id == row.id })?.status
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
