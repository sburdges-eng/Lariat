import SwiftUI
import LariatDB
import LariatModel

/// `foh.reservations` — the FOH reservations book (web `/reservations`).
/// Today / upcoming views, add form, hour-bucketed rows with
/// seat/complete/cancel/no_show/delete verbs.
struct ReservationsBoardView: View {
    @State private var vm: ReservationsBoardViewModel
    @State private var query = ""

    // Add-form fields (web AddReservationForm state).
    @State private var partyName = ""
    @State private var partySize = "2"
    @State private var time = ""
    @State private var tableId = ""
    @State private var phone = ""
    @State private var notes = ""
    @State private var confirmDeleteRow: ReservationRow?

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: ReservationsBoardViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, !vm.loaded {
                TileDegrade(title: "Could not load reservations", message: err, systemImage: "externaldrive.badge.xmark")
            } else if vm.loaded {
                boardContent
            } else {
                ProgressView("Loading reservations…")
            }
        }
        .navigationTitle("Reservations")
        .task { vm.start() }
        .tracksActiveBoard(vm.poller)
        .onDisappear { vm.stop() }
        .sheet(isPresented: $vm.showCookPicker) {
            CookIdentityPicker(
                store: vm.cookStore,
                staff: vm.staff,
                staffUnavailable: vm.staffUnavailable
            ) {
                vm.showCookPicker = false
            }
        }
        .confirmationDialog(
            "Delete reservation for \(confirmDeleteRow?.partyName ?? "")?",
            isPresented: Binding(
                get: { confirmDeleteRow != nil },
                set: { if !$0 { confirmDeleteRow = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let row = confirmDeleteRow {
                    Task { await vm.delete(id: row.id) }
                }
                confirmDeleteRow = nil
            }
            Button("Keep", role: .cancel) { confirmDeleteRow = nil }
        }
    }

    private var boardContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                Picker("View", selection: $vm.tab) {
                    ForEach(ReservationsBoardTab.allCases) { tab in
                        Text(tab.label).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 320)

                if let err = vm.actionError {
                    Text(err).font(.subheadline).foregroundStyle(LariatTheme.bad)
                }

                addForm

                if filteredRows.isEmpty {
                    EmptyState(
                        message: vm.rows.isEmpty
                            ? (vm.tab == .upcoming ? "Nothing on the upcoming book." : "No reservations on the book today.")
                            : "No reservations match “\(query)”",
                        systemImage: "calendar.badge.clock"
                    )
                } else {
                    bucketSections
                }
            }
            .padding()
        }
        .searchable(text: $query, prompt: "Find a party")
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Reservations").font(.largeTitle.bold())
            Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
        }
    }

    private var subtitle: String {
        let c = vm.counts
        var text = "\(vm.tab == .today ? "Today's book" : "Upcoming book") · \(vm.rows.count) reservation\(vm.rows.count == 1 ? "" : "s")"
        if c.people > 0 { text += " · \(c.people) ppl on the book" }
        if c.seated > 0 { text += " · \(c.seated) seated" }
        return text
    }

    private var addForm: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Add reservation").font(.headline)
            HStack(spacing: 8) {
                TextField("Party name", text: $partyName)
                    .textFieldStyle(.roundedBorder)
                    .frame(minWidth: 160)
                TextField("Size", text: $partySize)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 70)
                TextField("Time (7:00 PM)", text: $time)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 130)
                TextField("Table (opt.)", text: $tableId)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 100)
            }
            HStack(spacing: 8) {
                TextField("Phone (opt.)", text: $phone)
                    .textFieldStyle(.roundedBorder)
                    .frame(minWidth: 140)
                TextField("Notes (opt.)", text: $notes)
                    .textFieldStyle(.roundedBorder)
                Button(vm.isAdding ? "Saving…" : "Add reservation") {
                    Task {
                        let saved = await vm.add(
                            partyName: partyName, partySizeText: partySize, timeText: time,
                            tableId: tableId, phone: phone, notes: notes
                        )
                        if saved {
                            partyName = ""; partySize = "2"; time = ""
                            tableId = ""; phone = ""; notes = ""
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(vm.isAdding || partyName.trimmingCharacters(in: .whitespaces).isEmpty)
                .frame(minHeight: 36)
            }
        }
        .padding()
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
    }

    private var filteredRows: [ReservationRow] {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return vm.rows }
        return vm.rows.filter { $0.partyName.localizedCaseInsensitiveContains(q) }
    }

    private var bucketSections: some View {
        ForEach(ReservationsCompute.hourBuckets(filteredRows), id: \.key) { bucket in
            VStack(alignment: .leading, spacing: 8) {
                Text("\(bucket.key.isEmpty ? "Unscheduled" : ReservationsCompute.formatHourHeader(bucket.key)) · \(bucket.rows.count)")
                    .font(.headline)
                ForEach(bucket.rows) { row in
                    reservationRow(row)
                }
            }
            .padding(.bottom, 8)
        }
    }

    private func reservationRow(_ r: ReservationRow) -> some View {
        let busy = vm.busyId == r.id
        return HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(r.partyName).font(.headline)
                    Text("\(r.partySize) ppl")
                        .font(.caption)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(.quaternary, in: Capsule())
                    let time = ReservationsCompute.formatRowTime(r.reservationAt)
                    if !time.isEmpty {
                        Text(time).font(.caption).foregroundStyle(.secondary)
                    }
                    Text(ReservationsCompute.statusLabel(r.status))
                        .font(.caption.bold())
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(statusTone(r.status), in: Capsule())
                        .foregroundStyle(.white)
                }
                Text(rowMeta(r)).font(.caption).foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
            Spacer()
            HStack(spacing: 8) {
                if r.status == "booked" {
                    Button(vm.cookStore.cookId != nil ? "Seat" : "Pick cook to seat") {
                        Task { await vm.seat(id: r.id) }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(busy)
                    .accessibilityLabel(vm.cookStore.cookId != nil ? "Seat \(r.partyName)" : "Pick a cook, then seat \(r.partyName)")
                    Button("No-show") { Task { await vm.noShow(id: r.id) } }
                        .buttonStyle(.bordered)
                        .disabled(busy)
                        .accessibilityLabel("Mark \(r.partyName) a no-show")
                    Button("Cancel") { Task { await vm.cancel(id: r.id) } }
                        .buttonStyle(.bordered)
                        .disabled(busy)
                        .accessibilityLabel("Cancel reservation for \(r.partyName)")
                }
                if r.status == "seated" {
                    Button("Done") { Task { await vm.complete(id: r.id) } }
                        .buttonStyle(.borderedProminent)
                        .disabled(busy)
                        .accessibilityLabel("Complete reservation for \(r.partyName)")
                }
                Button {
                    confirmDeleteRow = r
                } label: {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.bordered)
                .disabled(busy)
                .accessibilityLabel("Delete reservation for \(r.partyName)")
            }
        }
        .padding(10)
        .background(.background.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
        .overlay(alignment: .leading) {
            if r.status == "seated" {
                Rectangle().fill(LariatTheme.ok).frame(width: 3)
            }
        }
    }

    private func rowMeta(_ r: ReservationRow) -> String {
        var parts: [String] = []
        if let t = r.tableId, !t.isEmpty { parts.append("table \(t)") }
        if let p = r.phone, !p.isEmpty { parts.append(p) }
        if let n = r.notes, !n.isEmpty { parts.append(n) }
        return parts.isEmpty ? "no notes" : parts.joined(separator: " · ")
    }

    // STATUS_TONE in ReservationsBoard.jsx: booked orange, seated green,
    // completed gray, cancelled/no_show red.
    private func statusTone(_ status: String) -> Color {
        switch status {
        case "booked": return LariatTheme.warn
        case "seated": return LariatTheme.ok
        case "completed": return .gray
        case "cancelled", "no_show": return LariatTheme.bad
        default: return .gray
        }
    }
}
