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
        VStack(spacing: 12) {
            Image(systemName: "lock.fill").font(.largeTitle).foregroundStyle(.secondary)
            Text("\(title) requires a manager PIN").font(.headline)
            switch state {
            case .unavailable(let reason):
                Text(reason).font(.callout).foregroundStyle(.secondary)
            case .locked, .open:
                Text("This board is PIN-protected (parity with the web app).")
                    .font(.callout).foregroundStyle(.secondary)
                Button("Unlock") { onUnlock() }.buttonStyle(.borderedProminent)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
        .accessibilityElement(children: .combine)
    }
}
