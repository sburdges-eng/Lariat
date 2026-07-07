import SwiftUI
import LariatDB
import LariatModel

struct StationChecklistView: View {
    @State private var vm: StationChecklistViewModel
    @State private var noteDrafts: [String: String] = [:]
    @State private var parDrafts: [String: String] = [:]
    @State private var haveDrafts: [String: String] = [:]
    @State private var needDrafts: [String: String] = [:]
    @State private var gloveDrafts: [String: Bool] = [:]

    init(stationId: String, readDB: LariatDatabase, writeDB: LariatWriteDatabase, catalog: StationCatalog) {
        _vm = State(
            wrappedValue: StationChecklistViewModel(
                stationId: stationId,
                readDB: readDB,
                writeDB: writeDB,
                catalog: catalog
            )
        )
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.snapshot == nil {
                TileDegrade(title: "Could not load checklist", message: err, systemImage: "externaldrive.badge.xmark")
            } else if let snap = vm.snapshot {
                checklistContent(snap)
            } else {
                ProgressView()
            }
        }
        .navigationTitle(vm.snapshot?.station.name ?? "Checklist")
        .task { vm.start() }
        .tracksActiveBoard(vm.poller)
        .onDisappear { vm.stop() }
        .sheet(isPresented: $vm.showCookPicker) {
            CookIdentityPicker(
                store: vm.cookStore,
                staff: vm.staff,
                staffUnavailable: vm.staffUnavailable,
                onDismiss: { vm.showCookPicker = false },
                onCancel: { vm.actionError = "Not saved — pick a cook to record the check." }
            )
        }
    }

    // ── Cook-gated submits (an identity interrupt stashes the same submit
    //    for auto-retry once a cook is picked; drafts stay put) ──────────

    private func submitPost(
        item: String, status: LineCheckStatus,
        par: String, have: String, need: String, note: String, glove: Bool?
    ) async {
        let ok = await vm.post(item: item, status: status, par: par, have: have, need: need, note: note, glove: glove)
        if !ok, vm.showCookPicker {
            vm.cookStore.stashPendingWrite {
                await submitPost(item: item, status: status, par: par, have: have, need: need, note: note, glove: glove)
            }
        }
    }

    private func submitSignoff() async {
        let ok = await vm.signoff()
        if !ok, vm.showCookPicker {
            vm.cookStore.stashPendingWrite { await submitSignoff() }
        }
    }

    @ViewBuilder
    private func checklistContent(_ snap: StationChecklistSnapshot) -> some View {
        List {
            if let p = snap.progress {
                Section {
                    LabeledContent("Done", value: "\(p.done) of \(p.total)")
                    if p.flagged > 0 {
                        LabeledContent("Flagged", value: "\(p.flagged)")
                    }
                    if snap.signoff != nil {
                        LabeledContent("Signed off", value: "Yes")
                    }
                }
            }

            Section("Line check") {
                ForEach(snap.templateItems, id: \.self) { item in
                    itemRow(item: item, state: snap.items[item] ?? LineCheckItemState(status: nil))
                }
            }

            if let err = vm.actionError {
                Section {
                    Text(err).foregroundStyle(.red)
                }
            }

            if snap.signoff == nil {
                Section {
                    Button(vm.isSaving ? "Signing off…" : "Sign off station") {
                        Task { await submitSignoff() }
                    }
                    .disabled(vm.isSaving)
                }
            }
        }
    }

    private func itemRow(item: String, state: LineCheckItemState) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(item).font(.headline)
            // par / have / need — the repo already persists these; the entry
            // carries whatever is shown when a status is tapped.
            HStack(spacing: 8) {
                countField("Par", binding: parBinding(item, state.par))
                countField("Have", binding: haveBinding(item, state.have))
                countField("Need", binding: needBinding(item, state.need))
            }
            // Glove-change attestation (FDA §3-301.11). Checked ⇒ true; unchecked
            // ⇒ null (never false) — matches the web checkbox contract.
            Toggle("Gloves changed", isOn: gloveBinding(item, state.gloveChangeAttested))
                .font(.caption)
            HStack(spacing: 8) {
                statusButton(item: item, label: "Pass", status: .pass, state: state)
                statusButton(item: item, label: "Fail", status: .fail, state: state)
                statusButton(item: item, label: "N/A", status: .na, state: state)
            }
            if state.status == .fail || noteDrafts[item] != nil {
                TextField("What did you fix?", text: binding(for: item, existing: state.note))
                    .textFieldStyle(.roundedBorder)
            }
        }
        .padding(.vertical, 4)
    }

    private func countField(_ label: String, binding: Binding<String>) -> some View {
        TextField(label, text: binding)
            .textFieldStyle(.roundedBorder)
            .frame(maxWidth: 90)
    }

    private func statusButton(
        item: String,
        label: String,
        status: LineCheckStatus,
        state: LineCheckItemState
    ) -> some View {
        Button(label) {
            // Send whatever the row currently shows (draft, else the existing value).
            let note = noteDrafts[item] ?? state.note
            let par = parDrafts[item] ?? state.par
            let have = haveDrafts[item] ?? state.have
            let need = needDrafts[item] ?? state.need
            // Checked ⇒ true, unchecked ⇒ nil (never false) — RTE attestation contract.
            let glove: Bool? = (gloveDrafts[item] ?? (state.gloveChangeAttested == true)) ? true : nil
            Task {
                await submitPost(item: item, status: status, par: par, have: have, need: need, note: note, glove: glove)
            }
        }
        .buttonStyle(.bordered)
        .tint(state.status == status ? .accentColor : .secondary)
        .disabled(vm.isSaving || vm.snapshot?.signoff != nil)
        .accessibilityLabel("Mark \(item) \(label)")
        .accessibilityAddTraits(state.status == status ? [.isSelected] : [])
    }

    private func binding(for item: String, existing: String) -> Binding<String> {
        Binding(get: { noteDrafts[item] ?? existing }, set: { noteDrafts[item] = $0 })
    }
    private func parBinding(_ item: String, _ existing: String) -> Binding<String> {
        Binding(get: { parDrafts[item] ?? existing }, set: { parDrafts[item] = $0 })
    }
    private func haveBinding(_ item: String, _ existing: String) -> Binding<String> {
        Binding(get: { haveDrafts[item] ?? existing }, set: { haveDrafts[item] = $0 })
    }
    private func needBinding(_ item: String, _ existing: String) -> Binding<String> {
        Binding(get: { needDrafts[item] ?? existing }, set: { needDrafts[item] = $0 })
    }
    private func gloveBinding(_ item: String, _ existing: Bool?) -> Binding<Bool> {
        Binding(get: { gloveDrafts[item] ?? (existing == true) }, set: { gloveDrafts[item] = $0 })
    }
}
