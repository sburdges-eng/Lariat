import Foundation
import LariatDB
import LariatModel
import Observation

@Observable @MainActor
final class TphcViewModel {
    var snapshot: TphcBoardSnapshot?
    var fetchError: String?
    var actionError: String?
    var isSaving = false
    var showCookPicker = false

    let cookStore: CookIdentityStore
    var staff: [StaffMember] = []
    var staffUnavailable = false

    let kinds = TphcKind.allCases
    let discardReasons = TphcDiscardReason.allCases

    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let locationId: String
    let poller = BoardPoller()

    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        f.timeZone = TimeZone(secondsFromGMT: 0)
        return f
    }()

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
        let repo = TphcRepository(readDB: readDB, writeDB: writeDB)
        do {
            // Re-classify against the current wall clock each tick (mirrors the
            // web board's live urgency sort).
            snapshot = try await repo.load(locationId: locationId, now: Self.isoFormatter.string(from: Date()))
            fetchError = nil
        } catch {
            fetchError = "Could not load TPHC batches"
        }
    }

    /// Start a batch. `kind` is one of `kinds`; `station`/`batchRef` optional.
    func startBatch(item: String, kind: TphcKind, station: String, batchRef: String) async {
        guard !isSaving else { return }
        let trimmedItem = item.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedItem.isEmpty else {
            actionError = "Item is required"
            return
        }
        guard ensureCookIdentity() else { return }

        isSaving = true
        actionError = nil
        defer { isSaving = false }

        let repo = TphcRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: cookStore.cookId, locationId: locationId)
        do {
            _ = try repo.start(
                input: TphcStartInput(
                    item: trimmedItem,
                    startedAt: Self.isoFormatter.string(from: Date()),
                    kind: kind.rawValue,
                    stationId: station.isEmpty ? nil : station,
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

    /// Discard a batch with the given reason.
    func discard(id: Int64, reason: TphcDiscardReason) async {
        guard !isSaving else { return }
        guard ensureCookIdentity() else { return }

        isSaving = true
        actionError = nil
        defer { isSaving = false }

        let repo = TphcRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: cookStore.cookId, locationId: locationId)
        do {
            _ = try repo.discard(
                input: TphcDiscardInput(id: id, discardReason: reason.rawValue, cookId: cookStore.cookId),
                context: context
            )
            await refresh()
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }

    /// Live classification for a row (the snapshot already holds the tick's scan).
    func scanEntry(for row: TphcRow) -> TphcBatchStatus? {
        snapshot?.scanEntry(id: row.id)
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
