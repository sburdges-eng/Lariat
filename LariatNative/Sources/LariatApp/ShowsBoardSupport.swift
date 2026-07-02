import SwiftUI
import LariatDB
import LariatModel
import Observation

// Shared plumbing for the six A6.4 shows boards.
//
// Web parity: `/shows` + `/api/shows/**` are manager-PIN-gated
// (middleware.js SENSITIVE_PREFIXES + requirePin/requirePinOrScope in every
// route). Native mirrors the Morning read-gate: when a PIN is configured,
// VIEWING any shows board requires an active PIN session; writes then reuse
// the unlocked session's user as the actor. With no PIN configured the
// boards are open and writes carry a nil actor (web behaves the same).

/// Reusable whole-board PIN gate — the Morning pattern, shared across the
/// shows tier instead of copy-pasted six times.
@Observable @MainActor
final class ShowsGateModel {
    enum Gate: Equatable {
        case checking
        case open
        case locked
        case unavailable(String)
    }

    var gate: Gate = .checking
    var showPinSheet = false

    let database: LariatDatabase
    let writeDatabase: LariatWriteDatabase?
    let pinStore: PinSessionStore
    private let locationId: String

    init(
        database: LariatDatabase,
        writeDatabase: LariatWriteDatabase?,
        pinStore: PinSessionStore? = nil,
        locationId: String = LocationScope.resolve()
    ) {
        self.database = database
        self.writeDatabase = writeDatabase
        self.pinStore = pinStore ?? PinSessionStore.shared
        self.locationId = locationId
    }

    func evaluate() {
        let gateOn: Bool
        do {
            if let writeDatabase {
                gateOn = try writeDatabase.pool.read { db in
                    try PinVerifier().gateConfigured(db: db, locationId: locationId)
                }
            } else {
                gateOn = try database.pool.read { db in
                    try PinVerifier().gateConfigured(db: db, locationId: locationId)
                }
            }
        } catch {
            gate = .unavailable("Could not evaluate the manager PIN gate.")
            return
        }
        if !gateOn || pinStore.activeUser != nil {
            gate = .open
            return
        }
        guard writeDatabase != nil else {
            gate = .unavailable("Manager PIN required, but the write database is unavailable.")
            return
        }
        gate = .locked
    }

    func requestUnlock() {
        guard writeDatabase != nil else { return }
        showPinSheet = true
    }

    func pinVerified(_ user: ManagerPinUser) {
        pinStore.save(user: user)
        gate = .open
    }

    /// Actor for a write on an unlocked board. Gate off → nil actor (web
    /// parity); gate on → the active session's user, or throws after
    /// prompting for the PIN sheet.
    func actorForWrite() throws -> ManagerPinUser? {
        let gateOn: Bool
        if let writeDatabase {
            gateOn = (try? writeDatabase.pool.read { db in
                try PinVerifier().gateConfigured(db: db, locationId: locationId)
            }) ?? PinVerifier().gateConfigured()
        } else {
            gateOn = PinVerifier().gateConfigured()
        }
        guard gateOn else { return nil }
        do {
            let user = try ManagementWrite().requireSession(pinStore.session)
            if let writeDatabase {
                try writeDatabase.pool.read { db in try pinStore.validateActiveUser(db: db) }
            }
            return user
        } catch {
            showPinSheet = true
            throw error
        }
    }
}

/// Board shell: gate states + PIN sheet around the board content.
struct ShowsGatedBoard<Content: View>: View {
    @State var gateModel: ShowsGateModel
    let title: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        Group {
            switch gateModel.gate {
            case .checking:
                ProgressView("Checking manager PIN…")
            case .unavailable(let msg):
                TileDegrade(title: "\(title) locked", message: msg, systemImage: "lock")
            case .locked:
                ShowsLockedView(title: title) { gateModel.requestUnlock() }
            case .open:
                content()
            }
        }
        .navigationTitle(title)
        .task { gateModel.evaluate() }
        .sheet(isPresented: Binding(
            get: { gateModel.showPinSheet },
            set: { gateModel.showPinSheet = $0 }
        )) {
            if let writeDB = gateModel.writeDatabase {
                PinEntrySheet(database: writeDB) { user in gateModel.pinVerified(user) }
            }
        }
    }
}

private struct ShowsLockedView: View {
    let title: String
    let onUnlock: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "lock.fill").font(.largeTitle).foregroundStyle(.secondary)
            Text("\(title) requires a manager PIN")
                .font(.headline)
            Text("Shows surfaces are PIN-protected (parity with the web app).")
                .font(.callout).foregroundStyle(.secondary)
            Button("Unlock") { onUnlock() }
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// ── Show picker (per-show boards) ─────────────────────────────────────

/// Loads a bounded show list and tracks the selected show. Defaults to
/// tonight's show when one exists, else the next upcoming, else the most
/// recent. Native nicety — the web navigates from its own shows list.
@Observable @MainActor
final class ShowPickerModel {
    var shows: [ShowRow] = []
    var selectedShowId: Int64?
    var loadError: String?

    private let repo: ShowsRepository

    init(database: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.repo = ShowsRepository(readDB: database, locationId: locationId)
    }

    var selectedShow: ShowRow? {
        shows.first { $0.id == selectedShowId }
    }

    func load(today: String = ShiftDate.todayISO()) async {
        do {
            let recent = try await repo.recentShows(limit: 60)
            shows = recent
            loadError = nil
            if selectedShowId == nil || !recent.contains(where: { $0.id == selectedShowId }) {
                if let tonight = recent.first(where: { $0.showDate == today }) {
                    selectedShowId = tonight.id
                } else if let next = recent.last(where: { $0.showDate >= today }) {
                    // recentShows is DESC — the LAST future row is the soonest.
                    selectedShowId = next.id
                } else {
                    selectedShowId = recent.first?.id
                }
            }
        } catch {
            loadError = "Could not load the shows list"
        }
    }
}

/// Compact picker row shared by the per-show boards.
struct ShowPickerRow: View {
    @Bindable var model: ShowPickerModel

    var body: some View {
        Picker("Show", selection: $model.selectedShowId) {
            if model.shows.isEmpty {
                Text("No shows").tag(nil as Int64?)
            }
            ForEach(model.shows) { show in
                Text("\(show.showDate) · \(show.bandName)").tag(show.id as Int64?)
            }
        }
        .pickerStyle(.menu)
    }
}
