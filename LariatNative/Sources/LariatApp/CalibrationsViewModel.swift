import Foundation
import LariatDB
import LariatModel
import Observation

@Observable @MainActor
final class CalibrationsViewModel {
    var snapshot: CalibrationBoardSnapshot?
    var fetchError: String?
    var actionError: String?
    var advisoryMessage: String?
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
        let repo = CalibrationRepository(readDB: readDB, writeDB: writeDB)
        do {
            snapshot = try await repo.load(locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Could not load calibrations"
        }
    }

    func submit(thermometerId: String, method: CalibrationMethod, readingText: String, note: String) async {
        guard !isSaving else { return }
        let trimmed = readingText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let reading = Double(trimmed), reading.isFinite else {
            actionError = "Enter a temperature in °F"
            return
        }
        guard ensureCookIdentity() else { return }

        isSaving = true
        actionError = nil
        advisoryMessage = nil
        defer { isSaving = false }

        let repo = CalibrationRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: cookStore.cookId, locationId: locationId)
        do {
            let result = try repo.post(
                input: CalibrationPostInput(
                    thermometerId: thermometerId,
                    method: method,
                    readingF: reading,
                    note: note.isEmpty ? nil : note,
                    cookId: cookStore.cookId
                ),
                context: context
            )
            if !result.decision.passed, let reason = result.decision.reason {
                advisoryMessage = reason
            }
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
