import SwiftUI
import LariatDB
import LariatModel

/// Wage-notices board — native port of `app/labor/wage-notices/WageNoticesBoard.jsx`.
/// Colorado Wage Theft Transparency Act (C.R.S. §8-4-103) + COMPS §3.3: employees
/// get a written pay-rate/basis notice at hire and on any change; a notice over a
/// year old is stale. Reads are open; signing a notice is gated by the manager
/// PIN (native analog of `pic.wage_notices`) and audited `native_mac`.
struct WageNoticeView: View {
    @State private var vm: WageNoticeViewModel

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: WageNoticeViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.rows.isEmpty {
                TileDegrade(title: "Could not load wage notices", message: err, systemImage: "doc.text")
            } else {
                content
            }
        }
        .navigationTitle("Wage notices")
        .task { vm.start() }
        .onDisappear { vm.stop() }
        .sheet(isPresented: $vm.showForm) { signForm }
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
                    Text("C.R.S. §8-4-103 + COMPS §3.3. Written notice of pay rate & basis at hire and on any change; a notice over a year old is stale.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if let submitError = vm.submitError {
                    Section { Text(submitError).font(.callout).foregroundStyle(.red) }
                }
                Section("Latest per worker (\(vm.rows.count))") {
                    if vm.rows.isEmpty {
                        Text("No wage notices on file.").foregroundStyle(.secondary)
                    } else {
                        ForEach(vm.rows) { row in
                            noticeRow(row)
                        }
                    }
                }
            }
            HStack {
                Spacer()
                Button("Sign notice") { vm.showForm = true }
                    .padding()
            }
        }
    }

    @ViewBuilder
    private func noticeRow(_ row: WageNoticeRow) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(vm.workerName(row.cookId)).font(.headline)
                Spacer()
                if vm.needsNew(row.cookId) {
                    Text("needs new")
                        .font(.caption2).padding(4)
                        .background(Color.red.opacity(0.18)).clipShape(Capsule())
                        .foregroundStyle(.red)
                }
            }
            Text(metaLine(row)).font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }

    private func metaLine(_ row: WageNoticeRow) -> String {
        var parts = [money(row.wageRateCents) + "/" + row.payBasis.rawValue]
        if let tip = row.tipCreditCents, tip > 0 { parts.append("tip credit " + money(tip)) }
        parts.append("signed \(row.signedOn)")
        parts.append(row.reason.rawValue.replacingOccurrences(of: "_", with: " "))
        return parts.joined(separator: " · ")
    }

    // ── Sign form ────────────────────────────────────────────────────────

    @ViewBuilder
    private var signForm: some View {
        NavigationStack {
            Form {
                Picker("Worker", selection: $vm.cookId) {
                    Text("— pick —").tag("")
                    ForEach(vm.staff) { s in Text(s.displayName).tag(s.id) }
                }
                Picker("Reason", selection: $vm.reason) {
                    ForEach(WageNoticeReason.allCases, id: \.self) { r in
                        Text(r.rawValue.replacingOccurrences(of: "_", with: " ")).tag(r)
                    }
                }
                Picker("Pay basis", selection: $vm.payBasis) {
                    ForEach(WageNoticePayBasis.allCases, id: \.self) { b in
                        Text(b.rawValue).tag(b)
                    }
                }
                TextField("Wage rate ($)", text: $vm.wageText)
                if vm.payBasis == .tipped {
                    TextField("Tip credit ($)", text: $vm.tipText)
                }
                TextField("Signed on (YYYY-MM-DD)", text: $vm.signedOn)
                if let submitError = vm.submitError {
                    Text(submitError).font(.caption).foregroundStyle(.red)
                }
            }
            .navigationTitle("Sign a notice")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { vm.showForm = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Sign") { vm.requestSubmit() }
                        .disabled(vm.cookId.isEmpty || vm.wageText.isEmpty)
                }
            }
        }
        .frame(minWidth: 360, minHeight: 420)
    }

    /// Integer cents → "$X.XX".
    private func money(_ cents: Int) -> String {
        let sign = cents < 0 ? "-" : ""
        let c = abs(cents)
        return "\(sign)$\(c / 100).\(String(format: "%02d", c % 100))"
    }
}
