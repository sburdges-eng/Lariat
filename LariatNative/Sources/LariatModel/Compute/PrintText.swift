import Foundation

/// Shared plain-text helpers for the native print renderers (settlement, order
/// guide, prep par, par, BEO). Kept pure — no clock, no I/O.
public enum PrintText {
    /// Pads `s` to at least `width` characters, then always appends exactly ONE
    /// separator space — so the next column starts at a consistent offset whether
    /// `s` under-fills, exactly fills, or overflows `width`. (Overflow still shifts,
    /// unavoidably, since the value is wider than its column.)
    public static func pad(_ s: String, _ width: Int) -> String {
        s + String(repeating: " ", count: max(width - s.count, 0) + 1)
    }
}
