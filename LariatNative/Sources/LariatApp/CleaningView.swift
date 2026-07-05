import SwiftUI
import LariatDB
import LariatModel

struct CleaningView: View {
    @State private var vm: CleaningViewModel
    @State private var task = ""
    @State private var area = ""
    @State private var notes = ""

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: CleaningViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.snapshot == nil {
                TileDegrade(title: "Could not load cleaning", message: err, systemImage: "sparkles")
            } else if let snap = vm.snapshot {
                content(snap)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Cleaning")
        .onAppear { vm.start() }
        .onDisappear { vm.stop() }
        .sheet(isPresented: $vm.showCookPicker) {
            CookIdentityPicker(
                store: vm.cookStore,
                staff: vm.staff,
                staffUnavailable: vm.staffUnavailable
            ) { vm.showCookPicker = false }
        }
    }

    @ViewBuilder
    private func content(_ snap: CleaningBoardSnapshot) -> some View {
        List {
            Section("Today") {
                if snap.rows.isEmpty {
                    Text("No cleaning logged yet").foregroundStyle(.secondary)
                } else {
                    ForEach(snap.rows) { row in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(row.task).font(.headline)
                            Text("\(row.area) · \(row.completedAt)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
            Section("Log clean") {
                TextField("Task", text: $task)
                TextField("Area (optional)", text: $area)
                TextField("Notes (optional)", text: $notes)
                if let err = vm.actionError {
                    Text(err).font(.caption).foregroundStyle(.red)
                }
                Button(vm.isSaving ? "Saving…" : "Mark done") {
                    Task { await vm.postTick(task: task, area: area, notes: notes) }
                }
                .disabled(vm.isSaving || task.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }
}
