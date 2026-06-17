import SwiftUI
import LariatDB
import LariatModel

struct StationChecklistView: View {
    @State private var vm: StationChecklistViewModel
    @State private var noteDrafts: [String: String] = [:]

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
        .onDisappear { vm.stop() }
        .sheet(isPresented: $vm.showCookPicker) {
            CookIdentityPicker(
                store: vm.cookStore,
                staff: vm.staff,
                staffUnavailable: vm.staffUnavailable
            ) {
                vm.showCookPicker = false
            }
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
                        Task { await vm.signoff() }
                    }
                    .disabled(vm.isSaving)
                }
            }
        }
    }

    private func itemRow(item: String, state: LineCheckItemState) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(item).font(.headline)
            HStack(spacing: 8) {
                statusButton(item: item, label: "Pass", status: .pass, current: state.status)
                statusButton(item: item, label: "Fail", status: .fail, current: state.status)
                statusButton(item: item, label: "N/A", status: .na, current: state.status)
            }
            if state.status == .fail || noteDrafts[item] != nil {
                TextField("What did you fix?", text: binding(for: item, existing: state.note))
                    .textFieldStyle(.roundedBorder)
            }
        }
        .padding(.vertical, 4)
    }

    private func statusButton(
        item: String,
        label: String,
        status: LineCheckStatus,
        current: LineCheckStatus?
    ) -> some View {
        Button(label) {
            let note = noteDrafts[item] ?? ""
            Task {
                await vm.post(item: item, status: status, note: note)
            }
        }
        .buttonStyle(.bordered)
        .tint(current == status ? .accentColor : .secondary)
        .disabled(vm.isSaving || vm.snapshot?.signoff != nil)
    }

    private func binding(for item: String, existing: String) -> Binding<String> {
        Binding(
            get: { noteDrafts[item] ?? existing },
            set: { noteDrafts[item] = $0 }
        )
    }
}
