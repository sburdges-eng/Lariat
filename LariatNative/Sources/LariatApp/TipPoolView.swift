import SwiftUI
import LariatDB
import LariatModel

/// Tip-pool board — native port of `app/labor/tip-pool/TipPoolBoard.jsx`.
/// Colorado COMPS Order #39 §3.3/§3.4 + FLSA (29 CFR 531.52). A flat append-only
/// ledger of per-cook tip / service-charge / direct-tip lines with aggregation;
/// managers/owners may not receive POOLED tips (§3.4). Reads are open; recording
/// a line is gated by the manager PIN (native analog of `pic.tip_pool`) and
/// audited `native_mac`. Money is integer cents.
struct TipPoolView: View {
    @State private var vm: TipPoolViewModel

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: TipPoolViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.rows.isEmpty {
                TileDegrade(title: "Could not load tip pool", message: err, systemImage: "dollarsign.circle")
            } else {
                content
            }
        }
        .navigationTitle("Tip pool")
        .task { vm.start() }
        .onDisappear { vm.stop() }
        .sheet(isPresented: $vm.showForm) { addForm }
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
                    HStack {
                        kpi("Total", vm.summary.totalCents)
                        kpi("Pool", vm.summary.byKind[.tip_pool] ?? 0)
                        kpi("Svc chg", vm.summary.byKind[.service_charge] ?? 0)
                        kpi("Direct", vm.summary.byKind[.direct_tip] ?? 0)
                    }
                }

                if let submitError = vm.submitError {
                    Section { Text(submitError).font(.callout).foregroundStyle(.red) }
                }

                Section("By cook") {
                    let sorted = vm.summary.byCook.sorted { $0.value > $1.value }
                    if sorted.isEmpty {
                        Text("No tips recorded today.").foregroundStyle(.secondary)
                    } else {
                        ForEach(sorted, id: \.key) { cook, cents in
                            HStack {
                                Text(vm.workerName(cook))
                                Spacer()
                                Text(money(cents)).monospacedDigit()
                            }
                        }
                    }
                }

                Section("Lines (\(vm.rows.count))") {
                    ForEach(vm.rows) { row in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(vm.workerName(row.cookId)).font(.callout)
                                Text("\(row.kind.rawValue.replacingOccurrences(of: "_", with: " ")) · \(row.poolRef)")
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(money(row.amountCents)).monospacedDigit()
                        }
                    }
                }
            }

            HStack {
                Spacer()
                Button("Add line") { vm.showForm = true }
                    .padding()
            }
        }
    }

    @ViewBuilder
    private func kpi(_ label: String, _ cents: Int) -> some View {
        VStack(spacing: 2) {
            Text(money(cents)).font(.headline).monospacedDigit()
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    // ── Add-line form ────────────────────────────────────────────────────

    @ViewBuilder
    private var addForm: some View {
        NavigationStack {
            Form {
                Picker("Worker", selection: $vm.cookId) {
                    Text("— pick —").tag("")
                    ForEach(vm.staff) { s in Text(s.displayName).tag(s.id) }
                }
                if vm.staffUnavailable {
                    Text("No staff on file — run the staff sync to create data/cache/staff.json.")
                        .font(.caption).foregroundStyle(.orange)
                }
                Picker("Kind", selection: $vm.kind) {
                    Text("Tip pool").tag(TipKind.tip_pool)
                    Text("Service charge").tag(TipKind.service_charge)
                    Text("Direct tip").tag(TipKind.direct_tip)
                }
                TextField("Pool ref (e.g. lunch)", text: $vm.poolRef)
                TextField("Role (optional)", text: $vm.role)
                TextField("Amount ($)", text: $vm.amountText)
                TextField("Note (optional)", text: $vm.note)
                if let submitError = vm.submitError {
                    Text(submitError).font(.caption).foregroundStyle(.red)
                }
            }
            .navigationTitle("Add a line")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { vm.showForm = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        // Dismiss first — the PIN sheet may need to present next,
                        // and two sheets can't be up at once (PR #401). Fields
                        // stay populated until the submit succeeds.
                        vm.showForm = false
                        vm.requestSubmit()
                    }
                    .disabled(vm.cookId.isEmpty || vm.amountText.isEmpty)
                }
            }
        }
        .frame(minWidth: 360, minHeight: 380)
    }

    /// Integer cents → "$X.XX".
    private func money(_ cents: Int) -> String {
        let sign = cents < 0 ? "-" : ""
        let c = abs(cents)
        return "\(sign)$\(c / 100).\(String(format: "%02d", c % 100))"
    }
}
