import SwiftUI
import LariatDB
import LariatModel

/// Native port of `app/management/pins/page.jsx` — editable local manager
/// credentials beside the LARIAT_PIN override. Add / inline edit (blank PIN =
/// keep) / disable; disabled users stay listed with an "Off" badge. All
/// writes PIN-gated via `PinEntrySheet` + `ManagementWrite.requireSession`.
struct ManagerPinsView: View {
    @State private var vm: ManagerPinsViewModel

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: ManagerPinsViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.users.isEmpty {
                TileDegrade(title: "Could not load PINs", message: err, systemImage: "key")
            } else if !vm.loaded {
                ProgressView("Loading PIN users…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                content
            }
        }
        .navigationTitle("Manager PINs")
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

            Section("Add a manager PIN") {
                TextField("Name", text: $vm.newName)
                SecureField("PIN (4–6 digits)", text: $vm.newPin)
                Picker("Role", selection: $vm.newRole) {
                    ForEach(ManagerPinsViewModel.roles, id: \.self) { role in
                        Text(role.capitalized).tag(role)
                    }
                }
                Button("Add PIN") { vm.requestAdd() }
                    .disabled(vm.isSaving)
            }

            Section("PIN users") {
                if vm.users.isEmpty {
                    EmptyState(message: "No manager PIN users yet.", systemImage: "key")
                } else {
                    ForEach(vm.users) { user in
                        userRow(user)
                    }
                }
            }
        }
        .formStyle(.grouped)
    }

    @ViewBuilder
    private func userRow(_ user: ManagerPinRecord) -> some View {
        if vm.editing?.id == user.id {
            editRow
        } else {
            HStack {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(user.name).fontWeight(.medium)
                        Text(user.role.capitalized)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(user.active ? "Active" : "Off")
                        .font(.caption.bold())
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(
                            (user.active ? LariatTheme.ok : LariatTheme.muted).opacity(0.15),
                            in: Capsule()
                        )
                        .foregroundStyle(user.active ? LariatTheme.ok : LariatTheme.muted)
                }
                .accessibilityElement(children: .combine)
                Button("Edit") { vm.beginEdit(user) }
                    .buttonStyle(.borderless)
                if user.active {
                    Button("Disable", role: .destructive) { vm.requestDisable(user) }
                        .buttonStyle(.borderless)
                        .disabled(vm.isSaving)
                }
            }
        }
    }

    @ViewBuilder
    private var editRow: some View {
        if let editing = vm.editing {
            VStack(alignment: .leading, spacing: 8) {
                TextField("Name", text: Binding(
                    get: { vm.editing?.name ?? "" },
                    set: { vm.editing?.name = $0 }
                ))
                SecureField("New PIN (blank keeps the current one)", text: Binding(
                    get: { vm.editing?.pin ?? "" },
                    set: { vm.editing?.pin = $0 }
                ))
                Picker("Role", selection: Binding(
                    get: { vm.editing?.role ?? "manager" },
                    set: { vm.editing?.role = $0 }
                )) {
                    ForEach(ManagerPinsViewModel.roles, id: \.self) { role in
                        Text(role.capitalized).tag(role)
                    }
                }
                Toggle("Active", isOn: Binding(
                    get: { vm.editing?.isActive ?? true },
                    set: { vm.editing?.isActive = $0 }
                ))
                HStack {
                    Button("Save") { vm.requestSaveEdit() }
                        .disabled(vm.isSaving || editing.name.trimmingCharacters(in: .whitespaces).isEmpty)
                    Button("Cancel", role: .cancel) { vm.cancelEdit() }
                }
            }
            .padding(.vertical, 4)
        }
    }
}
