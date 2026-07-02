import Foundation
import LariatDB
import LariatModel
import Observation

@Observable @MainActor
final class TempLogViewModel {
    var snapshot: TempLogBoardSnapshot?
    var fetchError: String?
    var actionError: String?
    var isSaving = false
    var needsCorrectiveNote = false
    var calibrationWarning: String?
    var showCookPicker = false
    var showPinSheet = false
    var pendingPin: String = ""

    let cookStore: CookIdentityStore
    var staff: [StaffMember] = []
    var staffUnavailable = false

    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let locationId: String
    private let poller = BoardPoller()
    private var pendingPost: TempLogPostInput?

    var points: [TempPoint] { TempLogCompute.points }

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
        let repo = TempLogRepository(readDB: readDB, writeDB: writeDB)
        do {
            snapshot = try await repo.load(locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Could not load temp log"
        }
    }

    func submit(pointId: String, readingText: String, note: String) async {
        guard !isSaving else { return }
        let trimmed = readingText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            actionError = "Enter a temperature in °F"
            return
        }
        guard let reading = Double(trimmed), reading.isFinite else {
            actionError = "Enter a temperature in °F"
            return
        }
        guard ensureCookIdentity() else { return }

        let input = TempLogPostInput(
            shiftDate: ShiftDate.todayISO(),
            pointId: pointId,
            readingF: reading,
            correctiveAction: note.isEmpty ? nil : note,
            cookId: cookStore.cookId
        )
        await post(input: input, pin: nil)
    }

    func submitPinAndRetry() async {
        guard let input = pendingPost else {
            showPinSheet = false
            return
        }
        let pin = pendingPin
        pendingPin = ""
        showPinSheet = false
        await post(input: input, pin: pin.isEmpty ? nil : pin)
    }

    func cancelPinSheet() {
        pendingPost = nil
        pendingPin = ""
        showPinSheet = false
    }

    private func post(input: TempLogPostInput, pin: String?) async {
        isSaving = true
        actionError = nil
        calibrationWarning = nil
        defer { isSaving = false }

        let repo = TempLogRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: cookStore.cookId, locationId: locationId)
        do {
            let result = try repo.postReading(input: input, context: context, pin: pin)
            needsCorrectiveNote = false
            pendingPost = nil
            calibrationWarning = result.calibrationWarning
            await refresh()
        } catch let error as RuleGateError where error.needsCorrectiveAction {
            needsCorrectiveNote = true
            actionError = WriteErrorMapper.message(for: error)
        } catch TempLogWriteError.pinRequiredForPastDate {
            pendingPost = input
            showPinSheet = true
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
