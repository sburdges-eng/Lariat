import Foundation
import LariatDB
import LariatModel
import Observation

/// View model for the Pest control board — parity with `PestBoard.jsx` +
/// `POST /api/pest`. Logs service-visit / sighting / trap-check entries; the
/// sighting-requires-pest guard mirrors the web form's client-side check, and
/// the repository re-validates it (defense in depth, matching the web route).
@Observable @MainActor
final class PestViewModel {
    var snapshot: PestBoardSnapshot?
    var fetchError: String?
    var actionError: String?
    var isSaving = false
    var showCookPicker = false

    // Form state (mirrors PestBoard.jsx useState fields).
    var entryType = "service_visit"
    var vendor = ""
    var technician = ""
    var pest = ""      // "" = none
    var severity = ""  // "" = none
    var findings = ""
    var corrective = ""

    let cookStore: CookIdentityStore
    var staff: [StaffMember] = []
    var staffUnavailable = false

    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let locationId: String
    private var streamTask: Task<Void, Never>?

    /// FDA §6-501.111 — surfaced in the header, ported verbatim from the rule module.
    var citation: String { PestCompute.citation }

    /// Selectable enums (mirror PestBoard.jsx constants). Empty id = "— none —".
    let entryTypeOptions: [(id: String, label: String)] = [
        ("service_visit", "Service visit"),
        ("sighting", "Sighting"),
        ("trap_check", "Trap check"),
    ]
    let pestOptions: [(id: String, label: String)] = [
        ("", "— none —"), ("roach", "Roach"), ("mouse", "Mouse"),
        ("fly", "Fly"), ("ant", "Ant"), ("other", "Other"),
    ]
    let severityOptions: [(id: String, label: String)] = [
        ("", "— none —"), ("low", "Low"), ("medium", "Medium"), ("high", "High"),
    ]

    var sightingNeedsPest: Bool { entryType == "sighting" }

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
        let repo = PestRepository(readDB: readDB, writeDB: writeDB)
        do {
            snapshot = try await repo.load(locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Could not load pest control log"
        }
    }

    func record() async {
        guard !isSaving else { return }
        // Client-side guard mirrors PestBoard.jsx: "Pick a pest for a sighting."
        if sightingNeedsPest, pest.isEmpty {
            actionError = "Pick a pest for a sighting."
            return
        }
        guard ensureCookIdentity() else { return }
        isSaving = true
        actionError = nil
        defer { isSaving = false }

        let repo = PestRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: cookStore.cookId, locationId: locationId)
        do {
            _ = try repo.log(
                input: PestControlInput(
                    entryType: entryType,
                    vendor: vendor.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : vendor,
                    technician: technician.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : technician,
                    findings: findings.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : findings,
                    pest: pest.isEmpty ? nil : pest,
                    severity: severity.isEmpty ? nil : severity,
                    correctiveAction: corrective.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : corrective,
                    cookId: cookStore.cookId
                ),
                context: context
            )
            // Reset the fields the web form clears after a save (entry_type stays).
            vendor = ""; technician = ""; pest = ""; severity = ""
            findings = ""; corrective = ""
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
