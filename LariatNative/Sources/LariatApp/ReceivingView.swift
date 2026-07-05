import SwiftUI
import LariatDB
import LariatModel

struct ReceivingView: View {
    @State private var vm: ReceivingViewModel
    @State private var vendor = ""
    @State private var invoice = ""
    @State private var category: ReceivingCategory = .refrigerated
    @State private var item = ""
    @State private var vendorSku = ""
    @State private var reading = ""
    @State private var packageOk = true
    @State private var expiration = ""
    @State private var note = ""
    @State private var receivedQty = ""
    @State private var receivedUnit = ""

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: ReceivingViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.snapshot == nil {
                TileDegrade(title: "Could not load receiving", message: err, systemImage: "shippingbox")
            } else if let snap = vm.snapshot {
                content(snap)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Receiving")
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

    // ── live decision drives the note field + reading tint ──────────────

    private var live: ReceivingStatus? {
        vm.liveDecision(
            category: category,
            readingText: reading,
            packageOk: packageOk,
            expirationDate: expiration
        )
    }

    private var showNoteField: Bool {
        vm.needsNote || live == .acceptWithNote || live == .rejected
    }

    @ViewBuilder
    private func content(_ snap: ReceivingBoardSnapshot) -> some View {
        List {
            if let err = vm.actionError {
                Section { Text(err).font(.callout).foregroundStyle(.red) }
            }

            categorySection(snap)
            entryFormSection()
            if !snap.entries.isEmpty { deliveriesSection(snap) }
        }
    }

    // ── category tiles ──────────────────────────────────────────────────

    @ViewBuilder
    private func categorySection(_ snap: ReceivingBoardSnapshot) -> some View {
        let clean = snap.summary.filter { $0.status == .green }.count
        let withNote = snap.summary.filter { $0.status == .yellow }.count
        let red = snap.summary.filter { $0.status == .red }.count

        Section("By category (\(snap.summary.count))") {
            Text("\(clean) clean · \(withNote) accept-with-note · \(red) with rejects · \(snap.totals.accepted) accepted / \(snap.totals.acceptedWithNote) noted / \(snap.totals.rejected) rejected today")
                .font(.caption).foregroundStyle(.secondary)
            ForEach(snap.summary) { s in categoryTile(s) }
        }
    }

    @ViewBuilder
    private func categoryTile(_ s: ReceivingCategorySummary) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Text(s.label).font(.headline)
                Text(boundLabel(s)).font(.caption2).foregroundStyle(.secondary)
                Text(statusLine(s)).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(s.total)").font(.title3.monospacedDigit()).foregroundStyle(tone(s.status).color)
                if let last = s.lastAt {
                    Text("Last \(timeText(last))").font(.caption2).foregroundStyle(.secondary)
                } else {
                    Text("None yet").font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(s.label), \(toneWord(tone(s.status))), \(s.total) today, \(statusLine(s))")
    }

    // ── entry form ──────────────────────────────────────────────────────

    @ViewBuilder
    private func entryFormSection() -> some View {
        Section("Log a delivery line") {
            TextField("Vendor — e.g. Shamrock, Sysco", text: $vendor)
            TextField("Invoice / PO # (optional)", text: $invoice)
            Picker("Category", selection: $category) {
                ForEach(vm.categories, id: \.self) { c in
                    Text(vm.rule(for: c)?.label ?? c.rawValue).tag(c)
                }
            }
            TextField("Item — e.g. chicken breast 40lb CS", text: $item)
            TextField("SKU (optional)", text: $vendorSku)

            let activeRule = vm.rule(for: category)
            let readingRequired = activeRule?.requiresReading == true
            TextField(
                readingRequired ? "Reading °F (\(boundLabelRule(activeRule)))" : "Reading °F — optional",
                text: $reading
            )
            .foregroundStyle(readingTint)

            TextField("Sell-by date (YYYY-MM-DD, optional)", text: $expiration)

            HStack {
                TextField("How much? (optional)", text: $receivedQty)
                TextField("Unit — lb, case, ea", text: $receivedUnit)
            }

            Toggle("Package intact (§3-202.15)", isOn: $packageOk)

            if showNoteField {
                TextField(
                    live == .rejected ? "Rejection reason (required — reject the line)"
                                      : "Corrective action (required — accept only with a fix recorded)",
                    text: $note
                )
                .foregroundStyle(.red)
            }

            Button(vm.isSaving ? "Saving…" : "Record delivery") {
                Task {
                    let ok = await vm.recordDelivery(
                        vendor: vendor, category: category, invoice: invoice, item: item,
                        vendorSku: vendorSku, readingText: reading, packageOk: packageOk,
                        expiration: expiration, note: note, receivedQtyText: receivedQty,
                        receivedUnit: receivedUnit
                    )
                    if ok { resetForm() }
                }
            }
            .disabled(vm.isSaving || vendor.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }

    private func resetForm() {
        vendor = ""; invoice = ""; item = ""; vendorSku = ""; reading = ""
        packageOk = true; expiration = ""; note = ""; receivedQty = ""; receivedUnit = ""
    }

    // ── today's deliveries ──────────────────────────────────────────────

    @ViewBuilder
    private func deliveriesSection(_ snap: ReceivingBoardSnapshot) -> some View {
        Section("Today's deliveries (\(snap.entries.count))") {
            ForEach(snap.entries) { e in deliveryRow(e) }
        }
    }

    @ViewBuilder
    private func deliveryRow(_ e: ReceivingRow) -> some View {
        let tone = tone(entryTone(e))
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(entryTitle(e)).font(.subheadline)
                Spacer()
                Text(entryTempLine(e)).font(.caption).foregroundStyle(tone.color)
            }
            Text(entryMeta(e)).font(.caption2).foregroundStyle(.secondary)
        }
        .padding(.vertical, 1)
    }

    private func entryTitle(_ e: ReceivingRow) -> String {
        var parts = [e.vendor]
        if let inv = e.invoiceRef { parts.append(inv) }
        if let it = e.item { parts.append(it) }
        if let sku = e.vendorSku { parts.append(sku) }
        return parts.joined(separator: " · ")
    }

    private func entryTempLine(_ e: ReceivingRow) -> String {
        let label = vm.rule(for: ReceivingCategory(rawValue: e.category) ?? .refrigerated)?.label ?? e.category
        if let r = e.readingF { return "\(label) · \(fmtTemp(r))°F" }
        return label
    }

    private func entryMeta(_ e: ReceivingRow) -> String {
        var parts: [String] = []
        if let created = e.createdAt { parts.append(timeText(created)) }
        if let cook = e.cookId { parts.append(cook) }
        if let exp = e.expirationDate { parts.append("sell-by \(exp)") }
        if e.packageOk == 0 { parts.append("PACKAGE COMPROMISED") }
        if let reason = e.rejectionReason { parts.append(reason) }
        return parts.joined(separator: " · ")
    }

    private func entryTone(_ e: ReceivingRow) -> ReceivingTileStatus {
        switch e.status {
        case "rejected": return .red
        case "accepted_with_note": return .yellow
        default: return .green
        }
    }

    // ── formatting helpers (mirror ReceivingBoard.jsx) ──────────────────

    private enum Tone { case green, amber, red
        var color: Color {
            switch self { case .green: return .green; case .amber: return .orange; case .red: return .red }
        }
    }

    private func tone(_ status: ReceivingTileStatus) -> Tone {
        switch status {
        case .green: return .green
        case .yellow: return .amber
        case .red: return .red
        case .gray: return .green
        }
    }

    private func toneWord(_ t: Tone) -> String {
        switch t {
        case .green: return "all clean"
        case .amber: return "some with notes"
        case .red: return "has rejects"
        }
    }

    private var readingTint: Color {
        switch live {
        case .rejected: return .red
        case .acceptWithNote: return .orange
        default: return .primary
        }
    }

    private func boundLabel(_ s: ReceivingCategorySummary) -> String {
        if !s.requiresReading { return "no temp · \(citationShort(s.citation))" }
        if let min = s.requiredMinF, let max = s.requiredMaxF { return "\(fmtTemp(min))–\(fmtTemp(max))°F" }
        if let min = s.requiredMinF { return "≥ \(fmtTemp(min))°F" }
        if let max = s.requiredMaxF { return "≤ \(fmtTemp(max))°F" }
        return ""
    }

    private func boundLabelRule(_ r: ReceivingCategoryRule?) -> String {
        guard let r else { return "" }
        if !r.requiresReading { return "no temp" }
        if let min = r.requiredMinF, let max = r.requiredMaxF { return "\(fmtTemp(min))–\(fmtTemp(max))°F" }
        if let min = r.requiredMinF { return "≥ \(fmtTemp(min))°F" }
        if let max = r.requiredMaxF { return "≤ \(fmtTemp(max))°F" }
        return ""
    }

    private func statusLine(_ s: ReceivingCategorySummary) -> String {
        if s.total == 0 { return "Not received today" }
        switch s.status {
        case .green: return "\(s.accepted) accepted"
        case .yellow: return "\(s.acceptedWithNote) with note · \(s.accepted) accepted"
        case .red: return "\(s.rejected) rejected · \(s.acceptedWithNote) with note · \(s.accepted) accepted"
        case .gray: return "Not received today"
        }
    }

    private func citationShort(_ c: String) -> String {
        c.split(separator: "—").first.map { $0.trimmingCharacters(in: .whitespaces) } ?? c
    }

    private func fmtTemp(_ v: Double) -> String {
        v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v)
    }

    private func timeText(_ iso: String) -> String {
        // receiving_log.created_at is `YYYY-MM-DD HH:MM:SS` (SQLite datetime),
        // treated as UTC — mirror the JS board's fmtTime fallback.
        for p in [Self.isoFractional, Self.isoPlain] {
            if let d = p.date(from: iso) { return Self.clock.string(from: d) }
        }
        let normalized = iso.replacingOccurrences(of: " ", with: "T") + "Z"
        if let d = Self.isoPlain.date(from: normalized) { return Self.clock.string(from: d) }
        return iso
    }

    private static let clock: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "h:mm a"; return f
    }()
    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f
    }()
}
