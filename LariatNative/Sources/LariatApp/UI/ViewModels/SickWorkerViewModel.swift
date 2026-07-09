import Foundation
import LariatDB
import LariatModel
import Observation

/// Sick-worker board view model — parity with `SickWorkerBoard.jsx` +
/// `/api/sick-worker`. Filing and clearing reports are PIC authority in the web
/// app (route 403 without the manager PIN); here `pinOk` reflects the native
/// `PinSessionStore` so the UI mirrors the web PIC gate. Filing/clearing writes
/// are tagged `native_cook`; attaching a doctor's-note document is a
/// manager-PIN write tagged `native_mac` (spec §8). All are audited
/// in-transaction.
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
            // Pre-panel gate: don't even open the picker without a manager session.
            _ = try ManagementWrite().requireSession(pinStore.session)
            try writeDB.pool.read { db in try pinStore.validateActiveUser(db: db) }

            guard let picked = try SickNoteAttach.pickAndCopy(
                reportId: reportId,
                dataDir: Self.dataRoot()
            ) else { return }   // operator cancelled the panel

            isSaving = true
            defer { isSaving = false }
            do {
                // Re-gate at write time. The modal picker is an unbounded pause,
                // and the manager PIN can expire (8h TTL) or be revoked (the web
                // app flips `manager_pin_users.is_active` in the shared DB) while
                // it sits open. The audited PHI row must be attributed to a
                // still-valid session, so re-verify before the insert.
                let user = try ManagementWrite().requireSession(pinStore.session)
                try writeDB.pool.read { db in try pinStore.validateActiveUser(db: db) }

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
            actionError = Self.attachErrorMessage(for: error)
        }
    }

    /// Attach-failure copy that never surfaces the picked filename — it is
    /// PHI-adjacent and this string renders on the board above the PIN gate.
    /// Known typed errors keep their fixed copy; anything else (a Cocoa copy
    /// failure whose message embeds the source filename) degrades to a generic
    /// line.
    private static func attachErrorMessage(for error: Error) -> String {
        if error is SickNoteAttachError || error is SickNoteWriteError
            || error is ManagementWriteError {
            return WriteErrorMapper.message(for: error)
        }
        return "Couldn't attach the document — please try again."
    }

    /// Openable URL for a stored document, or nil when the file is missing on
    /// disk (the DB row can outlive a moved/deleted file — spec §5) or the
    /// stored `file_path` escapes the uploads root (tampered/out-of-band row —
    /// spec §9). A resolved directory or app bundle is also refused.
    nonisolated static func documentFileURL(
        _ doc: SickNoteDocumentRow,
        env: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) -> URL? {
        guard let safeRel = SickNoteDocumentCompute.safeUploadRelativePath(doc.filePath) else {
            return nil
        }
        // Resolve symlinks on BOTH paths (matching the recipe-photo `realpath`
        // precedent): standardizedFileURL only strips ../. lexically, so without
        // this a symlink planted under uploads/ could escape the root yet still
        // satisfy the prefix test below. Resolving both keeps the comparison
        // apples-to-apples (e.g. /tmp → /private/tmp on macOS).
        let uploads = dataRoot(env: env).appendingPathComponent("uploads").resolvingSymlinksInPath().standardizedFileURL
        let url = uploads.appendingPathComponent(safeRel).resolvingSymlinksInPath().standardizedFileURL
        // The resolved real path must sit under the uploads root.
        guard url.path == uploads.path || url.path.hasPrefix(uploads.path + "/") else {
            return nil
        }
        var isDir: ObjCBool = false
        guard fileManager.fileExists(atPath: url.path, isDirectory: &isDir), !isDir.boolValue else {
            return nil
        }
        return url
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
