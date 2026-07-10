import SwiftUI

enum LaRiOSTone: Equatable {
    case neutral
    case accent
    case ok
    case warn
    case bad
    case info
    case muted

    var color: Color {
        switch self {
        case .neutral: return LaRiOS.Colors.textMuted
        case .accent: return LaRiOS.Colors.accent
        case .ok: return LaRiOS.Colors.ok
        case .warn: return LaRiOS.Colors.metal
        case .bad: return LaRiOS.Colors.fire
        case .info: return LaRiOS.Colors.info
        case .muted: return LaRiOS.Colors.textMuted
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .neutral: return "no signal"
        case .accent: return "active"
        case .ok: return "ok"
        case .warn: return "watch"
        case .bad: return "needs attention"
        case .info: return "information"
        case .muted: return "muted"
        }
    }
}

enum LaRiOSButtonRole {
    case primary
    case secondary
    case ghost
    case danger
}

struct LaRiOSButtonStyle: ButtonStyle {
    let role: LaRiOSButtonRole

    @Environment(\.isEnabled) private var isEnabled

    init(role: LaRiOSButtonRole = .secondary) {
        self.role = role
    }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(LaRiOS.Typography.control)
            .foregroundStyle(foreground)
            .padding(.horizontal, LaRiOS.Spacing.eight)
            .frame(minHeight: LaRiOS.Control.height)
            .background(background(for: configuration), in: RoundedRectangle(cornerRadius: LaRiOS.Radius.base))
            .overlay {
                RoundedRectangle(cornerRadius: LaRiOS.Radius.base)
                    .stroke(border, lineWidth: 1)
            }
            .contentShape(RoundedRectangle(cornerRadius: LaRiOS.Radius.base))
            .opacity(isEnabled ? 1 : 0.48)
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(.easeOut(duration: LaRiOS.Motion.fast), value: configuration.isPressed)
    }

    private var foreground: Color {
        switch role {
        case .primary:
            return LaRiOS.Colors.onAccent
        case .secondary, .ghost:
            return LaRiOS.Colors.text
        case .danger:
            return LaRiOS.Colors.fire
        }
    }

    private var border: Color {
        switch role {
        case .primary:
            return LaRiOS.Colors.accent
        case .secondary:
            return LaRiOS.Colors.hairline
        case .ghost:
            return LaRiOS.Colors.hairline.opacity(0.55)
        case .danger:
            return LaRiOS.Colors.fire.opacity(0.75)
        }
    }

    private func background(for configuration: Configuration) -> Color {
        let pressedLift = configuration.isPressed ? 0.78 : 1
        switch role {
        case .primary:
            return LaRiOS.Colors.accent.opacity(pressedLift)
        case .secondary:
            return LaRiOS.Colors.panelRaised.opacity(configuration.isPressed ? 0.78 : 1)
        case .ghost:
            return LaRiOS.Colors.panel.opacity(configuration.isPressed ? 0.72 : 0.18)
        case .danger:
            return LaRiOS.Colors.fire.opacity(configuration.isPressed ? 0.22 : 0.14)
        }
    }
}

extension ButtonStyle where Self == LaRiOSButtonStyle {
    static func larios(_ role: LaRiOSButtonRole = .secondary) -> LaRiOSButtonStyle {
        LaRiOSButtonStyle(role: role)
    }
}

struct LaRiOSPanelModifier: ViewModifier {
    var padding: CGFloat = LaRiOS.Spacing.eight
    var fill: Color = LaRiOS.Colors.panel
    var stroke: Color = LaRiOS.Colors.hairline

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(fill, in: RoundedRectangle(cornerRadius: LaRiOS.Radius.large))
            .overlay {
                RoundedRectangle(cornerRadius: LaRiOS.Radius.large)
                    .stroke(stroke, lineWidth: 1)
            }
    }
}

extension View {
    func lariosPanel(
        padding: CGFloat = LaRiOS.Spacing.eight,
        fill: Color = LaRiOS.Colors.panel,
        stroke: Color = LaRiOS.Colors.hairline
    ) -> some View {
        modifier(LaRiOSPanelModifier(padding: padding, fill: fill, stroke: stroke))
    }

    func lariosLedgerRow() -> some View {
        padding(.vertical, LaRiOS.Spacing.three)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(LaRiOS.Colors.hairline)
                    .frame(height: 1)
            }
    }
}

struct LaRiOSBoardHeader<Accessory: View>: View {
    let eyebrow: String?
    let title: String
    let subtitle: String?
    let accessory: Accessory

    init(
        eyebrow: String? = nil,
        title: String,
        subtitle: String? = nil,
        @ViewBuilder accessory: () -> Accessory
    ) {
        self.eyebrow = eyebrow
        self.title = title
        self.subtitle = subtitle
        self.accessory = accessory()
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: LaRiOS.Spacing.eight) {
            VStack(alignment: .leading, spacing: LaRiOS.Spacing.three) {
                if let eyebrow {
                    Text(eyebrow.uppercased())
                        .font(LaRiOS.Typography.eyebrow)
                        .foregroundStyle(LaRiOS.Colors.textMuted)
                }
                Text(title)
                    .font(LaRiOS.Typography.titleLarge)
                    .foregroundStyle(.primary)
                if let subtitle {
                    Text(subtitle)
                        .font(LaRiOS.Typography.small)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: LaRiOS.Spacing.eight)
            accessory
        }
        .accessibilityElement(children: .contain)
    }
}

extension LaRiOSBoardHeader where Accessory == EmptyView {
    init(eyebrow: String? = nil, title: String, subtitle: String? = nil) {
        self.init(eyebrow: eyebrow, title: title, subtitle: subtitle) {
            EmptyView()
        }
    }
}

