import Foundation
import LariatDB
import LariatModel
import Observation

@Observable @MainActor
final class StationChecklistViewModel {
    var snapshot: StationChecklistSnapshot?
    var fetchError: String?
    var actionError: String?
    var isSaving = false
    var showCookPicker = false
    var staff: [StaffMember] = []
    var staffUnavailable = false

    private var streamTask: Task<Void, Never>?
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let catalog: StationCatalog
    let cookStore: CookIdentityStore
    private let locationId: String
    let stationId: String

    init(
        stationId: String,
        readDB: LariatDatabase,
        writeDB: LariatWriteDatabase,
        catalog: StationCatalog,
        cookStore: CookIdentityStore? = nil,
        locationId: String = LocationScope.resolve()
    ) {
        self.stationId = stationId
        self.readDB = readDB
        self.writeDB = writeDB
        self.catalog = catalog
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
        let repo = LineCheckRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)
        do {
            snapshot = try await repo.loadChecklist(stationId: stationId, locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Could not load checklist"
        }
    }

    func post(
        item: String,
        status: LineCheckStatus,
        par: String = "",
        have: String = "",
        need: String = "",
        note: String = ""
    ) async {
        guard !isSaving else { return }
        guard ensureCookIdentity() else { return }

        isSaving = true
        actionError = nil
        defer { isSaving = false }

        let repo = LineCheckRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)
        let context = RegulatedWriteContext.nativeCook(cookId: cookStore.cookId, locationId: locationId)
        do {
            _ = try repo.postEntry(
                LineCheckPostInput(
                    shiftDate: ShiftDate.todayISO(),
                    stationId: stationId,
                    item: item,
                    status: status,
                    cookId: cookStore.cookId ?? "",
                    par: par.isEmpty ? nil : par,
                    have: have.isEmpty ? nil : have,
                    need: need.isEmpty ? nil : need,
                    note: note.isEmpty ? nil : note
                ),
                context: context
            )
            await refresh()
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }

    func signoff() async {
        guard !isSaving else { return }
        guard ensureCookIdentity() else { return }

        isSaving = true
        actionError = nil
        defer { isSaving = false }

        let repo = LineCheckRepository(readDB: readDB, writeDB: writeDB, catalog: catalog)
        let context = RegulatedWriteContext.nativeCook(cookId: cookStore.cookId, locationId: locationId)
        do {
            _ = try repo.signoff(stationId: stationId, context: context)
            await refresh()
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
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
