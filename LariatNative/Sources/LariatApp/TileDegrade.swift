import SwiftUI

/// A reusable view that renders a degraded / unavailable state for a tile or screen.
/// Wraps `ContentUnavailableView` so callers don't need to spell out the label+description
/// composition every time. Designed to be drop-in for per-tile degradation (Task 11) as well
/// as screen-level DB-unavailable states (Task 2).
struct TileDegrade: View {
    /// Short, human-readable title (e.g. "Database unavailable").
    let title: String
    /// Optional longer explanation shown as secondary text below the title.
    var message: String?
    /// SF Symbol name for the icon (default: "exclamationmark.triangle").
    var systemImage: String = "exclamationmark.triangle"

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: systemImage)
        } description: {
            if let message {
                Text(message)
            }
        }
    }
}
