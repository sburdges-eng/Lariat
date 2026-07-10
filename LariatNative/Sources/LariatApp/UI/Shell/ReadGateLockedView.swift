import SwiftUI
import LariatModel

/// Shared locked state for manager-tier read boards gated by `RegulatedReadGate`
/// (Phase C1 verify-41 fix). Shown when a PIN is configured but no manager
/// session is active — the board must not render/fetch the protected data.
/// Mirrors the private `ShowsLockedView`/`MorningLockedView`, factored out so the
/// HR, host, and costing boards share one presentation.
struct ReadGateLockedView: View {
    let title: String
    let state: RegulatedReadGateState
    let onUnlock: () -> Void

    var body: some View {
        VStack(spacing: LaRiOS.Spacing.six) {
            Image(systemName: "lock.fill")
                .font(LaRiOS.Typography.titleMedium)
                .foregroundStyle(LaRiOS.Colors.accent)
            Text("\(title) needs manager PIN")
                .font(LaRiOS.Typography.titleSmall)
                .foregroundStyle(LaRiOS.Colors.text)
            switch state {
            case .unavailable(let reason):
                Text(reason)
                    .font(LaRiOS.Typography.small)
                    .foregroundStyle(LaRiOS.Colors.textMuted)
            case .locked, .open:
                Text("Manager-only board.")
                    .font(LaRiOS.Typography.small)
                    .foregroundStyle(LaRiOS.Colors.textMuted)
                Button("Unlock") { onUnlock() }
                    .buttonStyle(.larios(.primary))
            }
        }
        .padding(LaRiOS.Spacing.twelve)
        .frame(maxWidth: 420)
        .lariosPanel(fill: LaRiOS.Colors.panelRaised)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(LaRiOS.Colors.background)
        .accessibilityElement(children: .combine)
    }
}
