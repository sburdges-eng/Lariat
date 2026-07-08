import SwiftUI
import LariatDB
import LariatModel

/// Time as Public Health Control board (F11 / FDA §3-501.19). Start a batch
/// (hot = 4h, cold = 6h), tap to discard with a reason. Rows are ordered by
/// urgency — expired first, then warning, then ok — matching TphcBoard.jsx.
struct TphcView: View {
    @State private var vm: TphcViewModel
    @State private var item = ""
    @State private var kind: TphcKind = .hotTimeOnly
    @State private var station = ""
    @State private var batchRef = ""

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: TphcViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.snapshot == nil {
                TileDegrade(title: "Could not load Time Control", message: err, systemImage: "timer")
            } else if let snap = vm.snapshot {
                content(snap)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Time Control")
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
    private func content(_ snap: TphcBoardSnapshot) -> some View {
        List {
            if let err = vm.actionError {
                Section {
                    Text(err).font(.callout).foregroundStyle(.red)
                }
            }

            Section("New batch") {
                Text("For food held by time, not temp. Hot = 4 hours. Cold = 6 hours. Toss at cutoff.")
                    .font(.caption).foregroundStyle(.secondary)
                TextField("What is it? e.g. pizza topping, cut tomato", text: $item)
                Picker("Hot or cold", selection: $kind) {
                    ForEach(vm.kinds, id: \.self) { k in
                        Text(kindLabel(k)).tag(k)
                    }
                }
                TextField("Station (optional) e.g. expo / salad", text: $station)
                TextField("Batch ref (optional)", text: $batchRef)
                Button(vm.isSaving ? "Starting…" : "Start batch") {
                    Task {
                        await vm.startBatch(item: item, kind: kind, station: station, batchRef: batchRef)
                        if vm.actionError == nil { item = ""; station = ""; batchRef = "" }
                    }
                }
                .disabled(vm.isSaving || item.trimmingCharacters(in: .whitespaces).isEmpty)
            }

            Section("Open batches (\(sortedOpen(snap).count))") {
                if sortedOpen(snap).isEmpty {
                    Text("No open batches.").foregroundStyle(.secondary)
                } else {
                    ForEach(sortedOpen(snap)) { row in
                        openBatchRow(row)
                    }
                }
            }

            if !snap.recent.isEmpty {
                Section("Recently closed (\(snap.recent.count))") {
                    ForEach(snap.recent) { row in
                        recentRow(row)
                    }
                }
            }
        }
    }

    /// Urgency order: expired first, warning next, ok last — parity with the JSX
    /// board's `order` sort. The repository's scan is already sorted most-past-due
    /// first, so we drive row order from it and fall back to cutoff ascending.
    private func sortedOpen(_ snap: TphcBoardSnapshot) -> [TphcRow] {
        let order: [TphcStatus: Int] = [.expired: 0, .warning: 1, .ok: 2]
        return snap.active.sorted { a, b in
            let sa = snap.scanEntry(id: a.id)?.status ?? .ok
            let sb = snap.scanEntry(id: b.id)?.status ?? .ok
            if order[sa] != order[sb] { return (order[sa] ?? 2) < (order[sb] ?? 2) }
            return a.cutoffAt < b.cutoffAt
        }
    }

    @ViewBuilder
    private func openBatchRow(_ row: TphcRow) -> some View {
        let scan = vm.scanEntry(for: row)
        let t = tone(scan)

        VStack(alignment: .leading, spacing: 6) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .top) {
                    Text(row.item).font(.headline)
                    Spacer()
                    Text(minutesText(scan?.minutesUntilCutoff))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(t.color)
                }
                Text(metaLine(row))
                    .font(.caption).foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(row.item), \(toneWord(t)), \(minutesText(scan?.minutesUntilCutoff))")

            HStack(spacing: 6) {
                ForEach(vm.discardReasons, id: \.self) { reason in
                    Button(reasonLabel(reason)) {
                        Task { await vm.discard(id: row.id, reason: reason) }
                    }
                    .font(.caption)
                    .buttonStyle(.bordered)
                    .disabled(vm.isSaving)
                    .accessibilityLabel("\(reasonLabel(reason)) — \(row.item)")
                }
            }
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private func recentRow(_ row: TphcRow) -> some View {
        HStack {
            Text(row.item).font(.subheadline)
            Spacer()
            Text("\(row.discardReason.map(reasonLabelRaw) ?? "closed") · \(timeText(row.discardedAt))")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    // ── labels (mirror TphcBoard.jsx REASON_LABELS / KIND_LABELS) ────────

    private func kindLabel(_ k: TphcKind) -> String {
        switch k {
        case .hotTimeOnly: return "Hot (4h)"
        case .coldTimeOnly: return "Cold (6h)"
        }
    }

    private func reasonLabel(_ r: TphcDiscardReason) -> String {
        switch r {
        case .reachedCutoff: return "Hit 4h/6h cutoff — tossed"
        case .consumed: return "Used before cutoff"
        case .quality: return "Quality — off flavor/look"
        case .contamination: return "Contamination / cross-contact"
        }
    }

    private func reasonLabelRaw(_ raw: String) -> String {
        TphcDiscardReason(rawValue: raw).map(reasonLabel) ?? raw
    }

    // ── formatting helpers (mirror TphcBoard.jsx fmtTime / fmtMinutes) ───

    private enum Tone { case green, amber, red
        var color: Color {
            switch self {
            case .green: return .green
            case .amber: return .orange
            case .red: return .red
            }
        }
    }

    private func tone(_ scan: TphcBatchStatus?) -> Tone {
        switch scan?.status {
        case .expired: return .red
        case .warning: return .amber
        default: return .green
        }
    }

    private func toneWord(_ t: Tone) -> String {
        switch t {
        case .green: return "on track"
        case .amber: return "approaching cutoff"
        case .red: return "past cutoff"
        }
    }

    /// Mirror of fmtMinutes: "Nm past cutoff" / "Nm left" / "Hh Mm left".
    private func minutesText(_ m: Int?) -> String {
        guard let m else { return "—" }
        if m < 0 { return "\(-m)m past cutoff" }
        if m < 60 { return "\(m)m left" }
        let h = m / 60
        let rem = m % 60
        return rem != 0 ? "\(h)h \(rem)m left" : "\(h)h left"
    }

    private func metaLine(_ row: TphcRow) -> String {
        var line = "Started \(timeText(row.startedAt)) → cutoff \(timeText(row.cutoffAt))"
        if let s = row.stationId { line += " · \(s)" }
        if let b = row.batchRef { line += " · \(b)" }
        return line
    }

    private func timeText(_ iso: String?) -> String {
        guard let iso else { return "—" }
        let parsers: [ISO8601DateFormatter] = [Self.isoFractional, Self.isoPlain]
        for p in parsers {
            if let d = p.date(from: iso) {
                let f = DateFormatter()
                f.dateFormat = "h:mm a"
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
