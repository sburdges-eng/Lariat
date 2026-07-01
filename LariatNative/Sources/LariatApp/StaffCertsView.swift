import SwiftUI
import LariatDB
import LariatModel

/// Staff-certifications board — native port of `app/labor/certs/CertBoard.jsx`.
/// CO 6 CCR 1010-2 §2-102: a Certified Food Protection Manager must be on duty
/// during service; a lapsed CFPM at inspection is a citation, not a warning, so
/// expiry inside 30 days is amber and a lapsed cert is red. Reads are open;
/// recording and retiring certs are gated by the manager PIN (native analog of
/// the web `pic.staff_certs` scope) and audited as `native_mac`.
struct StaffCertsView: View {
    @State private var vm: StaffCertViewModel

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: StaffCertViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.rows.isEmpty {
                TileDegrade(title: "Could not load certifications", message: err, systemImage: "checkmark.seal")
            } else {
                content
            }
        }
        .navigationTitle("Certifications")
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
                    Text("CO 6 CCR 1010-2 §2-102. A CFPM must be on duty during service. A lapsed CFPM at inspection is a citation, not a warning.")
                        .font(.caption).foregroundStyle(.secondary)
                }

                if let submitError = vm.submitError {
                    Section { Text(submitError).font(.callout).foregroundStyle(.red) }
                }

                Section("All tracked certs (\(vm.rows.count))") {
                    if vm.rows.isEmpty {
                        Text("Nothing recorded yet.").foregroundStyle(.secondary)
                    } else {
                        ForEach(vm.rows) { row in
                            certRow(row)
                        }
                    }
                }
            }

            HStack {
                Spacer()
                Button("Add cert") { vm.showForm = true }
                    .padding()
            }
        }
    }

    @ViewBuilder
    private func certRow(_ row: StaffCertRow) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(vm.workerName(row.cookId)).font(.headline)
                Spacer()
                Text(expiryText(row))
                    .font(.caption2).padding(4)
                    .background(color(vm.tone(for: row)).opacity(0.18)).clipShape(Capsule())
                    .foregroundStyle(color(vm.tone(for: row)))
            }
            Text(metaLine(row)).font(.caption).foregroundStyle(.secondary)

            if row.active == 1 {
                Button(role: .destructive) {
                    vm.requestRetire(id: row.id)
                } label: {
                    Label("Retire", systemImage: "archivebox")
                        .font(.caption)
                }
            }
        }
        .padding(.vertical, 2)
    }

    // ── Add-cert form (mirrors the JSX add form) ───────────────────────

    @ViewBuilder
    private var addForm: some View {
        NavigationStack {
            Form {
                Picker("Worker", selection: $vm.cookId) {
                    Text("— pick —").tag("")
                    ForEach(vm.staff) { s in
                        Text(s.displayName).tag(s.id)
                    }
                }
                Picker("Type", selection: $vm.certType) {
                    ForEach(StaffCertType.allCases, id: \.self) { t in
                        Text(t.label).tag(t)
                    }
                }
                TextField("Label (e.g. ServSafe Manager)", text: $vm.certLabel)
                TextField("Issuer (ServSafe / ANSI-CFP)", text: $vm.issuer)
                TextField("Cert #", text: $vm.certNumber)
                TextField("Issued (YYYY-MM-DD)", text: $vm.issuedOn)
                TextField("Expires (YYYY-MM-DD)", text: $vm.expiresOn)
                if let submitError = vm.submitError {
                    Text(submitError).font(.caption).foregroundStyle(.red)
                }
            }
            .navigationTitle("Add a cert")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { vm.showForm = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add cert") { vm.requestSubmit() }
                        .disabled(vm.cookId.isEmpty)
                }
            }
        }
        .frame(minWidth: 360, minHeight: 420)
    }

    // ── formatting helpers (mirror CertBoard.jsx) ──────────────────────

    private func color(_ tone: StaffCertTone) -> Color {
        switch tone {
        case .green: return .green
        case .amber: return .orange
        case .red: return .red
        case .muted: return .secondary
        }
    }

    private func expiryText(_ row: StaffCertRow) -> String {
        guard let exp = row.expiresOn, !exp.isEmpty else { return "no expiry" }
        return exp
    }

    private func metaLine(_ row: StaffCertRow) -> String {
        var parts = ["\(row.certType.uppercased()) · \(row.certLabel)"]
        if let issuer = row.issuer, !issuer.isEmpty { parts.append(issuer) }
        if let num = row.certNumber, !num.isEmpty { parts.append("#\(num)") }
        // Expiry subtitle — inactive / expired Nd ago / expires today / Nd left.
        if row.active == 0 {
            parts.append("inactive")
        } else if let days = vm.daysLeft(for: row) {
            if days < 0 { parts.append("expired \(-days)d ago") }
            else if days == 0 { parts.append("expires today") }
            else { parts.append("\(days)d left") }
        }
        return parts.joined(separator: " · ")
    }
}
