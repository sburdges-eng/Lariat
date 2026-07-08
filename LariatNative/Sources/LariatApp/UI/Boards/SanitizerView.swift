import SwiftUI
import LariatDB
import LariatModel

struct SanitizerView: View {
    @State private var vm: SanitizerViewModel
    @State private var pointLabel = ""
    @State private var chemistry: SanitizerChemistry = .chlorine
    @State private var ppm = ""
    @State private var waterTemp = ""
    @State private var note = ""

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: SanitizerViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.snapshot == nil {
                TileDegrade(title: "Could not load sanitizer", message: err, systemImage: "drop")
            } else if let snap = vm.snapshot {
                content(snap)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Sanitizer")
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
    private func content(_ snap: SanitizerBoardSnapshot) -> some View {
        List {
            Section {
                Text("FDA §4-703.11 — ppm must land inside the band for the chemistry, or the surface is not sanitized.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            if let err = vm.actionError {
                Section {
                    Text(err).font(.callout).foregroundStyle(.red)
                }
            }

            Section("Latest per point (\(snap.latest.count))") {
                if snap.latest.isEmpty {
                    Text("No readings today yet. Test the dish pit and buckets before service.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(snap.latest) { row in
                        latestTile(row)
                    }
                }
            }

            if !vm.missingToday.isEmpty {
                Section("Still to check today") {
                    ForEach(vm.missingToday) { point in
                        Button {
                            pointLabel = point.label
                            chemistry = point.chemistry
                        } label: {
                            Label("\(point.label) (\(point.chemistry.rawValue))", systemImage: "plus.circle")
                        }
                        .accessibilityLabel("Prefill form for \(point.label) using \(point.chemistry.rawValue)")
                    }
                }
            }

            Section("Log a reading") {
                TextField("Point — e.g. dish pit final rinse", text: $pointLabel)
                Picker("Chemistry", selection: $chemistry) {
                    ForEach(SanitizerCompute.chemistries, id: \.self) { c in
                        Text(chemistryLabel(c)).tag(c)
                    }
                }
                TextField("Strip reading (ppm)", text: $ppm)
                #if os(iOS)
                    .keyboardType(.decimalPad)
                #endif
                TextField(waterTempPrompt, text: $waterTemp)
                #if os(iOS)
                    .keyboardType(.numbersAndPunctuation)
                #endif
                TextField(notePrompt, text: $note)
                    .foregroundStyle(vm.needsCorrectiveNote ? Color.red : Color.primary)
                Button(vm.isSaving ? "Saving…" : "Record reading") {
                    Task {
                        await vm.record(
                            pointLabel: pointLabel,
                            chemistry: chemistry,
                            ppmText: ppm,
                            waterTempText: waterTemp,
                            note: note
                        )
                        if vm.actionError == nil {
                            pointLabel = ""; ppm = ""; waterTemp = ""; note = ""
                        }
                    }
                }
                .disabled(vm.isSaving
                          || pointLabel.trimmingCharacters(in: .whitespaces).isEmpty
                          || ppm.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    @ViewBuilder
    private func latestTile(_ row: SanitizerRow) -> some View {
        let ok = row.status == "ok"
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.pointLabel).font(.headline)
                Text(metaLine(row)).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(fmtPpm(row.concentrationPpm)) ppm")
                    .font(.title3.monospacedDigit())
                    .foregroundStyle(ok ? Color.green : Color.red)
                Text(statusText(row))
                    .font(.caption2).foregroundStyle(ok ? Color.green : Color.red)
            }
        }
        .padding(.vertical, 2)
    }

    // ── formatting helpers (mirror SanitizerBoard.jsx) ──────────────────

    private var waterTempPrompt: String {
        chemistry == .chlorine ? "Water temp °F (required for band)" : "Water temp °F (optional)"
    }

    private var notePrompt: String {
        vm.needsCorrectiveNote
            ? "Corrective action (required — out of spec)"
            : "Corrective action (required if out of spec)"
    }

    private func chemistryLabel(_ c: SanitizerChemistry) -> String {
        switch c {
        case .chlorine: return "Chlorine"
        case .quat: return "Quaternary ammonia"
        case .iodine: return "Iodine"
        case .other: return "Other"
        }
    }

    private func statusText(_ row: SanitizerRow) -> String {
        if row.status == "ok" { return "In spec" }
        let lo = row.requiredMinPpm.map { fmtPpm($0) } ?? "—"
        let hi = row.requiredMaxPpm.map { fmtPpm($0) } ?? "—"
        return "\(row.status.uppercased()) (\(lo)–\(hi))"
    }

    private func metaLine(_ row: SanitizerRow) -> String {
        var parts = [row.chemistry]
        if let wt = row.waterTempF { parts.append("\(fmtPpm(wt))°F") }
        parts.append(timeText(row.createdAt))
        return parts.joined(separator: " · ")
    }

    private func fmtPpm(_ v: Double) -> String {
        v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v)
    }

    private func timeText(_ iso: String?) -> String {
        guard let iso else { return "—" }
        // sanitizer_checks.created_at is a SQLite datetime('now') string
        // ("YYYY-MM-DD HH:MM:SS", UTC), not ISO-8601 with a T/Z. Parse that shape;
        // fall back to ISO-8601 if the row was written with a T separator.
        let sqlite = DateFormatter()
        sqlite.locale = Locale(identifier: "en_US_POSIX")
        sqlite.timeZone = TimeZone(identifier: "UTC")
        sqlite.dateFormat = "yyyy-MM-dd HH:mm:ss"
        if let d = sqlite.date(from: iso) {
            let out = DateFormatter()
            out.dateFormat = "h:mm a"
            return out.string(from: d)
        }
        for p in [Self.isoFractional, Self.isoPlain] {
            if let d = p.date(from: iso) {
                let out = DateFormatter()
                out.dateFormat = "h:mm a"
                return out.string(from: d)
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
