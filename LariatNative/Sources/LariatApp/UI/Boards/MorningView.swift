import SwiftUI
import LariatDB
import LariatModel

// Native port of /morning — the manager-open morning digest.
//
// READ-ONLY surface: reads the digest via CommandRepository + MorningRepository →
// MorningCompute (no write path, no audit_events). PIN-gated per web middleware.js:
// when a manager PIN is configured, viewing requires a valid PIN session; the sheet
// unlocks the surface. Mirrors app/morning/page.jsx section-for-section.

struct MorningView: View {
    @State private var vm: MorningViewModel

    init(database: LariatDatabase, writeDatabase: LariatWriteDatabase?) {
        _vm = State(wrappedValue: MorningViewModel(database: database, writeDatabase: writeDatabase))
    }

    var body: some View {
        Group {
            switch vm.gate {
            case .checking:
                ProgressView()
            case .unavailable(let msg):
                TileDegrade(title: "Morning digest locked", message: msg, systemImage: "lock")
            case .locked:
                MorningLockedView { vm.requestUnlock() }
            case .open:
                digestBody
            }
        }
        .navigationTitle("Morning digest")
        .task { vm.start() }
        .tracksActiveBoard(vm.poller)
        .onDisappear { vm.stop() }
        .sheet(isPresented: $vm.showPinSheet) {
            if let writeDB = vm.writeDatabase {
                PinEntrySheet(database: writeDB) { user in vm.pinVerified(user) }
            }
        }
    }

    @ViewBuilder
    private var digestBody: some View {
        if let err = vm.errorText {
            TileDegrade(title: "Database unavailable", message: err,
                        systemImage: "externaldrive.badge.xmark")
        } else if let digest = vm.digest {
            MorningDigestView(digest: digest)
        } else {
            ProgressView()
        }
    }
}

// MARK: - Locked (PIN gate)

private struct MorningLockedView: View {
    let onUnlock: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "lock.shield")
                .font(.system(size: 44))
                .foregroundStyle(.secondary)
            Text("Manager PIN required")
                .font(.title3).bold()
            Text("The morning digest holds sensitive financial and staffing signals. Enter your manager PIN to view it.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)
            Button("Enter PIN", action: onUnlock)
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
}

// MARK: - Digest body (mirrors page.jsx sections)

