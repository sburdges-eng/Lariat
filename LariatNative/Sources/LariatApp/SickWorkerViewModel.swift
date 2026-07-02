import Foundation
import LariatDB
import LariatModel
import Observation

/// Sick-worker board view model — parity with `SickWorkerBoard.jsx` +
/// `/api/sick-worker`. Filing and clearing reports are PIC authority in the web
/// app (route 403 without the manager PIN); here `pinOk` reflects the native
/// `PinSessionStore` so the UI mirrors the web PIC gate. Regulated writes are
/// tagged `native_cook` via `RegulatedWriteContext` and audited in-transaction.
@Observable @MainActor
final class SickWorkerViewModel {
    var snapshot: SickWorkerBoardSnapshot?
    var fetchError: String?
    var actionError: String?
    var isSaving = false
    var showCookPicker = false

    // New-report form state (mirrors the JSX component state).
    var reportCookId = ""
    var reportPicId = ""
    var selectedSymptoms: Set<SickSymptom> = []
    var selectedDiagnosis: SickDiagnosis?
    var overrideAction: SickAction?
    var reportNote = ""

    let cookStore: CookIdentityStore
    let pinStore: PinSessionStore
    var staff: [StaffMember] = []
    var staffUnavailable = false

    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let locationId: String
    private let poller = BoardPoller()

    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    /// FDA return-to-work clearance sources (mirrors `CLEARANCE_SOURCES`).
    static let clearanceSources: [(id: String, label: String)] = [
        ("asymptomatic_24h", "Asymptomatic ≥ 24h"),
        ("medical_clearance", "Medical clearance (note)"),
        ("health_dept", "Health dept clearance"),
        ("other", "Other (add note)"),
    ]

    init(
        readDB: LariatDatabase,
        writeDB: LariatWriteDatabase,
        cookStore: CookIdentityStore? = nil,
        pinStore: PinSessionStore? = nil,
        locationId: String = LocationScope.resolve()
    ) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.cookStore = cookStore ?? CookIdentityStore.shared
        self.pinStore = pinStore ?? PinSessionStore.shared
        self.locationId = locationId
        loadStaff()
    }

    /// Whether filing/clearing is permitted — the web PIC gate. A valid manager
    /// PIN session unlocks the write surfaces.
    var pinOk: Bool { pinStore.activeUser != nil }

    /// FDA minimum action for the current symptom/diagnosis selection — mirrors
    /// the JSX `suggestedAction` useMemo. The PIC may raise but not lower it.
    var suggestedAction: SickAction {
        SickWorkerCompute.requiredActionFor(
            symptoms: Array(selectedSymptoms),
            diagnosis: selectedDiagnosis
        )
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
        let repo = SickWorkerRepository(readDB: readDB, writeDB: writeDB)
        do {
            snapshot = try await repo.load(locationId: locationId, includeHistory: pinOk)
            fetchError = nil
        } catch {
            fetchError = "Could not load sick worker list"
        }
    }

    /// File a new sick report (PIC authority). Validation + the FDA-floor gate
    /// run in the repository against the web `validateSickReport` rules.
    func fileReport() async {
        guard !isSaving else { return }
        guard pinOk else {
            actionError = "Manager PIN required to file a sick report."
            return
        }
        let cook = reportCookId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cook.isEmpty else {
            actionError = "Pick the worker first."
            return
        }
        if selectedSymptoms.isEmpty && selectedDiagnosis == nil {
            actionError = "Either a symptom or a diagnosis is required."
            return
        }

        isSaving = true
        actionError = nil
        defer { isSaving = false }

        let repo = SickWorkerRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: cookStore.cookId, locationId: locationId)
        let action = overrideAction ?? suggestedAction
        let pic = reportPicId.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            _ = try repo.file(
                input: SickReportFileInput(
                    cookId: cook,
                    reportedByPicId: pic.isEmpty ? nil : pic,
                    symptoms: selectedSymptoms.map(\.rawValue),
                    diagnosedIllness: selectedDiagnosis?.rawValue,
                    action: action.rawValue,
                    startedAt: Self.isoFormatter.string(from: Date()),
                    note: reportNote.isEmpty ? nil : reportNote,
                    shiftDate: snapshot.map { _ in ShiftDate.todayISO() }
                ),
                context: context
            )
            resetForm()
            await refresh()
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }

    /// Clear (return-to-work) an open report with a documented clearance source.
    func clear(id: Int64, source: String) async {
        guard !isSaving else { return }
        guard pinOk else {
            actionError = "Manager PIN required to clear a sick report."
            return
        }
        isSaving = true
        actionError = nil
        defer { isSaving = false }

        let repo = SickWorkerRepository(readDB: readDB, writeDB: writeDB)
        let pic = reportPicId.trimmingCharacters(in: .whitespacesAndNewlines)
        let context = RegulatedWriteContext.nativeCook(cookId: cookStore.cookId, locationId: locationId)
        do {
            _ = try repo.clear(
                input: SickReportClearInput(id: id, clearanceSource: source, reportedByPicId: pic.isEmpty ? nil : pic),
                context: context
            )
            await refresh()
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }

    /// Display name for a report's worker id via the staff catalog.
    func workerName(_ cookId: String) -> String {
        if let s = staff.first(where: { $0.id == cookId }) {
            let name = s.displayName
            return name.isEmpty ? cookId : name
        }
        return cookId
    }

    private func resetForm() {
        reportCookId = ""
        selectedSymptoms = []
        selectedDiagnosis = nil
        overrideAction = nil
        reportNote = ""
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
