import SwiftUI
import LariatDB
import LariatModel

struct BreakBoardView: View {
    @State private var vm: BreakBoardViewModel

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: BreakBoardViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.snapshot == nil {
                TileDegrade(title: "Could not load breaks", message: err, systemImage: "figure.walk")
            } else if let snap = vm.snapshot {
                content(snap)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Breaks")
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
    private func content(_ snap: BreakBoardSnapshot) -> some View {
        List {
            if let eval = snap.evaluation {
                Section("COMPS check") {
                    Text(String(format: "Shift %.1f h", eval.shiftHours))
                    Text("Rest owed: \(eval.restBreaksOwed) · Meal owed: \(eval.mealBreaksOwed)")
                        .font(.caption)
                        .foregroundStyle(eval.restBreaksOwed + eval.mealBreaksOwed > 0 ? .red : .secondary)
                    ForEach(eval.warnings, id: \.self) { w in
                        Text(w).font(.caption2).foregroundStyle(.orange)
                    }
                }
            }

            Section("Shift window (optional)") {
                TextField("Shift start ISO", text: $vm.shiftStartedAt)
                TextField("Shift end ISO", text: $vm.shiftEndedAt)
                Button("Refresh eval") { Task { await vm.refresh() } }
            }

            Section("Today") {
                if snap.breaks.isEmpty {
                    Text("No breaks logged").foregroundStyle(.secondary)
                } else {
                    ForEach(snap.breaks) { row in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(row.breakKind?.label ?? row.kind).font(.headline)
                                Text(row.startedAt).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if row.endedAt == nil {
                                Button("End") {
                                    Task { await vm.endBreak(id: row.id) }
                                }
                                .font(.caption)
                            } else {
                                Text("Done").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }

            Section("Start break") {
                if let err = vm.actionError {
                    Text(err).font(.caption).foregroundStyle(.red)
                }
                Button(vm.isSaving ? "Starting…" : "Start rest (10 min)") {
                    Task { await vm.startBreak(kind: .rest) }
                }
                .disabled(vm.isSaving)
                Button(vm.isSaving ? "Starting…" : "Start meal (30 min)") {
                    Task { await vm.startBreak(kind: .meal) }
                }
                .disabled(vm.isSaving)
            }
        }
    }
}
