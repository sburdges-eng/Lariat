import Foundation
import LariatDB
import LariatModel
import Observation

@Observable @MainActor
final class SanitizerViewModel {
    var snapshot: SanitizerBoardSnapshot?
    var fetchError: String?
    var actionError: String?
    var isSaving = false
    var needsCorrectiveNote = false
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
        poller.start(interval: .seconds(5)) { [weak self] in
            guard let self else { return }
            await self.refresh()
            try BoardPoller.throwIfFailed(self.fetchError)
        }
    }

    func stop() { poller.stop() }

    func refresh() async {
        let repo = SanitizerRepository(readDB: readDB, writeDB: writeDB)
        do {
            snapshot = try await repo.load(locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Could not load sanitizer log"
        }
    }

    /// Points in DEFAULT_POINTS with no reading today yet — the "still to check"
    /// nudge. Mirrors the web `missingToday` memo (case-insensitive label match).
    var missingToday: [SanitizerPoint] {
        guard let snap = snapshot else { return [] }
        let seen = Set(snap.latest.map { $0.pointLabel.lowercased() })
        return snap.knownPoints.filter { !seen.contains($0.label.lowercased()) }
    }

    /// Record a ppm reading. `waterTempText` may be empty (nil water temp).
    func record(
        pointLabel: String,
        chemistry: SanitizerChemistry,
        ppmText: String,
        waterTempText: String,
        note: String
    ) async {
        guard !isSaving else { return }
        let trimmedLabel = pointLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedLabel.isEmpty else {
            actionError = "Point is required (e.g. dish pit final rinse)"
            return
        }
        let trimmedPpm = ppmText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let ppm = Double(trimmedPpm.replacingOccurrences(of: ",", with: ".")), ppm.isFinite else {
            actionError = "Strip reading must be a number in ppm"
            return
        }
        var waterTemp: Double?
        let trimmedTemp = waterTempText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedTemp.isEmpty {
            guard let v = Double(trimmedTemp.replacingOccurrences(of: ",", with: ".")), v.isFinite else {
                actionError = "Water temp must be a number in °F"
                return
            }
            waterTemp = v
        }
        guard ensureCookIdentity() else { return }

        isSaving = true
        actionError = nil
        defer { isSaving = false }

        let repo = SanitizerRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: cookStore.cookId, locationId: locationId)
        do {
            _ = try repo.record(
                input: SanitizerCheckInput(
                    pointLabel: trimmedLabel,
                    chemistry: chemistry.rawValue,
                    concentrationPpm: ppm,
                    waterTempF: waterTemp,
                    correctiveAction: note.isEmpty ? nil : note,
                    cookId: cookStore.cookId,
                    shiftDate: snapshot?.date
                ),
                context: context
            )
            needsCorrectiveNote = false
            await refresh()
        } catch let error as SanitizerWriteError where error.needsCorrectiveAction {
            needsCorrectiveNote = true
            actionError = "\(WriteErrorMapper.message(for: error)) — add a corrective action and re-submit"
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
