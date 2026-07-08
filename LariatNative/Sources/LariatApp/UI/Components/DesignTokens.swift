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

extension Color {
    /// `Color(hex: 0xE8784A)` — opaque sRGB from a 24-bit hex literal.
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

/// The Lariat house palette — pulled straight from the web brand `:root`
/// (terracotta `#e8784a`, cream `#f8f3e7`, espresso `#1a1711`/`#3a3530`). A
/// Lariat BEO is a printed kraft-paper worksheet, so the board is rendered as
/// warm paper with espresso ink and a single terracotta accent, regardless of
/// system appearance. Reusable app-wide; adopted first by the BEO board.
enum LariatBrand {
    // Warm paper surfaces (light → deep).
    static let panel = Color(hex: 0xFCF8EF)   // lifted card / worksheet sheet
    static let paper = Color(hex: 0xF8F3E7)    // brand cream canvas
    static let sunk = Color(hex: 0xEFE6D2)     // inset wells (totals block)

    // Espresso ink.
    static let ink = Color(hex: 0x2B2621)      // primary text
    static let inkSoft = Color(hex: 0x7A6E60)  // secondary / labels
    static let inkFaint = Color(hex: 0xA99B87) // placeholders / tertiary

    // Terracotta accent — actions, selection, the Total.
    static let terracotta = Color(hex: 0xE8784A)
    static let clay = Color(hex: 0xC15327)     // deeper: accent text on cream
    static let rose = Color(hex: 0xE9C4B8)     // soft wash: selected row

    static let line = Color(hex: 0xE0D5BE)     // warm hairline

    // Warm status (not the pure system trio).
    static let ok = Color(hex: 0x5E7D50)       // sage
    static let warn = terracotta
    static let bad = Color(hex: 0xB84A2E)      // brick
}
