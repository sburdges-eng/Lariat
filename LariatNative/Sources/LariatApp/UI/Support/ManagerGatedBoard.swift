import SwiftUI
import LariatDB

/// Whole-board PIN gate for the manager rollup boards (Command, Analytics,
/// Management). Web parity: `/api/analytics/**` sits behind the PIN
/// middleware, but these three native boards fetched with zero PINs — the
/// 2026-08-31 lineage audit surfaced the gap and Sean chose to gate them.
///
/// The gate decision is NOT re-implemented here: this reuses `ShowsGateModel`
/// (itself the Morning pattern over `RegulatedReadGate`), because a third
/// copy of the rule is exactly how the shows tier drifted last time — see
/// the history note at the top of ShowsBoardSupport.swift. Only the shell
/// and its lock copy are new.
struct ManagerGatedBoard<Content: View>: View {
    @State private var gateModel: ShowsGateModel
    let title: String
    @ViewBuilder let content: () -> Content

    init(
        database: LariatDatabase,
        writeDatabase: LariatWriteDatabase?,
        title: String,
        @ViewBuilder content: @escaping () -> Content
    ) {
        _gateModel = State(wrappedValue: ShowsGateModel(
            database: database, writeDatabase: writeDatabase))
        self.title = title
        self.content = content
    }

    var body: some View {
        Group {
            switch gateModel.gate {
            case .checking:
                ProgressView("Checking manager PIN…")
            case .unavailable(let msg):
                TileDegrade(title: "\(title) is locked", message: msg, systemImage: "lock")
            case .locked:
                ManagerLockedView(title: title) { gateModel.requestUnlock() }
            case .open:
                content()
            }
        }
        .navigationTitle(title)
        .task { gateModel.evaluate() }
        .sheet(isPresented: Binding(
            get: { gateModel.showPinSheet },
            set: { gateModel.showPinSheet = $0 }
        ), onDismiss: { gateModel.pinSheetDismissed() }) {
            if let writeDB = gateModel.writeDatabase {
                PinEntrySheet(database: writeDB) { user in gateModel.pinVerified(user) }
            }
        }
    }
}

private struct ManagerLockedView: View {
    let title: String
    let onUnlock: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            VStack(spacing: 12) {
                Image(systemName: "lock.fill").font(.largeTitle).foregroundStyle(.secondary)
                Text("\(title) needs a manager PIN")
                    .font(.headline)
                Text("Manager numbers stay locked until a manager opens them.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)

            Button("Unlock") { onUnlock() }
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