private struct MorningDigestView: View {
    let digest: MorningDigest

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("What needs eyes before the day gets moving.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                topHeadsUp
                eightySixSection
                priceShocksSection
                certsSection
                maintenanceSection
                beoPrepSection
                webhookSection
            }
            .padding()
            .frame(maxWidth: 820, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // Top heads-up — first 5 alerts (page.jsx alerts.slice(0,5)).
    private var topHeadsUp: some View {
        MorningSectionCard(title: "Top heads-up",
                           sub: "\(digest.alerts.count) live alerts") {
            if digest.alerts.isEmpty {
                Text("No red flags right now.").foregroundStyle(.secondary)
            } else {
                ForEach(Array(digest.alerts.prefix(5).enumerated()), id: \.offset) { _, alert in
                    HStack(spacing: 8) {
                        Circle()
                            .fill(alert.severity == .red ? Color.red : Color.orange)
                            .frame(width: 7, height: 7)
                        Text(alert.message).font(.callout)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(severityWord(alert.severity)): \(alert.message)")
                }
            }
        }
    }

    /// Verbalizes the severity dot's color for VoiceOver — the dot itself has no spoken
    /// equivalent otherwise (red/orange is the only signal distinguishing critical from warning).
    private func severityWord(_ severity: CommandAlert.Severity) -> String {
        severity == .red ? "Critical" : "Warning"
    }

    // 86 board.
    private var eightySixSection: some View {
        MorningSectionCard(title: "86 board",
                           sub: "\(digest.eightySix.count) open") {
            if digest.eightySix.items.isEmpty {
                Text("Nothing 86’d right now.").foregroundStyle(.secondary)
            } else {
                ForEach(Array(digest.eightySix.items.enumerated()), id: \.offset) { _, row in
                    Text(row.reason.map { "\(row.item) — \($0)" } ?? row.item)
                        .font(.callout)
                }
            }
        }
    }

    // Price shocks — first 8 (page.jsx slice(0,8)).
    private var priceShocksSection: some View {
        MorningSectionCard(title: "Price shocks",
                           sub: "\(digest.priceShocks.count) moved 5%+ this week") {
            if digest.priceShocks.items.isEmpty {
                Text("No big vendor moves this week.").foregroundStyle(.secondary)
            } else {
                ForEach(Array(digest.priceShocks.items.prefix(8).enumerated()), id: \.offset) { _, row in
                    Text("\(row.ingredient) — \(MorningCompute.fmtPct(row.deltaPct)) (\(row.vendor) \(row.sku))")
                        .font(.callout)
                }
            }
        }
    }

    // Certs this week.
    private var certsSection: some View {
        MorningSectionCard(title: "Certs this week",
                           sub: "\(digest.certsExpiringWeek.count) due in 7 days") {
            if digest.certsExpiringWeek.items.isEmpty {
                Text("No certs due this week.").foregroundStyle(.secondary)
            } else {
                ForEach(Array(digest.certsExpiringWeek.items.enumerated()), id: \.offset) { _, row in
                    Text("\(row.cookId) — \(row.certLabel) due \(row.expiresOn)")
                        .font(.callout)
                }
            }
        }
    }

    // Maintenance due.
    private var maintenanceSection: some View {
        MorningSectionCard(title: "Maintenance due",
                           sub: "\(digest.maintenanceDue.count) due now") {
            if digest.maintenanceDue.items.isEmpty {
                Text("No maintenance due right now.").foregroundStyle(.secondary)
            } else {
                ForEach(Array(digest.maintenanceDue.items.enumerated()), id: \.offset) { _, row in
                    Text("\(row.equipmentName) — \(row.task) (\(row.nextDue))")
                        .font(.callout)
                }
            }
        }
    }

    // BEO prep.
    private var beoPrepSection: some View {
        MorningSectionCard(title: "BEO prep",
                           sub: "\(digest.beoPrep.count) with open prep") {
            if digest.beoPrep.items.isEmpty {
                Text("No banquet prep open right now.").foregroundStyle(.secondary)
            } else {
                ForEach(Array(digest.beoPrep.items.enumerated()), id: \.offset) { _, row in
                    Text(beoLine(row)).font(.callout)
                }
            }
        }
    }

    // Webhook text — the Slack-ready block (page.jsx <pre>).
    private var webhookSection: some View {
        MorningSectionCard(title: "Webhook text",
                           sub: "Ready to paste into a Slack webhook") {
            Text(digest.webhookText)
                .font(.system(.caption, design: .monospaced))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// Mirrors page.jsx BEO line: "<title> — <date> <time> · N open / M total".
    private func beoLine(_ row: MorningBeoPrepItem) -> String {
        var s = row.title
        if let d = row.eventDate { s += " — \(d)" }
        if let t = row.eventTime { s += " \(fmtEventTime(t))" }
        s += " · \(row.openTasks) open / \(row.totalTasks) total"
        return s
    }

    /// Port of page.jsx fmtEventTime — "17:00" → "5:00 pm".
    private func fmtEventTime(_ t: String) -> String {
        let parts = t.split(separator: ":")
        guard parts.count >= 2, let h = Int(parts[0]) else { return t }
        let mm = String(parts[1].prefix(2))
        let ampm = h >= 12 ? "pm" : "am"
        let h12 = ((h + 11) % 12) + 1
        return "\(h12):\(mm) \(ampm)"
    }
}

// MARK: - Section card

private struct MorningSectionCard<Content: View>: View {
    let title: String
    let sub: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.title3).bold()
                Text(sub).font(.caption).foregroundStyle(.secondary)
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
    }
}
