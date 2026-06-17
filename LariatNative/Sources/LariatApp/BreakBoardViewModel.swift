import Foundation
import LariatDB
import LariatModel
import Observation

@Observable @MainActor
final class BreakBoardViewModel {
    var snapshot: BreakBoardSnapshot?
    var fetchError: String?
    var actionError: String?
    var isSaving = false
    var showCookPicker = false

    let cookStore: CookIdentityStore
    var staff: [StaffMember] = []
    var staffUnavailable = false

    var shiftStartedAt = ""
    var shiftEndedAt = ""

    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let locationId: String
    private var streamTask: Task<Void, Never>?

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
        let repo = BreakRepository(readDB: readDB, writeDB: writeDB)
        do {
            let start = shiftStartedAt.isEmpty ? nil : shiftStartedAt
            let end = shiftEndedAt.isEmpty ? nil : shiftEndedAt
            snapshot = try await repo.load(
                cookId: cookStore.cookId,
                locationId: locationId,
                shiftStartedAt: start,
                shiftEndedAt: end
            )
            fetchError = nil
        } catch {
            fetchError = "Could not load breaks"
        }
    }

    func startBreak(kind: BreakKind) async {
        guard !isSaving else { return }
        guard ensureCookIdentity() else { return }
        isSaving = true
        actionError = nil
        defer { isSaving = false }

        let repo = BreakRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: cookStore.cookId, locationId: locationId)
        do {
            _ = try repo.start(
                input: BreakStartInput(kind: kind, cookId: cookStore.cookId ?? ""),
                context: context
            )
            await refresh()
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }

    func endBreak(id: Int64) async {
        guard !isSaving else { return }
        guard ensureCookIdentity() else { return }
        isSaving = true
        actionError = nil
        defer { isSaving = false }

        let repo = BreakRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: cookStore.cookId, locationId: locationId)
        do {
            _ = try repo.end(id: id, context: context)
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
