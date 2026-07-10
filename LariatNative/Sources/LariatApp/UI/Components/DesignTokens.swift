import SwiftUI
import LariatModel

/// LaRiOS Service Ledger tokens for native boards.
///
/// The values mirror `public/design-atlas/larios/tokens/*`: warm dark ledger by
/// default, opt-in paper/night surfaces, compact pro-tool spacing, sharp radii,
/// and a display/body/mono type ramp mapped to system fonts until brand fonts
/// are bundled with the native app.
enum LaRiOS {
    enum Colors {
        // Service Ledger dark default.
        static let background = Color(hex: 0x1A1711)
        static let panel = Color(hex: 0x1D1B15)
        static let panelRaised = Color(hex: 0x26231B)
        static let hairline = Color(hex: 0x3A342A)
        static let text = Color(hex: 0xD4CBB5)
        static let textMuted = Color(hex: 0xB3A890)
        static let accent = Color(hex: 0xE0922B)
        static let onAccent = Color(hex: 0x1A1308)
        static let allergen = Color(hex: 0xFCA5A5)
        static let fire = Color(hex: 0xE05A3C)
        static let ok = Color(hex: 0x7AA07F)
        static let info = Color(hex: 0x6B90B4)
        static let metal = Color(hex: 0xC2912F)

        // Copper accent family used by books, BEO worksheets, and order guides.
        static let copper = Color(hex: 0xD97736)
        static let copperDeep = Color(hex: 0xA8501A)
        static let copperGlow = Color(hex: 0xE89A63)
        static let copperWash = Color(hex: 0xE9C4B8)

        enum Paper {
            static let background = Color(hex: 0xF1EAD9)
            static let panel = Color(hex: 0xF8F3E7)
            static let panelRaised = Color(hex: 0xE3D8C1)
            static let hairline = Color(hex: 0xCABD9F)
            static let text = Color(hex: 0x17140F)
            static let textMuted = Color(hex: 0x6F6555)
            static let accent = copperDeep
            static let fire = Color(hex: 0x9A3520)
            static let ok = Color(hex: 0x3F5648)
            static let info = Color(hex: 0x3A5A7A)
            static let metal = Color(hex: 0x7A5818)
            static let onAccent = Color(hex: 0xFFF8EC)
        }

        enum KDark {
            static let background = Color(hex: 0x0E0D0B)
            static let panel = Color(hex: 0x1A1815)
            static let panelRaised = Color(hex: 0x211E19)
            static let hairline = Color(hex: 0x3A3530)
            static let text = Color(hex: 0xECE2CF)
            static let textMuted = Color(hex: 0xA89E8A)
        }

        enum KNight {
            static let background = Color(hex: 0x0C0A14)
            static let panel = Color(hex: 0x15121F)
            static let panelRaised = Color(hex: 0x1D1828)
            static let hairline = Color(hex: 0x3A2F4F)
            static let text = Color(hex: 0xECE2CF)
            static let textMuted = Color(hex: 0x9C8FBF)
            static let accent = Color(hex: 0xF0A85A)
        }
    }

    enum Spacing {
        static let zero: CGFloat = 0
        static let one: CGFloat = 2
        static let two: CGFloat = 4
        static let three: CGFloat = 6
        static let four: CGFloat = 8
        static let five: CGFloat = 10
        static let six: CGFloat = 12
        static let seven: CGFloat = 14
        static let eight: CGFloat = 16
        static let ten: CGFloat = 20
        static let twelve: CGFloat = 24
        static let fourteen: CGFloat = 28
        static let sixteen: CGFloat = 32
        static let twenty: CGFloat = 40
    }

    enum Radius {
        static let small: CGFloat = 3
        static let base: CGFloat = 6
        static let large: CGFloat = 12
    }

    enum Control {
        static let height: CGFloat = 36
        static let largeHeight: CGFloat = 48
        static let tapMinimum: CGFloat = 44
    }

    enum Shell {
        static let stripHeight: CGFloat = 64
        static let commandHeight: CGFloat = 48
        static let railWidth: CGFloat = 64
        static let sidebarWidth: CGFloat = 244
        static let sidebarCompactWidth: CGFloat = 216
    }

    enum Typography {
        static let titleXL = Font.system(size: 56, weight: .bold, design: .rounded)
        static let titleLarge = Font.system(size: 36, weight: .bold, design: .rounded)
        static let titleMedium = Font.system(size: 24, weight: .semibold, design: .rounded)
        static let titleSmall = Font.system(size: 18, weight: .semibold, design: .rounded)

        static let body = Font.system(size: 14, weight: .regular, design: .default)
        static let bodyStrong = Font.system(size: 14, weight: .semibold, design: .default)
        static let small = Font.system(size: 13, weight: .regular, design: .default)
        static let smallStrong = Font.system(size: 13, weight: .semibold, design: .default)
        static let xsmall = Font.system(size: 11.5, weight: .regular, design: .default)
        static let eyebrow = Font.system(size: 9.5, weight: .bold, design: .monospaced)
        static let stamp = Font.system(size: 12, weight: .medium, design: .rounded)
        static let railGlyph = Font.system(size: 13, weight: .bold, design: .monospaced)
        static let railLabel = Font.system(size: 7.5, weight: .bold, design: .default)
        static let sidebarLabel = Font.system(size: 12.5, weight: .semibold, design: .default)
        static let numberLarge = Font.system(size: 30, weight: .semibold, design: .monospaced)
        static let number = Font.system(size: 18, weight: .semibold, design: .monospaced)
        static let numberSmall = Font.system(size: 13, weight: .regular, design: .monospaced)
        static let control = Font.system(size: 14, weight: .semibold, design: .default)
    }

    enum Motion {
        static let fast = 0.12
        static let base = 0.16
        static let slow = 0.30
    }
}

/// Semantic status palette for LariatNative boards (endgame H1).
/// Existing views keep using this compatibility layer; new UI should prefer
/// the richer `LaRiOS` namespace and reusable SwiftUI styles/components.
enum LariatTheme {
    static let background = LaRiOS.Colors.background
    static let panel = LaRiOS.Colors.panel
    static let panelRaised = LaRiOS.Colors.panelRaised
    static let hairline = LaRiOS.Colors.hairline
    static let text = LaRiOS.Colors.text
    static let textMuted = LaRiOS.Colors.textMuted
    static let amber = LaRiOS.Colors.accent

    static let ok = LaRiOS.Colors.ok
    static let warn = amber
    static let bad = LaRiOS.Colors.fire
    static let info = LaRiOS.Colors.info
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
    static let panel = Color(hex: 0xFCF8EF)        // lifted card / worksheet sheet
    static let paper = LaRiOS.Colors.Paper.panel   // brand cream canvas
    static let sunk = LaRiOS.Colors.Paper.panelRaised

    // Espresso ink.
    static let ink = Color(hex: 0x2B2621)           // primary text
    static let inkSoft = Color(hex: 0x7A6E60)       // secondary / labels
    static let inkFaint = Color(hex: 0xA99B87)      // placeholders / tertiary

    // Terracotta accent — actions, selection, the Total.
    static let terracotta = LaRiOS.Colors.copperGlow
    static let clay = LaRiOS.Colors.copperDeep      // deeper: accent text on cream
    static let rose = LaRiOS.Colors.copperWash      // soft wash: selected row

    static let line = Color(hex: 0xE0D5BE)          // warm hairline

    // Warm status (not the pure system trio).
    static let ok = Color(hex: 0x5E7D50)            // sage
    static let warn = terracotta
    static let bad = Color(hex: 0xB84A2E)           // brick
}
