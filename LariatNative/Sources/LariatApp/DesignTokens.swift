import SwiftUI
import LariatModel

/// Semantic status palette for LariatNative boards (endgame H1).
/// One canonical mapping replaces per-view hard-coded colors — new ports must
/// use these tokens; existing views adopt them as they are touched.
enum LariatTheme {
    /// House amber — the single source for the tone previously duplicated
    /// as an inline RGB tuple in TodayView and StationsListView.
    static let amber = Color(red: 0.89, green: 0.69, blue: 0.29)

    static let ok = Color.green
    static let warn = amber
    static let bad = Color.red
    static let muted = Color.secondary

    /// Shared station-progress tone mapping (was copy-pasted per view).
    static func color(for tone: StationProgressLabels.Tone) -> Color {
        switch tone {
        case .muted: return muted
        case .red: return bad
        case .green: return ok
        case .amber: return warn
        }
    }
}
