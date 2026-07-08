import Foundation
import LariatDB
import LariatModel
import Observation

/// Backs `manager.pins` — parity with `app/management/pins/page.jsx` +
/// `/api/auth/manager-pins`. Every write is PIN-gated per-write
/// (`ManagementWrite.requireSession` + `PinSessionStore` + `PinEntrySheet`) —
/// the native analog of the route-level `requirePin`.
///
/// A raw PIN typed into the form lives only in transient `@Observable` state
/// and is handed straight to `ManagerPinRepository`, which hashes before any
/// I/O. It is never logged or persisted here.
@Observable @MainActor
final class ManagerPinsViewModel {
    struct EditState {
        var id: Int64
        var name: String
        var role: String
        /// Blank = keep the existing PIN (web PATCH omits `pin` when blank).
        var pin: String = ""
        var isActive: Bool
    }

    private(set) var users: [ManagerPinRecord] = []
    private(set) var loaded = false
    var fetchError: String?
    var errorMessage: String?
    var isSaving = false
    var showPinSheet = false

    // Add form (page: name / pin / role, role defaults to manager).
    var newName = ""
    var newPin = ""
    var newRole = "manager"

    var editing: EditState?

    static let roles = ["manager", "owner"]

    let pinStore: PinSessionStore
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let locationId: String
    private var pendingAction: (() -> Void)?

    init(
        readDB: LariatDatabase,
        writeDB: LariatWriteDatabase,
        pinStore: PinSessionStore? = nil,
        locationId: String = LocationScope.resolve()
    ) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.pinStore = pinStore ?? PinSessionStore.shared
        self.locationId = locationId
    }

    var writeDatabase: LariatWriteDatabase { writeDB }

    private var repo: ManagerPinRepository {
        ManagerPinRepository(readDB: readDB, writeDB: writeDB)
    }

    func refresh() async {
        do {
            // Route GET passes includeDisabled: true — disabled users stay visible.
            users = try await repo.list(locationId: locationId, includeDisabled: true)
            fetchError = nil
        } catch {
            fetchError = "Could not load PINs"
        }
        loaded = true
    }

    func beginEdit(_ user: ManagerPinRecord) {
        editing = EditState(id: user.id, name: user.name, role: user.role, isActive: user.active)
    }

    func cancelEdit() {
        editing = nil
    }

    // ── PIN-gated write requests ─────────────────────────────────────────

    func requestAdd() {
        errorMessage = nil
        // Page-level checks before the network call (page.jsx addPin).
        guard !newName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            errorMessage = "Add a name"
            return
        }
        guard !newPin.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            errorMessage = "Add a PIN"
            return
        }
        gate { [weak self] in self?.performAdd() }
    }

    func requestSaveEdit() {
        errorMessage = nil
        guard let editing else { return }
        guard !editing.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            errorMessage = "Add a name"
            return
        }
        gate { [weak self] in self?.performSaveEdit() }
    }

    func requestDisable(_ user: ManagerPinRecord) {
        errorMessage = nil
        gate { [weak self] in self?.performDisable(id: user.id) }
    }

    func pinVerified(_ user: ManagerPinUser) {
        pinStore.save(user: user)
        let action = pendingAction
        pendingAction = nil
        action?()
    }

    private func gate(_ action: @escaping () -> Void) {
        if pinStore.activeUser != nil {
            action()
        } else {
            pendingAction = action
            showPinSheet = true
        }
    }

    // ── writes ───────────────────────────────────────────────────────────

    private func performAdd() {
        withSession { context in
            // Web parity: app/management/pins addPin sends pin.trim()
            _ = try repo.create(
                name: newName, pin: newPin.trimmingCharacters(in: .whitespacesAndNewlines),
                role: newRole, context: context
            )
            newName = ""
            newPin = ""
            newRole = "manager"
        }
    }

    private func performSaveEdit() {
        guard let edit = editing else { return }
        withSession { context in
            let cleanPin = edit.pin.trimmingCharacters(in: .whitespacesAndNewlines)
            _ = try repo.update(
                id: edit.id,
                name: edit.name,
                pin: cleanPin.isEmpty ? nil : cleanPin,   // blank PIN = keep
                role: edit.role,
                isActive: edit.isActive,
                context: context
            )
            editing = nil
        }
    }

    private func performDisable(id: Int64) {
        withSession { context in
            _ = try repo.disable(id: id, context: context)
        }
    }

    private func withSession(_ body: (RegulatedWriteContext) throws -> Void) {
        isSaving = true
        defer { isSaving = false }
        do {
            let user = try ManagementWrite().requireSession(pinStore.session)
            try writeDB.pool.read { db in try pinStore.validateActiveUser(db: db) }
            try body(RegulatedWriteContext.nativeMac(pinUser: user))
            Task { await refresh() }
        } catch {
            errorMessage = WriteErrorMapper.message(for: error)
        }
    }
}
