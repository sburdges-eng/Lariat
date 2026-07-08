import SwiftUI
import LariatDB
import LariatModel

/// Pest control board — parity with `app/food-safety/pest/PestBoard.jsx`.
/// Log every PCO service visit, sighting, and trap check. FDA §6-501.111.
struct PestView: View {
    @State private var vm: PestViewModel

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: PestViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.snapshot == nil {
                TileDegrade(title: "Could not load pest control", message: err, systemImage: "ant")
            } else if let snap = vm.snapshot {
                content(snap)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Pest control")
        .onAppear { vm.start() }
        .tracksActiveBoard(vm.poller)
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
    private func content(_ snap: PestBoardSnapshot) -> some View {
        List {
            Section {
                Text(vm.citation)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Recent (\(snap.rows.count))") {
                if snap.rows.isEmpty {
                    Text("Nothing logged yet.").foregroundStyle(.secondary)
                } else {
                    ForEach(snap.rows) { row in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(row.entryType).font(.headline)
                                Spacer()
                                Text(dateLabel(row)).font(.caption).foregroundStyle(.secondary)
                            }
                            let vt = vendorTech(row)
                            if !vt.isEmpty {
                                Text(vt).font(.subheadline)
                            }
                            let ps = pestSeverity(row)
                            if !ps.isEmpty {
                                Text(ps).font(.caption).foregroundStyle(.secondary)
                            }
                            if let f = row.findings, !f.isEmpty {
                                Text(f).font(.caption)
                            }
                            if let c = row.correctiveAction, !c.isEmpty {
                                Text("Action: \(c)").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }

            Section("Log an entry") {
                Picker("Type", selection: $vm.entryType) {
                    ForEach(vm.entryTypeOptions, id: \.id) { Text($0.label).tag($0.id) }
                }
                TextField("Vendor / PCO (e.g. EcoLab)", text: $vm.vendor)
                TextField("Technician", text: $vm.technician)
                Picker(vm.sightingNeedsPest ? "Pest (required)" : "Pest (optional)", selection: $vm.pest) {
                    ForEach(vm.pestOptions, id: \.id) { Text($0.label).tag($0.id) }
                }
                Picker("Severity", selection: $vm.severity) {
                    ForEach(vm.severityOptions, id: \.id) { Text($0.label).tag($0.id) }
                }
                TextField("Findings", text: $vm.findings)
                TextField("Corrective action", text: $vm.corrective)

                if let err = vm.actionError {
                    Text(err).font(.caption).foregroundStyle(.red)
                }
                Button(vm.isSaving ? "Saving…" : "Record entry") {
                    Task { await vm.record() }
                }
                .disabled(vm.isSaving)
            }
        }
    }

    private func dateLabel(_ row: PestRow) -> String {
        let iso = row.shiftDate.isEmpty ? (row.createdAt ?? "") : row.shiftDate
        return iso.isEmpty ? "—" : String(iso.prefix(10))
    }

    private func vendorTech(_ row: PestRow) -> String {
        let v = row.vendor ?? ""
        let t = row.technician ?? ""
        if !v.isEmpty && !t.isEmpty { return "\(v) · \(t)" }
        if !v.isEmpty { return v }
        return t
    }

    private func pestSeverity(_ row: PestRow) -> String {
        var parts: [String] = []
        if let p = row.pest, !p.isEmpty { parts.append(p) }
        if let s = row.severity, !s.isEmpty { parts.append(s) }
        return parts.joined(separator: " · ")
    }
}
