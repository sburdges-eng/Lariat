import Foundation
import LariatDB
import LariatModel
import Observation

enum ReservationsBoardTab: String, CaseIterable, Identifiable {
    case today, upcoming
    var id: String { rawValue }
    var label: String { self == .today ? "Today" : "Upcoming" }
}

/// Backs `foh.reservations` — parity with `app/reservations/page.jsx` +
/// `ReservationsBoard.jsx`: today/upcoming views, the add form, and the
/// seat/complete/cancel/no_show/delete verbs.
///
/// Writes are `actor_source = native_cook` — /reservations is NOT in the
/// web middleware's gated set ("a regular line-of-service tool"); the web
/// board uses the `lariat_cook` identity, requiring it only for Seat.
@Observable @MainActor
final class ReservationsBoardViewModel {
    var rows: [ReservationRow] = []
    var tab: ReservationsBoardTab = .today {
        didSet { Task { await refresh() } }
    }
    var loaded = false
    var fetchError: String?
    var actionError: String?
    var busyId: Int64?
    var isAdding = false

    var showCookPicker = false
    var staff: [StaffMember] = []
    var staffUnavailable = false
    let cookStore: CookIdentityStore

    private var streamTask: Task<Void, Never>?
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let locationId: String

    /// Today's date — the add form books onto this date (web parity: the
    /// form posts `"<today> <HH:MM>"`).
    let date = ShiftDate.todayISO()

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

    var buckets: [(key: String, rows: [ReservationRow])] { ReservationsCompute.hourBuckets(rows) }
    var counts: ReservationCounts { ReservationsCompute.counts(rows) }

    func start() {
        streamTask?.cancel()
        streamTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(for: .seconds(4))
            }
        }
    }

    func stop() { streamTask?.cancel() }

    func refresh() async {
        let repo = ReservationsRepository(readDB: readDB, writeDB: writeDB)
        do {
            switch tab {
            case .today:
                rows = try await repo.today(date: date, locationId: locationId)
            case .upcoming:
                rows = try await repo.upcoming(from: date, locationId: locationId)
            }
            fetchError = nil
        } catch {
            fetchError = "Could not load reservations"
        }
        loaded = true
    }

    /// Add-form submit. Returns true when saved (so the view can clear its
    /// fields). Validation mirrors the web form: name, size 1..50, and a
    /// parseable time.
    func add(
        partyName: String,
        partySizeText: String,
        timeText: String,
        tableId: String,
        phone: String,
        notes: String
    ) async -> Bool {
        guard !isAdding else { return false }
        let name = partyName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            actionError = "Party name required."
            return false
        }
        guard let size = Int(partySizeText), (1...50).contains(size) else {
            actionError = "Party size must be 1..50."
            return false
        }
        guard let hhmm = ReservationsCompute.parseTimeTo24h(timeText) else {
            actionError = "Time required, e.g. \"7:00 PM\" or \"19:00\"."
            return false
        }

        isAdding = true
        actionError = nil
        defer { isAdding = false }

        let repo = ReservationsRepository(readDB: readDB, writeDB: writeDB)
        do {
            _ = try repo.create(
                input: ReservationCreateInput(
                    partyName: name,
                    partySize: size,
                    reservationAt: "\(date) \(hhmm)",
                    tableId: tableId.isEmpty ? nil : tableId,
                    phone: phone.isEmpty ? nil : phone,
                    notes: notes.isEmpty ? nil : notes,
                    cookId: cookStore.cookId
                ),
                context: context()
            )
            await refresh()
            return true
        } catch {
            actionError = WriteErrorMapper.message(for: error)
            return false
        }
    }

    /// Seat requires a cook identity (web disables Seat without one); the
    /// closing verbs do not.
    func seat(id: Int64) async {
        guard ensureCookIdentity() else { return }
        await patch(id: id, patch: ReservationPatch(seat: true, cookId: cookStore.cookId))
    }

    func complete(id: Int64) async {
        await patch(id: id, patch: ReservationPatch(complete: true, cookId: cookStore.cookId))
    }

    func cancel(id: Int64) async {
        await patch(id: id, patch: ReservationPatch(cancel: true, cookId: cookStore.cookId))
    }

    func noShow(id: Int64) async {
        await patch(id: id, patch: ReservationPatch(noShow: true, cookId: cookStore.cookId))
    }

    func delete(id: Int64) async {
        guard busyId == nil else { return }
        busyId = id
        actionError = nil
        defer { busyId = nil }

        let repo = ReservationsRepository(readDB: readDB, writeDB: writeDB)
        do {
            try repo.delete(id: id, context: context())
            await refresh()
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }

    private func patch(id: Int64, patch: ReservationPatch) async {
        guard busyId == nil else { return }
        busyId = id
        actionError = nil
        defer { busyId = nil }

        let repo = ReservationsRepository(readDB: readDB, writeDB: writeDB)
        do {
            try repo.update(id: id, patch: patch, context: context())
            await refresh()
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
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
