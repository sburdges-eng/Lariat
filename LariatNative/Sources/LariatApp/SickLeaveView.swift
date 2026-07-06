import SwiftUI
import LariatDB
import LariatModel

/// Paid-sick-leave board — native port of `app/labor/sick-leave/SickLeaveBoard.jsx`.
/// Colorado HFWA (C.R.S. §8-13.3-401): employees earn 1h sick time per 30h worked,
/// capped at 48h/year; carryover is tracked separately and never counts against
/// the accrual cap. Reads are open; adding and using hours are gated by the
/// manager PIN (native analog of the web `pic.sick_leave` scope) and audited
/// `native_mac`.
struct SickLeaveView: View {
    @State private var vm: SickLeaveViewModel

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: SickLeaveViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.balances.isEmpty {
                TileDegrade(title: "Could not load sick time", message: err, systemImage: "cross.case")
            } else {
                content
            }
        }
        .navigationTitle("Sick time")
        .task { vm.start() }
        .onDisappear { vm.stop() }
        .sheet(isPresented: $vm.showForm) { entryForm }
        .sheet(isPresented: $vm.showPinSheet) {
            PinEntrySheet(database: vm.writeDatabase) { user in
                vm.pinVerified(user)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            List {
                Section {
                    Text("Colorado HFWA (C.R.S. §8-13.3-401). Earn 1h per 30h worked, up to 48h a year. Carryover is separate and never counts against the cap.")
                        .font(.caption).foregroundStyle(.secondary)
                }

                if let submitError = vm.submitError {
                    Section { Text(submitError).font(.callout).foregroundStyle(.red) }
                }

                Section("Balances \(vm.accrualYear) (\(vm.balances.count))") {
                    if vm.balances.isEmpty {
                        Text("No sick time recorded yet.").foregroundStyle(.secondary)
                    } else {
                        ForEach(vm.balances, id: \.cookId) { b in
                            balanceRow(b)
                        }
                    }
                }
            }

            HStack {
                Spacer()
                Button("Add / use hours") { vm.showForm = true }
                    .padding()
            }
        }
    }

    @ViewBuilder
    private func balanceRow(_ b: BalanceSummary) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(vm.workerName(b.cookId)).font(.headline)
                Spacer()
                Text("\(hrs(b.hoursAvailable)) available")
                    .font(.caption2).padding(4)
                    .background((b.atCap ? Color.orange : .green).opacity(0.18)).clipShape(Capsule())
                    .foregroundStyle(b.atCap ? .orange : .green)
            }
            Text("earned \(hrs(b.hoursAccrued)) · used \(hrs(b.hoursUsed)) · carry \(hrs(b.carryoverHours))\(b.atCap ? " · cap hit" : "")")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    // ── Add/Use form ────────────────────────────────────────────────────

    @ViewBuilder
    private var entryForm: some View {
        NavigationStack {
            Form {
                Picker("Worker", selection: $vm.cookId) {
                    Text("— pick —").tag("")
                    ForEach(vm.staff) { s in
                        Text(s.displayName).tag(s.id)
                    }
                }
                if vm.staffUnavailable {
                    Text("No staff on file — run the staff sync to create data/cache/staff.json.")
                        .font(.caption).foregroundStyle(.orange)
                }
                Picker("Action", selection: $vm.useMode) {
                    Text("Add hours").tag(false)
                    Text("Use hours").tag(true)
                }
                .pickerStyle(.segmented)
                TextField("Hours", text: $vm.hoursText)
                TextField("Note (optional)", text: $vm.note)
                if let submitError = vm.submitError {
                    Text(submitError).font(.caption).foregroundStyle(.red)
                }
            }
            .navigationTitle(vm.useMode ? "Use hours" : "Add hours")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { vm.showForm = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(vm.useMode ? "Use" : "Add") {
                        // Dismiss first — the PIN sheet may need to present next,
                        // and two sheets can't be up at once (PR #401). Fields
                        // stay populated until the submit succeeds.
                        vm.showForm = false
                        vm.requestSubmit()
                    }
                    .disabled(vm.cookId.isEmpty || vm.hoursText.isEmpty)
                }
            }
        }
        .frame(minWidth: 360, minHeight: 320)
    }

    /// Format an hour value trimming a trailing ".0" (4.0 → "4", 4.5 → "4.5").
    private func hrs(_ h: Double) -> String {
        if h == h.rounded() { return String(Int(h)) }
        return String(h)
    }
}
