import SwiftUI
import LariatDB
import LariatModel

/// Native port of `app/management/temp-pins/page.jsx` — hand out a scoped,
/// time-boxed PIN to a sous chef / delegate. The PIN shows ONCE in the
/// issued banner (write it down or text it); use Revoke if it gets lost.
struct TempPinsView: View {
    @State private var vm: TempPinsViewModel

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: TempPinsViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.active.isEmpty {
                TileDegrade(title: "Could not load temp PINs", message: err, systemImage: "key.radiowaves.forward")
            } else if !vm.loaded {
                ProgressView("Loading temp PINs…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                content
            }
        }
        .navigationTitle("Temp PINs")
        .task { await vm.refresh() }
        .sheet(isPresented: $vm.showPinSheet) {
            PinEntrySheet(database: vm.writeDatabase) { user in
                vm.pinVerified(user)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        Form {
            if let errorMessage = vm.errorMessage {
                Text(errorMessage).font(.caption).foregroundStyle(.red)
            }

            if let issued = vm.issued {
                issuedBanner(issued)
            }

            Section("Issue a temp PIN") {
                TextField("Who is this for? (label)", text: $vm.label)
                DatePicker("Stops working at", selection: $vm.expires, in: Date()...)
                ForEach(vm.knownScopes, id: \.self) { scope in
                    Toggle(scope, isOn: Binding(
                        get: { vm.selectedScopes.contains(scope) },
                        set: { _ in vm.toggleScope(scope) }
                    ))
                    .font(.system(.body, design: .monospaced))
                }
                Button("Issue PIN") { vm.requestIssue() }
                    .disabled(vm.isSaving)
            }

            Section("Active temp PINs") {
                if vm.active.isEmpty {
                    EmptyState(message: "No active temp PINs.", systemImage: "key.slash")
                } else {
                    ForEach(vm.active) { pin in
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(pin.label).fontWeight(.medium)
                                Text(pin.scopes.joined(separator: ", "))
                                    .font(.system(.caption, design: .monospaced))
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text("expires \(pin.expiresAt)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Button("Revoke", role: .destructive) { vm.requestRevoke(pin) }
                                .buttonStyle(.borderless)
                                .disabled(vm.isSaving)
                        }
                    }
                }
            }
        }
        .formStyle(.grouped)
    }

    /// The ONE place the raw PIN is ever displayed — never re-shown after
    /// dismissal (unrecoverable by design; revoke and reissue if lost).
    @ViewBuilder
    private func issuedBanner(_ issued: TempPinIssueResult) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                Label("PIN issued — shown once, write it down", systemImage: "exclamationmark.triangle")
                    .font(.headline)
                    .foregroundStyle(LariatTheme.warn)
                Text(issued.pin)
                    .font(.system(size: 34, weight: .bold, design: .monospaced))
                    .textSelection(.enabled)
                Text("\(issued.label) · \(issued.scopes.joined(separator: ", ")) · expires \(issued.expiresAt)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("Done — I wrote it down") { vm.dismissIssuedBanner() }
            }
            .padding(.vertical, 4)
        }
    }
}
