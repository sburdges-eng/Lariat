import SwiftUI
import LariatDB
import LariatModel

struct CoolingView: View {
    @State private var vm: CoolingViewModel
    @State private var item = ""
    @State private var station = ""
    @State private var startTemp = ""
    @State private var reading: [Int64: String] = [:]
    @State private var note: [Int64: String] = [:]

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: CoolingViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.snapshot == nil {
                TileDegrade(title: "Could not load cooling", message: err, systemImage: "thermometer.snowflake")
            } else if let snap = vm.snapshot {
                content(snap)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Cooling")
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
    private func content(_ snap: CoolingBoardSnapshot) -> some View {
        List {
            if let err = vm.actionError {
                Section {
                    Text(err).font(.callout).foregroundStyle(.red)
                }
            }

            Section("New batch") {
                Text("Two-stage cool — 135°F → 70°F inside 2 hours, then 70°F → 41°F inside 4 more.")
                    .font(.caption).foregroundStyle(.secondary)
                TextField("What is it? e.g. black beans, brisket", text: $item)
                TextField("Station (optional)", text: $station)
                TextField("Start temp °F (optional)", text: $startTemp)
                Button(vm.isSaving ? "Starting…" : "Start cooling") {
                    Task {
                        await vm.startBatch(item: item, station: station, startReadingText: startTemp)
                        if vm.actionError == nil { item = ""; station = ""; startTemp = "" }
                    }
                }
                .disabled(vm.isSaving || item.trimmingCharacters(in: .whitespaces).isEmpty)
            }

            Section("Open batches (\(snap.open.count))") {
                if snap.open.isEmpty {
                    Text("Nothing cooling right now. Start a batch above the moment hot food leaves the line.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(snap.open) { row in
                        openBatchRow(row)
                    }
                }
            }

            if !snap.closed.isEmpty {
                Section("Closed today (\(snap.closed.count))") {
                    ForEach(snap.closed) { row in
                        closedBatchRow(row)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func openBatchRow(_ row: CoolingRow) -> some View {
        let scan = vm.scanEntry(for: row)
        let stage = scan?.stage ?? (row.stage1At == nil ? 1 : 2)
        let stageCeiling = stage == 1 ? 70 : 41

        // Outer wrapper keeps this a single List row: returning two sibling
        // top-level views from this @ViewBuilder function (info block + action
        // row) would compile, but List/ForEach explodes a TupleView row body
        // into multiple separate rows (its own separator/insets each) instead
        // of one row with two stacked halves. Wrapping preserves the original
        // single-row layout while still scoping `.combine` to the read-only info.
        VStack(alignment: .leading, spacing: 6) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.item).font(.headline)
                        Text(metaLine(row)).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(clockText(scan?.minutesRemaining))
                            .font(.title3.monospacedDigit())
                            .foregroundStyle(tone(scan).color)
                        Text("Stage \(stage) · \(tone(scan) == .red ? "OVER" : "to ≤\(stageCeiling)°F")")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }

                if let s1 = row.stage1At, let s1r = row.stage1ReadingF {
                    Text("Stage 1 closed \(timeText(s1)) @ \(fmtTemp(s1r))°F")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(row.item), stage \(stage), \(toneWord(tone(scan))), \(clockText(scan?.minutesRemaining))")

            HStack {
                TextField("Current temp °F (target ≤ \(stageCeiling))",
                          text: Binding(get: { reading[row.id] ?? "" }, set: { reading[row.id] = $0 }))
                TextField("Corrective action (if out of range)",
                          text: Binding(get: { note[row.id] ?? "" }, set: { note[row.id] = $0 }))
                Button(vm.isSaving ? "Saving…" : "Log stage \(stage)") {
                    Task {
                        await vm.logReading(id: row.id, readingText: reading[row.id] ?? "", note: note[row.id] ?? "")
                        if vm.actionError == nil { reading[row.id] = ""; note[row.id] = "" }
                    }
                }
                .disabled(vm.isSaving)
                .accessibilityLabel("Log stage \(stage) reading for \(row.item)")
            }
        }
        .padding(.vertical, 2)
    }

    private func toneWord(_ t: Tone) -> String {
        switch t {
        case .green: return "on track"
        case .amber: return "approaching limit"
        case .red: return "over time limit"
        }
    }

    @ViewBuilder
    private func closedBatchRow(_ row: CoolingRow) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.item).font(.subheadline)
                Text("\(timeText(row.startedAt)) → \(timeText(row.stage2At ?? row.stage1At))"
                     + (row.stage2ReadingF.map { " · closed @ \(fmtTemp($0))°F" } ?? ""))
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if row.status == "breach" {
                Text("Breach · \(row.breachReason ?? "see note")")
                    .font(.caption2).padding(4)
                    .background(Color.red.opacity(0.2)).clipShape(Capsule())
            } else {
                Text("OK").font(.caption2).padding(4)
                    .background(Color.green.opacity(0.2)).clipShape(Capsule())
            }
        }
    }

    // ── formatting helpers (mirror CoolingBoard.jsx) ────────────────────

    private enum Tone { case green, amber, red
        var color: Color {
            switch self {
            case .green: return .green
            case .amber: return .orange
            case .red: return .red
            }
        }
    }

    private func tone(_ scan: CoolingScanEntry?) -> Tone {
        guard let m = scan?.minutesRemaining else { return .green }
        if m < 0 { return .red }
        if m <= 30 { return .amber }
        return .green
    }

    private func metaLine(_ row: CoolingRow) -> String {
        var parts = ["started \(timeText(row.startedAt))"]
        if let r = row.startReadingF { parts[0] += " @ \(fmtTemp(r))°F" }
        if let s = row.stationId { parts.append(s) }
        return parts.joined(separator: " · ")
    }

    private func clockText(_ mins: Double?) -> String {
        guard let mins, mins.isFinite else { return "—" }
        let sign = mins < 0 ? "-" : ""
        let total = Int(abs(mins).rounded())
        return String(format: "%@%d:%02d", sign, total / 60, total % 60)
    }

    private func fmtTemp(_ v: Double) -> String {
        v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v)
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
