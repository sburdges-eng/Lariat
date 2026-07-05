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
            ) { vm.cookPickerDone() }
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
                Toggle("Evaluate COMPS for a shift window", isOn: $vm.useShiftWindow)
                if vm.useShiftWindow {
                    DatePicker("Shift start", selection: $vm.shiftStart, displayedComponents: [.date, .hourAndMinute])
                    DatePicker("Shift end", selection: $vm.shiftEnd, displayedComponents: [.date, .hourAndMinute])
                    if vm.shiftWindowInvalid {
                        Text("Shift end must be after shift start.")
                            .font(.callout).foregroundStyle(.red)
                    }
                    if let hint = vm.evalHint {
                        Text(hint).font(.callout).foregroundStyle(.orange)
                    }
                    Button("Refresh eval") { Task { await vm.requestEvaluation() } }
                        .disabled(vm.shiftWindowInvalid)
                }
            }

            Section(snap.cookId == nil ? "Today — all workers" : "Today") {
                if snap.cookId == nil {
                    HStack {
                        Text("Showing everyone's breaks. Pick who you are to see just yours.")
                            .font(.caption).foregroundStyle(.orange)
                        Spacer()
                        Button("Pick who I am") { vm.showCookPicker = true }
                            .font(.caption)
                    }
                }
                if snap.breaks.isEmpty {
                    Text("No breaks logged").foregroundStyle(.secondary)
                } else {
                    ForEach(snap.breaks) { row in
                        breakRow(row, scopedToCook: snap.cookId != nil)
                    }
                }
            }

            startBreakSection
        }
    }

    /// One break row. The End button only appears on the current cook's own
    /// rows — in the unfiltered (no-identity) view you can see a coworker is on
    /// break but cannot close their record.
    @ViewBuilder
    private func breakRow(_ row: ShiftBreakRow, scopedToCook: Bool) -> some View {
        HStack {
            VStack(alignment: .leading) {
                Text(row.breakKind?.label ?? row.kind).font(.headline)
                Text(scopedToCook ? row.startedAt : "\(vm.workerName(row.cookId)) · \(row.startedAt)")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
            Spacer()
            if row.endedAt != nil {
                Text("Done").font(.caption).foregroundStyle(.secondary)
            } else if row.cookId == vm.cookStore.cookId {
                Button("End") {
                    Task { await vm.endBreak(id: row.id) }
                }
                .font(.caption)
                .accessibilityLabel("End \(row.breakKind?.label ?? row.kind)")
            } else {
                Text("On break").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var startBreakSection: some View {
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
