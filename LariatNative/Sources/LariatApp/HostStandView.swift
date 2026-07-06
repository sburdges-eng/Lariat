import SwiftUI
import LariatDB
import LariatModel

/// `foh.host` — the host-stand waitlist (web `/host`). Summary strip,
/// add-party form, waiting table with Seat/Left, tonight's seated parties.
/// Writes are PIN-gated (PinEntrySheet); reads open.
struct HostStandView: View {
    @State private var vm: HostStandViewModel
    @State private var query = ""

    // Add-party form fields (web HostStand state).
    @State private var partyName = ""
    @State private var partySize = ""
    @State private var partyPhone = ""
    @State private var partyNotes = ""

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: HostStandViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.snapshot == nil {
                TileDegrade(title: "Could not load the waitlist", message: err, systemImage: "externaldrive.badge.xmark")
            } else if vm.snapshot != nil {
                boardContent
            } else {
                ProgressView("Loading waitlist…")
            }
        }
        .navigationTitle("Host stand")
        .task { vm.start() }
        .onDisappear { vm.stop() }
        .sheet(isPresented: $vm.showPinSheet, onDismiss: { vm.pinCancelled() }) {
            PinEntrySheet(database: vm.writeDatabase) { user in
                vm.pinVerified(user)
            }
        }
    }

    private var boardContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                if let err = vm.actionError {
                    Text(err).font(.subheadline).foregroundStyle(LariatTheme.bad)
                }
                addForm
                waitingSection
                if !vm.seatedToday.isEmpty {
                    seatedSection
                }
            }
            .padding()
        }
        .searchable(text: $query, prompt: "Find a party")
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Host Stand").font(.largeTitle.bold())
            Text("Active waitlist + tonight's seated parties.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if let s = vm.snapshot?.summary {
                Text(summaryLine(s))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func summaryLine(_ s: WaitlistSummary) -> String {
        var text = "\(s.waiting) waiting · \(s.seatedToday) seated today"
        if let avg = s.avgWaitMinutes { text += " · avg \(avg) min" }
        return text
    }

    private var addForm: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Add waiting party").font(.headline)
            HStack(spacing: 8) {
                TextField("Party name (e.g. Hendricks 4-top)", text: $partyName)
                    .textFieldStyle(.roundedBorder)
                    .frame(minWidth: 180)
                TextField("Size", text: $partySize)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 70)
                TextField("Phone (opt.)", text: $partyPhone)
                    .textFieldStyle(.roundedBorder)
                    .frame(minWidth: 120)
                TextField("Notes — allergies, requests… (opt.)", text: $partyNotes)
                    .textFieldStyle(.roundedBorder)
                Button(vm.isBusy ? "Adding…" : "Add party") {
                    vm.requestAddParty(
                        partyName: partyName,
                        partySizeText: partySize,
                        phone: partyPhone,
                        notes: partyNotes
                    ) {
                        partyName = ""; partySize = ""; partyPhone = ""; partyNotes = ""
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(vm.isBusy || partyName.trimmingCharacters(in: .whitespaces).isEmpty || partySize.isEmpty)
                .frame(minHeight: 36)
            }
        }
        .padding()
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
    }

    private var filteredWaiting: [WaitlistPartyRow] {
        filterParties(vm.waiting)
    }

    private var waitingSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Waiting (\(vm.waiting.count))").font(.headline)
            if filteredWaiting.isEmpty {
                EmptyState(
                    message: vm.waiting.isEmpty
                        ? "No parties waiting right now."
                        : "No waiting parties match “\(query)”",
                    systemImage: "person.2"
                )
            } else {
                ForEach(filteredWaiting) { p in
                    waitingRow(p)
                }
            }
        }
        .padding()
        .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
    }

    private func waitingRow(_ p: WaitlistPartyRow) -> some View {
        HStack(alignment: .top, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(p.partyName).font(.headline)
                    if let phone = p.phone, !phone.isEmpty {
                        Text(phone).font(.caption2).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text("\(p.partySize) ppl · joined \(fmtClock(p.joinedAt))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("waiting \(waitingMinutes(p)) min")
                        .font(.caption.monospaced())
                }
                if let notes = p.notes, !notes.isEmpty {
                    Text(notes)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: 200, alignment: .leading)
                }
            }
            .accessibilityElement(children: .combine)
            Button("Seat") { vm.requestTransition(id: p.id, to: "seated") }
                .buttonStyle(.borderedProminent)
                .disabled(vm.isBusy)
                .accessibilityLabel("Seat \(p.partyName)")
            Button("Left") { vm.requestTransition(id: p.id, to: "left") }
                .buttonStyle(.bordered)
                .disabled(vm.isBusy)
                .accessibilityLabel("\(p.partyName) left the waitlist")
        }
        .padding(10)
        .background(.background.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
    }

    private var seatedSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Seated today (\(vm.seatedToday.count))")
                .font(.headline)
                .foregroundStyle(.secondary)
            ForEach(filterParties(vm.seatedToday)) { p in
                HStack {
                    Text(p.partyName)
                    Spacer()
                    Text("\(p.partySize) ppl · seated \(fmtClock(p.seatedAt)) · wait \(seatedWait(p))")
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
                .padding(8)
                .background(.background.opacity(0.2), in: RoundedRectangle(cornerRadius: 8))
            }
        }
        .padding()
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 12))
    }

    private func filterParties(_ rows: [WaitlistPartyRow]) -> [WaitlistPartyRow] {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return rows }
        return rows.filter { $0.partyName.localizedCaseInsensitiveContains(q) }
    }

    /// Live wait = joined_at → now (web fmtMinutes).
    private func waitingMinutes(_ p: WaitlistPartyRow) -> Int {
        HostStandCompute.minutesBetween(p.joinedAt, HostWaitlistRepository.nowIso())
    }

    /// Seated wait = joined_at → seated_at (web parity: '—' when unset).
    private func seatedWait(_ p: WaitlistPartyRow) -> String {
        guard let seatedAt = p.seatedAt else { return "—" }
        return "\(HostStandCompute.minutesBetween(p.joinedAt, seatedAt)) min"
    }

    /// ISO timestamp → short local clock time (web fmtClock).
    private func fmtClock(_ iso: String?) -> String {
        guard let iso, let date = HostStandCompute.parseIso(iso) else { return "—" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "h:mm a"
        return f.string(from: date)
    }
}
