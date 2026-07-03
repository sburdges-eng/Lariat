import SwiftUI
import LariatDB
import LariatModel
import Observation

// Native READ-ONLY port of the /management/cloud-bridge STATUS surface
// (A5.4 option B, ratified 2026-07-03).
//
// What this shows (parity with the web board's status strip +
// GET /api/cloud-bridge/status):
//   - Bridge configured ("Set up" / "Not set up") — env probe, parity with
//     lib/cloudBridge.ts::isCloudBridgeConfigured().
//   - Waiting to send — cloudBridgeQueue depth() (queued, not yet pushed).
//   - Stuck — deadLetterDepth() (dead-lettered, gave up after retry).
//   - Last sync — the web bridge.status() stub persists NO last-push/pull
//     timestamp anywhere (ack() deletes pushed rows), so this is honestly
//     "none recorded", never an invented health signal.
//
// What this deliberately does NOT do: inspect/requeue/drop dead letters, peer
// crypto/trust, sync-since, discovery — the transport and its writes stay on
// the Next.js edge (docs/superpowers/specs/lariat-native-edge-blockers.md).
// There is NO button on this screen that mutates anything.
//
// PIN posture: the web surface is PIN-gated (/management SENSITIVE_PREFIX +
// requirePin in-route), but native manager-tier pure reads are not per-view
// PIN-gated today (manager.auditLog / costing.depletionExceptions precedent).

// MARK: - ViewModel

@Observable @MainActor final class CloudBridgeStatusViewModel {
    var status: CloudBridgeStatus?
    var configured = false
    var errorText: String?
    var isLoading = true

    private let poller = BoardPoller()
    private let repo: CloudBridgeStatusRepository

    init(database: LariatDatabase) {
        self.repo = CloudBridgeStatusRepository(database: database)
    }

    func start() {
        poller.start(interval: .seconds(3)) { [weak self] in
            guard let self else { return }
            await self.refresh()
            try BoardPoller.throwIfFailed(self.errorText)
        }
    }

    func stop() { poller.stop() }

    /// Mirrors the web page's degrade path: a failed queue read becomes an
    /// error banner (`initialError`) while the configured card still renders —
    /// it never silently shows zeros for a queue it could not read.
    func refresh() async {
        configured = CloudBridgeStatusRepository.isConfigured()
        do {
            status = try await repo.load()
            errorText = nil
        } catch {
            status = nil
            errorText = "Couldn't read the outbox queue: \(error.localizedDescription)"
        }
        isLoading = false
    }

    /// Explicit no-empty-state-lie copy when there is nothing to show.
    var quietStateMessage: String? {
        guard errorText == nil, let status else { return nil }
        guard status.queuedDepth == 0, status.deadLetterTotal == 0 else { return nil }
        if configured {
            return "No sync data yet — nothing queued, nothing stuck, and no push has been recorded."
        }
        return "Bridge not configured — no URL or secret on file, so there is no sync data. The drainer is idle."
    }
}

// MARK: - Root view

struct CloudBridgeStatusView: View {
    @State private var vm: CloudBridgeStatusViewModel

    init(database: LariatDatabase) {
        _vm = State(wrappedValue: CloudBridgeStatusViewModel(database: database))
    }

    var body: some View {
        Group {
            if vm.isLoading {
                ProgressView("Loading bridge status…")
            } else {
                content
            }
        }
        .navigationTitle("Cloud bridge")
        .task { vm.start() }
        .onDisappear { vm.stop() }
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Board subtitle (CloudBridgeBoard.jsx).
                Text("Outage queue for snapshots heading to the corp office. Read-only sync health — stuck batches are retried or dropped from the web cockpit.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                // Status strip — the board's three cards.
                HStack(spacing: 12) {
                    StatusCard(
                        label: "Bridge",
                        value: vm.configured ? "Set up" : "Not set up",
                        valueColor: vm.configured ? LariatTheme.ok : .secondary,
                        detail: vm.configured
                            ? "URL + secret on file"
                            : "No URL or secret — drainer is idle"
                    )
                    StatusCard(
                        label: "Waiting to send",
                        value: vm.status.map { String($0.queuedDepth) } ?? "—",
                        valueColor: .primary,
                        detail: "queued, not yet pushed"
                    )
                    StatusCard(
                        label: "Stuck",
                        value: vm.status.map { String($0.deadLetterTotal) } ?? "—",
                        valueColor: (vm.status?.deadLetterTotal ?? 0) > 0 ? LariatTheme.bad : .secondary,
                        detail: "gave up after retry"
                    )
                }

                // Last sync — status-endpoint parity: the web bridge does not
                // persist push/pull timestamps yet, so say so explicitly.
                GroupBox {
                    HStack(spacing: 8) {
                        Image(systemName: "clock.arrow.2.circlepath")
                            .foregroundStyle(.tertiary)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Last sync: \(vm.status?.lastPushAt ?? "none recorded")")
                                .font(.callout)
                            Text("The bridge does not record push/pull timestamps yet — successful batches are removed from the queue on delivery.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    .padding(4)
                }

                if let err = vm.errorText {
                    Label(err, systemImage: "exclamationmark.triangle")
                        .font(.callout)
                        .foregroundStyle(LariatTheme.bad)
                }

                if let quiet = vm.quietStateMessage {
                    EmptyState(message: quiet, systemImage: "icloud.slash")
                }

                if let status = vm.status, status.deadLetterTotal > 0 {
                    Label(
                        "\(status.deadLetterTotal) stuck batch\(status.deadLetterTotal == 1 ? "" : "es") need\(status.deadLetterTotal == 1 ? "s" : "") triage — inspect, requeue, or drop from the web cockpit at /management/cloud-bridge.",
                        systemImage: "wrench.and.screwdriver"
                    )
                    .font(.callout)
                    .foregroundStyle(.secondary)
                }
            }
            .padding()
        }
    }
}

// MARK: - Status card

private struct StatusCard: View {
    let label: String
    let value: String
    let valueColor: Color
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(.title3, design: .rounded))
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(valueColor)
            Text(detail)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Feature registration (A0 self-registration)

extension FeatureModule {
    /// A5.4 option B — read-only cloud-bridge sync health. Registered from the
    /// feature's own file (self-registration pattern); reads only the read-only
    /// database, so there is no write-DB degrade path.
    static let managerCloudBridge = FeatureModule(id: "manager.cloudBridge") { ctx in
        AnyView(CloudBridgeStatusView(database: ctx.database))
    }
}
