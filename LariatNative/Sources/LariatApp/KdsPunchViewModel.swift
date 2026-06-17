import Foundation
import LariatDB
import LariatModel
import Observation

@Observable @MainActor
final class KdsPunchViewModel {
    var snapshot: KdsBoardSnapshot?
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
        let repo = KdsTicketRepository(readDB: readDB, writeDB: writeDB)
        do {
            snapshot = try await repo.loadOpen(locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Could not load open tickets"
        }
    }

    func punch(
        orderNumber: String,
        destination: String,
        lines: [KdsPunchLineInput]
    ) async {
        guard !isSaving else { return }
        guard ensureCookIdentity() else { return }
        isSaving = true
        actionError = nil
        defer { isSaving = false }

        let repo = KdsTicketRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: cookStore.cookId, locationId: locationId)
        do {
            _ = try repo.punch(
                input: KdsPunchInput(
                    orderNumber: orderNumber,
                    destination: destination.isEmpty ? nil : destination,
                    lines: lines,
                    cookId: cookStore.cookId
                ),
                context: context
            )
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