struct LaRiOSSectionHeader: View {
    let title: String
    var subtitle: String?
    var tone: LaRiOSTone = .accent

    var body: some View {
        VStack(alignment: .leading, spacing: LaRiOS.Spacing.one) {
            HStack(spacing: LaRiOS.Spacing.three) {
                Rectangle()
                    .fill(tone.color)
                    .frame(width: 14, height: 2)
                Text(title)
                    .font(LaRiOS.Typography.stamp)
                    .foregroundStyle(.primary)
            }
            if let subtitle {
                Text(subtitle)
                    .font(LaRiOS.Typography.xsmall)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

struct LaRiOSStatusDot: View {
    var tone: LaRiOSTone
    var size: CGFloat = 8

    var body: some View {
        Circle()
            .fill(tone.color)
            .frame(width: size, height: size)
            .accessibilityLabel(tone.accessibilityLabel)
    }
}

struct LaRiOSMetricCard: View {
    let title: String
    let value: String
    var caption: String?
    var tone: LaRiOSTone = .neutral
    var titlePrefix: String?
    var systemImage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: LaRiOS.Spacing.three) {
            HStack(spacing: LaRiOS.Spacing.three) {
                LaRiOSStatusDot(tone: tone)
                if let titlePrefix {
                    Text(titlePrefix.uppercased())
                        .font(LaRiOS.Typography.eyebrow)
                        .foregroundStyle(LaRiOS.Colors.textMuted)
                }
                Text(title)
                    .font(LaRiOS.Typography.smallStrong)
                    .foregroundStyle(LaRiOS.Colors.textMuted)
                    .lineLimit(2)
                Spacer(minLength: LaRiOS.Spacing.two)
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(LaRiOS.Typography.xsmall)
                        .foregroundStyle(tone.color)
                }
            }
            Text(value)
                .font(LaRiOS.Typography.numberLarge)
                .foregroundStyle(LaRiOS.Colors.text)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.78)
            if let caption {
                Text(caption)
                    .font(LaRiOS.Typography.xsmall)
                    .foregroundStyle(LaRiOS.Colors.textMuted)
                    .lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(LaRiOS.Spacing.six)
        .background(cardFill, in: RoundedRectangle(cornerRadius: LaRiOS.Radius.base))
        .overlay {
            RoundedRectangle(cornerRadius: LaRiOS.Radius.base)
                .stroke(tone == .neutral ? LaRiOS.Colors.hairline : tone.color.opacity(0.65), lineWidth: 1)
        }
        .accessibilityElement(children: .combine)
    }

    private var cardFill: Color {
        switch tone {
        case .neutral, .muted:
            return LaRiOS.Colors.panelRaised
        case .accent, .ok, .warn, .bad, .info:
            return LaRiOS.Colors.panelRaised.opacity(0.94)
        }
    }
}

struct LaRiOSLoadingView: View {
    let message: String

    var body: some View {
        VStack(spacing: LaRiOS.Spacing.six) {
            ProgressView()
                .tint(LaRiOS.Colors.accent)
                .controlSize(.large)
            Text(message)
                .font(LaRiOS.Typography.smallStrong)
                .foregroundStyle(LaRiOS.Colors.textMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(LaRiOS.Colors.background)
        .accessibilityElement(children: .combine)
    }
}

struct LaRiOSInlineBanner: View {
    let message: String
    var tone: LaRiOSTone = .warn
    var systemImage: String = "exclamationmark.triangle.fill"

    var body: some View {
        HStack(spacing: LaRiOS.Spacing.four) {
            Image(systemName: systemImage)
                .font(LaRiOS.Typography.smallStrong)
                .foregroundStyle(tone.color)
            Text(message)
                .font(LaRiOS.Typography.small)
                .foregroundStyle(LaRiOS.Colors.text)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, LaRiOS.Spacing.six)
        .padding(.vertical, LaRiOS.Spacing.four)
        .background(tone.color.opacity(0.12), in: RoundedRectangle(cornerRadius: LaRiOS.Radius.base))
        .overlay {
            RoundedRectangle(cornerRadius: LaRiOS.Radius.base)
                .stroke(tone.color.opacity(0.48), lineWidth: 1)
        }
        .accessibilityElement(children: .combine)
    }
}

struct LaRiOSChip: View {
    let text: String
    var tone: LaRiOSTone = .neutral

    var body: some View {
        HStack(spacing: LaRiOS.Spacing.two) {
            LaRiOSStatusDot(tone: tone, size: 6)
            Text(text)
                .font(LaRiOS.Typography.xsmall)
                .foregroundStyle(LaRiOS.Colors.text)
                .lineLimit(1)
        }
        .padding(.horizontal, LaRiOS.Spacing.four)
        .padding(.vertical, LaRiOS.Spacing.two)
        .background(tone.color.opacity(0.12), in: Capsule())
        .overlay {
            Capsule().stroke(tone.color.opacity(0.48), lineWidth: 1)
        }
        .accessibilityElement(children: .combine)
    }
}

extension View {
    func lariosInputChrome() -> some View {
        padding(.horizontal, LaRiOS.Spacing.six)
            .frame(minHeight: LaRiOS.Control.height)
            .background(LaRiOS.Colors.panelRaised, in: RoundedRectangle(cornerRadius: LaRiOS.Radius.base))
            .overlay {
                RoundedRectangle(cornerRadius: LaRiOS.Radius.base)
                    .stroke(LaRiOS.Colors.hairline, lineWidth: 1)
            }
    }
}
