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
    var showPinSheet = false

    // New-report form state (mirrors the JSX component state).
    var reportCookId = ""
    var reportPicId = ""
    var selectedSymptoms: Set<SickSymptom> = []
    var selectedDiagnosis: SickDiagnosis?
    var overrideAction: SickAction?
    var reportNote = ""

    // Doctor's-note documents (design 2026-07-08-lariat-sick-note-docs).
    // Counts are PIN-free (the locked row shows "N on file"); full rows —
    // filenames are PHI-adjacent — are fetched only with an active PIN session.
    var documentCounts: [Int64: Int] = [:]
    var documents: [Int64: [SickNoteDocumentRow]] = [:]

    let cookStore: CookIdentityStore
    let pinStore: PinSessionStore
    var staff: [StaffMember] = []
    var staffUnavailable = false

    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let locationId: String
    let poller = BoardPoller()

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

    /// Write handle for `PinEntrySheet` (sibling pattern: SickLeaveViewModel).
    var writeDatabase: LariatWriteDatabase { writeDB }

    /// Open the PIN sheet — but first confirm a manager PIN is configured at all,
    /// so the sheet isn't an unlockable dead end (SickLeaveViewModel precedent).
    func requestUnlock() {
        actionError = nil
        do {
            let gateOn = try writeDB.pool.read { db in try PinVerifier().gateConfigured(db: db) }
            guard gateOn else {
                actionError = "PIN not set up — add a manager PIN in web Settings"
                return
            }
            showPinSheet = true
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }

    /// PIN sheet success: persist the session and re-fetch so the PIC surfaces
    /// (new-report form, history, clear menu) appear immediately.
    func pinVerified(_ user: ManagerPinUser) {
        pinStore.save(user: user)
        Task { await refresh() }
    }

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
        await refreshDocuments()
    }

    /// Refresh the per-report document counts (always) and rows (PIN only).
    /// Document data is secondary to the board — on error keep the last-known
    /// values rather than failing the whole snapshot.
    private func refreshDocuments() async {
        guard let snap = snapshot else {
            documentCounts = [:]
            documents = [:]
            return
        }
        let ids = (snap.active + snap.history).map(\.id)
        let repo = SickNoteRepository(readDB: readDB, writeDB: writeDB)
        do {
            documentCounts = try await repo.counts(reportIds: ids, locationId: locationId)
            documents = pinOk
                ? try await repo.documents(reportIds: ids, locationId: locationId)
                : [:]
        } catch {
            // Keep previous values; the poller retries in a few seconds.
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

    /// Attach a doctor's-note document to a report (manager-PIN authority,
    /// StaffCertViewModel write pattern). Presents the open panel, copies the
    /// file under `data/uploads/sick-notes/`, then records the audited row —
    /// if the DB insert fails the copied file is removed so no orphan lands
    /// on disk (spec §9 file-vs-row drift).
    func attachDocument(reportId: Int64, kind: SickNoteKind) {
        guard !isSaving else { return }
        actionError = nil
        do {
            let user = try ManagementWrite().requireSession(pinStore.session)
            try writeDB.pool.read { db in try pinStore.validateActiveUser(db: db) }
            guard let picked = try SickNoteAttach.pickAndCopy(
                reportId: reportId,
                dataDir: Self.dataRoot()
            ) else { return }   // operator cancelled the panel

            isSaving = true
            defer { isSaving = false }
            do {
                let repo = SickNoteRepository(readDB: readDB, writeDB: writeDB)
                _ = try repo.attach(
                    input: SickNoteAttachInput(
                        reportId: reportId,
                        filePath: picked.filePath,
                        kind: kind,
                        originalFilename: picked.originalFilename,
                        uploadedAt: Self.isoFormatter.string(from: Date())
                    ),
                    context: .nativeMac(pinUser: user)
                )
            } catch {
                try? FileManager.default.removeItem(at: picked.destination)
                throw error
            }
            Task { await refresh() }
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }

    /// Openable URL for a stored document, or nil when the file is missing on
    /// disk (the DB row can outlive a moved/deleted file — spec §5).
    nonisolated static func documentFileURL(
        _ doc: SickNoteDocumentRow,
        env: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) -> URL? {
        let uploads = dataRoot(env: env).appendingPathComponent("uploads")
        let url = uploads.appendingPathComponent(doc.filePath)
        return fileManager.fileExists(atPath: url.path) ? url : nil
    }

    /// The Lariat data root (`LARIAT_DATA_DIR` or `<cwd>/data`) as a URL.
    nonisolated private static func dataRoot(
        env: [String: String] = ProcessInfo.processInfo.environment
    ) -> URL {
        URL(fileURLWithPath: LariatDB.resolveDataDirectory(env: env), isDirectory: true)
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
