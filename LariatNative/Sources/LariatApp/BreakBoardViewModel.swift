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

    /// Optional COMPS shift window. Off by default; when on, the two dates are
    /// serialized to ISO for `BreakCompute.evaluateShift` (no hand-typed ISO).
    var useShiftWindow = false
    var shiftStart: Date = Calendar.current.date(byAdding: .hour, value: -8, to: Date()) ?? Date()
    var shiftEnd: Date = Date()

    /// Visible hint when a COMPS evaluation was requested but can't run yet
    /// (e.g. no cook identity) — so "Refresh eval" never reads as a dead button.
    var evalHint: String?

    /// True when the window is enabled but end ≤ start — surfaced in the UI
    /// before the compute's own "Invalid shift timestamps" warning would fire.
    var shiftWindowInvalid: Bool { useShiftWindow && shiftEnd <= shiftStart }

    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

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
        // The board is "my breaks": with no identity the load is unfiltered
        // (everyone at the location), so ask who's here up front.
        if cookStore.cookId == nil {
            showCookPicker = true
        }
        poller.start(interval: .seconds(3)) { [weak self] in
            guard let self else { return }
            await self.refresh()
            try BoardPoller.throwIfFailed(self.fetchError)
        }
    }

    func stop() { poller.stop() }

    func refresh() async {
        let repo = BreakRepository(readDB: readDB, writeDB: writeDB)
        do {
            let start = useShiftWindow ? Self.isoFormatter.string(from: shiftStart) : nil
            let end = useShiftWindow ? Self.isoFormatter.string(from: shiftEnd) : nil
            snapshot = try await repo.load(
                cookId: cookStore.cookId,
                locationId: locationId,
                shiftStartedAt: start,
                shiftEndedAt: end
            )
            fetchError = nil
            if cookStore.cookId != nil { evalHint = nil }
        } catch {
            fetchError = "Could not load breaks"
        }
    }

    /// "Refresh eval" tap: a COMPS evaluation needs a cook identity (the repo
    /// only evaluates a single cook's breaks) — prompt for one instead of
    /// silently doing nothing.
    func requestEvaluation() async {
        guard cookStore.cookId != nil else {
            evalHint = "Pick who you are to evaluate breaks."
            showCookPicker = true
            return
        }
        evalHint = nil
        await refresh()
    }

    /// Cook picker dismissed — refresh right away so the list re-scopes to the
    /// picked identity (or stays clearly labeled all-workers on abort).
    func cookPickerDone() {
        showCookPicker = false
        Task { await refresh() }
    }

    /// Display name for a row's cook id via the staff catalog.
    func workerName(_ cookId: String) -> String {
        if let s = staff.first(where: { $0.id == cookId }) {
            let name = s.displayName
            return name.isEmpty ? cookId : name
        }
        return cookId
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
