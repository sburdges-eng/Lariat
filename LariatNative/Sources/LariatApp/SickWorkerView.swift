import SwiftUI
import LariatDB
import LariatModel

/// Sick-worker board — native port of `app/food-safety/sick-worker/SickWorkerBoard.jsx`.
/// FDA §2-201.11: a report stays open until the worker is cleared; only the PIC
/// (manager PIN) files or closes reports. Shows currently excluded/restricted
/// workers, a PIN-gated new-report form, and recently-cleared history.
struct SickWorkerView: View {
    @State private var vm: SickWorkerViewModel

    private static let symptomLabels: [(SickSymptom, String)] = [
        (.vomiting, "Vomiting"),
        (.diarrhea, "Diarrhea"),
        (.jaundice, "Jaundice"),
        (.soreThroatWithFever, "Sore throat with fever"),
        (.infectedLesion, "Open / infected lesion"),
    ]

    private static let diagnosisLabels: [(SickDiagnosis, String)] = [
        (.norovirus, "Norovirus"),
        (.salmonellaTyphi, "Salmonella Typhi"),
        (.salmonellaNontyphoidal, "Salmonella (nontyphoidal)"),
        (.shigella, "Shigella"),
        (.stecEhec, "STEC / E. coli O157:H7"),
        (.hepatitisA, "Hepatitis A"),
    ]

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: SickWorkerViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.snapshot == nil {
                TileDegrade(title: "Could not load sick reports", message: err, systemImage: "cross.case")
            } else if let snap = vm.snapshot {
                content(snap)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Sick worker reports")
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
    private func content(_ snap: SickWorkerBoardSnapshot) -> some View {
        List {
            Section {
                Text("FDA §2-201.11 — a report stays open until the worker is cleared. Only the PIC files or closes reports.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            if let err = vm.actionError {
                Section { Text(err).font(.callout).foregroundStyle(.red) }
            }

            if !vm.pinOk {
                Section {
                    Text("Filing and clearing reports requires the manager PIN.")
                        .font(.callout).foregroundStyle(.orange)
                }
            }

            activeSection(snap)

            if vm.pinOk {
                newReportSection()
            }

            if vm.pinOk && !snap.history.isEmpty {
                historySection(snap)
            }
        }
    }

    // ── Currently excluded / restricted ────────────────────────────────

    @ViewBuilder
    private func activeSection(_ snap: SickWorkerBoardSnapshot) -> some View {
        Section("Currently excluded / restricted (\(snap.active.count))") {
            if snap.active.isEmpty {
                Text("Everybody clear. Line is good to run.").foregroundStyle(.secondary)
            } else {
                ForEach(snap.active) { row in
                    activeRow(row)
                }
            }
        }
    }

    @ViewBuilder
    private func activeRow(_ row: SickWorkerRow) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(vm.workerName(row.cookId)).font(.headline)
                Spacer()
                Text(row.action.uppercased())
                    .font(.caption2).padding(4)
                    .background(tone(row.action).opacity(0.2)).clipShape(Capsule())
                    .foregroundStyle(tone(row.action))
            }
            Text(metaLine(row)).font(.caption).foregroundStyle(.secondary)

            if vm.pinOk {
                Menu {
                    ForEach(SickWorkerViewModel.clearanceSources, id: \.id) { source in
                        Button(source.label) {
                            Task { await vm.clear(id: row.id, source: source.id) }
                        }
                    }
                } label: {
                    Label("Clear to return…", systemImage: "checkmark.seal")
                        .font(.caption)
                }
                .disabled(vm.isSaving)
            }
        }
        .padding(.vertical, 2)
    }

    // ── File a new report (PIN-gated) ──────────────────────────────────

    @ViewBuilder
    private func newReportSection() -> some View {
        Section("File a new report") {
            Picker("Worker", selection: $vm.reportCookId) {
                Text("— pick —").tag("")
                ForEach(vm.staff) { s in
                    Text(s.displayName).tag(s.id)
                }
            }
            Picker("Filed by PIC", selection: $vm.reportPicId) {
                Text("— pick —").tag("")
                ForEach(vm.staff) { s in
                    Text(s.displayName).tag(s.id)
                }
            }

            ForEach(Self.symptomLabels, id: \.0) { symptom, label in
                Toggle(label, isOn: Binding(
                    get: { vm.selectedSymptoms.contains(symptom) },
                    set: { on in
                        if on { vm.selectedSymptoms.insert(symptom) }
                        else { vm.selectedSymptoms.remove(symptom) }
                    }
                ))
            }

            Picker("Diagnosed illness (Big-6, if any)", selection: $vm.selectedDiagnosis) {
                Text("— none reported —").tag(SickDiagnosis?.none)
                ForEach(Self.diagnosisLabels, id: \.0) { dx, label in
                    Text(label).tag(SickDiagnosis?.some(dx))
                }
            }

            Text("FDA minimum action for this combo: \(vm.suggestedAction.rawValue). You can raise but not lower.")
                .font(.caption).foregroundStyle(.secondary)

            Picker("Action", selection: $vm.overrideAction) {
                Text("Use FDA minimum (\(vm.suggestedAction.rawValue))").tag(SickAction?.none)
                Text("Excluded from facility").tag(SickAction?.some(.excluded))
                Text("Restricted from food / clean-contact surfaces").tag(SickAction?.some(.restricted))
                Text("Monitor").tag(SickAction?.some(.monitor))
                Text("No action").tag(SickAction?.some(.none))
            }

            TextField("Notes (private, not shared with line)", text: $vm.reportNote, axis: .vertical)
                .lineLimit(2...4)

            Button(vm.isSaving ? "Filing…" : "File report") {
                Task { await vm.fileReport() }
            }
            .disabled(vm.isSaving || vm.reportCookId.isEmpty)
        }
    }

    // ── Recently cleared history ───────────────────────────────────────

    @ViewBuilder
    private func historySection(_ snap: SickWorkerBoardSnapshot) -> some View {
        Section("Recently cleared") {
            ForEach(snap.history) { h in
                VStack(alignment: .leading, spacing: 2) {
                    Text(vm.workerName(h.cookId)).font(.subheadline)
                    Text("\(h.action) · \(timeText(h.startedAt)) → \(timeText(h.returnAt)) · \(h.clearanceSource ?? "—")")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    // ── formatting helpers (mirror SickWorkerBoard.jsx) ─────────────────

    private func tone(_ action: String) -> Color {
        switch action {
        case "excluded": return .red
        case "restricted": return .orange
        default: return .blue
        }
    }

    private func metaLine(_ row: SickWorkerRow) -> String {
        var parts = ["\(row.action.uppercased()) · since \(timeText(row.startedAt))"]
        if let dx = row.diagnosedIllness, !dx.isEmpty { parts.append(dx) }
        if !row.symptoms.isEmpty { parts.append(row.symptoms.replacingOccurrences(of: ",", with: ", ")) }
        return parts.joined(separator: " · ")
    }

    private func timeText(_ iso: String?) -> String {
        guard let iso else { return "—" }
        for p in [Self.isoFractional, Self.isoPlain] {
            if let d = p.date(from: iso) {
                let f = DateFormatter()
                f.dateFormat = "MMM d, h:mm a"
                return f.string(from: d)
            }
        }
        return iso
    }

    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f
    }()
}
