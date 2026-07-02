import SwiftUI
import LariatModel

/// Pure ranking logic for the ⌘K palette (endgame H3). Case-insensitive match
/// over feature title + tier name, ranked: title prefix, then title contains,
/// then tier prefix/contains, then title subsequence. Ties keep catalog order.
///
/// NOTE: `LariatApp` is an executable target with no test target (adding one
/// would require a `Package.swift` edit, which is out of scope for the shell
/// wave), so this ranker is deliberately tiny, dependency-free, and exercised
/// manually. If a `LariatAppTests` target ever lands, port these cases first:
///   - empty/whitespace query → all candidates in catalog order
///   - "co" ranks "Cooling"/"Counts" (title prefix) above "Pest control" (contains)
///   - "safety" matches every Safety-tier board via tier name
///   - "tmplg" matches "Temp log" via subsequence; "zzz" matches nothing
enum PaletteRanker {
    /// Filter + rank `candidates` for `query`. Empty query returns all
    /// candidates unchanged (catalog order is already the sidebar order).
    static func matches(
        query: String,
        in candidates: [FeatureDescriptor]
    ) -> [FeatureDescriptor] {
        let needle = query
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        guard !needle.isEmpty else { return candidates }

        return candidates
            .compactMap { descriptor -> (score: Int, descriptor: FeatureDescriptor)? in
                guard let score = score(needle: needle, descriptor: descriptor) else {
                    return nil
                }
                return (score, descriptor)
            }
            .enumerated()
            .sorted { lhs, rhs in
                if lhs.element.score != rhs.element.score {
                    return lhs.element.score < rhs.element.score
                }
                return lhs.offset < rhs.offset // stable: keep catalog order on ties
            }
            .map(\.element.descriptor)
    }

    /// Lower score ranks first; `nil` means no match.
    private static func score(needle: String, descriptor: FeatureDescriptor) -> Int? {
        let title = descriptor.title.lowercased()
        let tier = descriptor.tier.rawValue.lowercased()
        if title.hasPrefix(needle) { return 0 }
        if title.contains(needle) { return 1 }
        if tier.hasPrefix(needle) { return 2 }
        if tier.contains(needle) { return 3 }
        if isSubsequence(needle, of: title) { return 4 }
        return nil
    }

    /// True when every character of `needle` appears in `haystack` in order
    /// (e.g. "tmplg" ⊑ "temp log") — cheap fuzzy matching for typos of omission.
    private static func isSubsequence(_ needle: String, of haystack: String) -> Bool {
        var iterator = haystack.makeIterator()
        for character in needle {
            var found = false
            while let candidate = iterator.next() {
                if candidate == character {
                    found = true
                    break
                }
            }
            if !found { return false }
        }
        return true
    }
}

/// ⌘K command palette (endgame H3): a query field over every *enabled*
/// feature in `FeatureCatalog` — enumerated dynamically, so boards added by
/// other waves appear with no palette changes. Selecting a row routes through
/// the same `selectedId` state the sidebar uses.
///
/// Keyboard: ↑/↓ move the highlight, Return opens, Esc dismisses.
struct CommandPaletteView: View {
    /// Navigate to a feature id (the shell sets its sidebar selection).
    let onSelect: (String) -> Void
    /// Close the palette without navigating.
    let onDismiss: () -> Void

    @State private var query = ""
    @State private var highlighted = 0
    @FocusState private var queryFocused: Bool

    /// Disabled ("Soon") features are not selectable in the sidebar, so the
    /// palette skips them too — jumping to a stub would strand the user.
    private var results: [FeatureDescriptor] {
        PaletteRanker.matches(query: query, in: FeatureCatalog.all.filter(\.enabled))
    }

    var body: some View {
        VStack(spacing: 0) {
            queryField
            Divider()
            resultsList
        }
        #if os(macOS)
        .frame(width: 480, height: 360)
        #endif
        .onAppear { queryFocused = true }
    }

    private var queryField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(LariatTheme.muted)
            TextField("Jump to board…", text: $query)
                .textFieldStyle(.plain)
                .focused($queryFocused)
                .onSubmit(openHighlighted)
                .onKeyPress(.upArrow) {
                    moveHighlight(by: -1)
                    return .handled
                }
                .onKeyPress(.downArrow) {
                    moveHighlight(by: 1)
                    return .handled
                }
                .onKeyPress(.escape) {
                    onDismiss()
                    return .handled
                }
        }
        .font(.title3)
        .padding(12)
        .onChange(of: query) { highlighted = 0 }
    }

    private var resultsList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    if results.isEmpty {
                        EmptyState(
                            message: "No boards match \u{201C}\(query)\u{201D}",
                            systemImage: "magnifyingglass"
                        )
                        .padding(.horizontal, 12)
                    } else {
                        ForEach(Array(results.enumerated()), id: \.element.id) { index, descriptor in
                            row(descriptor, isHighlighted: index == highlighted)
                                .id(descriptor.id)
                                .onTapGesture { onSelect(descriptor.id) }
                        }
                    }
                }
                .padding(.vertical, 4)
            }
            .onChange(of: highlighted) {
                guard results.indices.contains(highlighted) else { return }
                proxy.scrollTo(results[highlighted].id, anchor: nil)
            }
        }
    }

    private func row(_ descriptor: FeatureDescriptor, isHighlighted: Bool) -> some View {
        HStack {
            Text(descriptor.title)
            Spacer()
            Text(descriptor.tier.rawValue)
                .font(.caption)
                .foregroundStyle(LariatTheme.muted)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .contentShape(Rectangle())
        .background(
            isHighlighted ? LariatTheme.amber.opacity(0.25) : Color.clear,
            in: RoundedRectangle(cornerRadius: 6)
        )
        .padding(.horizontal, 4)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isHighlighted ? [.isSelected] : [])
    }

    private func moveHighlight(by delta: Int) {
        guard !results.isEmpty else { return }
        highlighted = min(max(highlighted + delta, 0), results.count - 1)
    }

    private func openHighlighted() {
        guard results.indices.contains(highlighted) else { return }
        onSelect(results[highlighted].id)
    }
}
