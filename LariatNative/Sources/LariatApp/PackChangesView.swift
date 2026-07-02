import SwiftUI
import LariatDB
import LariatModel
import Observation

enum PackChangesFilter: String, CaseIterable, Identifiable {
    case open, acknowledged, all
    var id: String { rawValue }
    var label: String {
        switch self {
        case .open: return "Open"
        case .acknowledged: return "Acknowledged"
        case .all: return "All"
        }
    }
}

@Observable @MainActor
final class PackChangesViewModel {
    var rows: [PackChangeWithIngredient] = []
    var unacknowledged = 0
    var filter: PackChangesFilter = .open
    var errorText: String?
    var ackError: String?
    var pendingAckId: Int64?
    var showPinSheet = false

    private let writeDB: LariatWriteDatabase
    private let pinStore: PinSessionStore
    private let poller = BoardPoller()

    init(writeDB: LariatWriteDatabase, pinStore: PinSessionStore) {
        self.writeDB = writeDB
        self.pinStore = pinStore
    }

    var writeDatabase: LariatWriteDatabase { writeDB }

    func start() {
        poller.start(interval: .seconds(3)) { [weak self] in
            guard let self else { return }
            await self.refresh()
            try BoardPoller.throwIfFailed(self.errorText)
        }
    }

    func stop() { poller.stop() }

    func refresh() async {
        let repo = PackChangesRepository(database: writeDB)
        do {
            let f: PackChangeFilter = switch filter {
            case .open: .open
            case .acknowledged: .acknowledged
            case .all: .all
            }
            rows = try repo.list(filter: f)
            unacknowledged = try repo.unacknowledgedCount()
            errorText = nil
        } catch {
            errorText = WriteErrorMapper.message(for: error)
        }
    }

    func requestAck(id: Int64) {
        ackError = nil
        pendingAckId = id
        do {
            let gateOn = try writeDB.pool.read { db in
                try PinVerifier().gateConfigured(db: db)
            }
            guard gateOn else {
                ackError = "PIN not set up — add a manager PIN in web Settings"
                pendingAckId = nil
                return
            }
        } catch {
            ackError = WriteErrorMapper.message(for: error)
            pendingAckId = nil
            return
        }
        if pinStore.activeUser != nil {
            performAck(id: id, note: nil)
        } else {
            showPinSheet = true
        }
    }

    func performAck(id: Int64, note: String?) {
        ackError = nil
        do {
            _ = try ManagementWrite().requireSession(pinStore.session)
            try writeDB.pool.read { db in try pinStore.validateActiveUser(db: db) }
            let repo = PackChangesRepository(database: writeDB)
            let trimmed = note.map { String($0.prefix(500)) }
            let result = try repo.acknowledge(id: id, note: trimmed)
            guard result.found else {
                ackError = "That pack-size row is gone"
                pendingAckId = nil
                Task { await refresh() }
                return
            }
            pendingAckId = nil
            Task { await refresh() }
        } catch {
            ackError = WriteErrorMapper.message(for: error)
        }
    }

    func pinVerified(_ user: ManagerPinUser) {
        pinStore.save(user: user)
        if let id = pendingAckId {
            performAck(id: id, note: nil)
        }
    }
}

struct PackChangesView: View {
    @State private var vm: PackChangesViewModel

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _ = readDB
        _vm = State(wrappedValue: PackChangesViewModel(writeDB: writeDB, pinStore: PinSessionStore.shared))
    }

    var body: some View {
        Group {
            if let err = vm.errorText {
                TileDegrade(title: "Pack-size changes", message: err, systemImage: "exclamationmark.triangle")
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    Text("\(vm.unacknowledged) open").font(.subheadline).foregroundStyle(.secondary)
                    Picker("Show", selection: $vm.filter) {
                        ForEach(PackChangesFilter.allCases) { f in
                            Text(f.label).tag(f)
                        }
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: vm.filter) { _, _ in Task { await vm.refresh() } }

                    if vm.rows.isEmpty {
                        ContentUnavailableView(
                            vm.filter == .open ? "No open pack-size changes" : "No matching rows",
                            systemImage: "shippingbox"
                        )
                    } else {
                        List(vm.rows) { row in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text("\(row.vendor) · \(row.sku)").font(.headline)
                                    Text("\(row.prevPack ?? "—") → \(row.newPack ?? "—")")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    if let ing = row.ingredient {
                                        Text(ing).font(.caption2)
                                    }
                                }
                                Spacer()
                                if !row.acknowledged {
                                    Button("Give OK") { vm.requestAck(id: row.id) }
                                } else {
                                    Text("Done").foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    if let ackError = vm.ackError {
                        Text(ackError).font(.caption).foregroundStyle(.red)
                    }
                }
                .padding()
            }
        }
        .navigationTitle("Pack-size changes")
        .task { vm.start() }
        .onDisappear { vm.stop() }
        .sheet(isPresented: $vm.showPinSheet) {
            PinEntrySheet(database: vm.writeDatabase) { user in
                vm.pinVerified(user)
            }
        }
    }
}
