import Foundation
import LariatDB
import LariatModel
import Observation

@Observable @MainActor
final class KdsPunchViewModel {
    var snapshot: KdsBoardSnapshot?
    var fetchError: String?
    var actionError: String?
    var bumpError: String?
    var isSaving = false
    var showCookPicker = false
    private var bumpingIds: Set<String> = []

    let cookStore: CookIdentityStore
    var staff: [StaffMember] = []
    var staffUnavailable = false

    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let locationId: String
    let poller = BoardPoller()

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
        let repo = KdsTicketRepository(readDB: readDB, writeDB: writeDB)
        do {
            snapshot = try await repo.loadOpen(locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Could not load open tickets"
        }
    }

    /// Returns true only when the ticket write committed. Aborting for cook
    /// identity (picker presented) returns false WITHOUT setting actionError —
    /// the view must keep its drafts and stash a retry.
    @discardableResult
    func punch(
        orderNumber: String,
        destination: String,
        lines: [KdsPunchLineInput]
    ) async -> Bool {
        guard !isSaving else { return false }
        guard ensureCookIdentity() else { return false }
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
            return true
        } catch {
            actionError = WriteErrorMapper.message(for: error)
            return false
        }
    }

    func isBumping(_ ticketId: String) -> Bool { bumpingIds.contains(ticketId) }

    /// Bump-back — completes the ticket lifecycle via `KdsTicketRepository.bump`
    /// (server-stamped time; the state row records the bump, web parity keeps
    /// the ticket on the open board). No cook gate: the web bump endpoint
    /// accepts anonymous bumps from hardware displays.
    func bump(_ ticketId: String) async {
        guard !bumpingIds.contains(ticketId) else { return }
        bumpingIds.insert(ticketId)
        bumpError = nil
        defer { bumpingIds.remove(ticketId) }

        let repo = KdsTicketRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: cookStore.cookId, locationId: locationId)
        do {
            _ = try repo.bump(ticketId: ticketId, input: KdsBumpInput(), context: context)
            await refresh()
        } catch {
            bumpError = WriteErrorMapper.message(for: error)
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
