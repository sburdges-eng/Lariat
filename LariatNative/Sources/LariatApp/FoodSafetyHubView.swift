import SwiftUI

/// Generic safety hub: renders one button per safety-tier feature (except itself),
/// driven by `FeatureRegistry`. A new safety screen appears here automatically once
/// it is registered — no edits to this view.
struct FoodSafetyHubView: View {
    let context: AppContext

    /// Per-feature SF Symbol, keyed by feature id. Falls back to a generic icon.
    private static let icons: [String: String] = [
        "safety.tempLog": "thermometer.medium",
        "safety.cooling": "thermometer.snowflake",
        "safety.dateMarks": "calendar",
        "safety.calibrations": "gauge.with.dots.needle.33percent",
        "safety.cleaning": "sparkles",
        "safety.breaks": "figure.walk",
        "safety.sanitizer": "drop",
        "safety.tphc": "timer",
        "safety.pest": "ant",
        "safety.sds": "doc.text.magnifyingglass",
        "safety.sickWorker": "cross.case",
        "safety.receiving": "shippingbox",
        "safety.haccpPlan": "checklist",
        "safety.allergenLookup": "allergens",
    ]

    /// Section assignment, keyed by feature id, preserving the original grouping.
    private static let laborAndCleaning: Set<String> = ["safety.cleaning", "safety.breaks"]

    private var todayModules: [FeatureModule] {
        FeatureRegistry.modules(for: .safety).filter {
            $0.id != "safety.hub" && !Self.laborAndCleaning.contains($0.id)
        }
    }

    private var laborModules: [FeatureModule] {
        FeatureRegistry.modules(for: .safety).filter { Self.laborAndCleaning.contains($0.id) }
    }

    var body: some View {
        List {
            Section("Today") {
                ForEach(todayModules) { module in
                    button(for: module)
                }
            }
            Section("Labor & cleaning") {
                ForEach(laborModules) { module in
                    button(for: module)
                }
            }
        }
        .navigationTitle("Food Safety")
    }

    private func button(for module: FeatureModule) -> some View {
        Button {
            context.navigate(module.id)
        } label: {
            Label(module.title, systemImage: Self.icons[module.id] ?? "square.grid.2x2")
        }
        .accessibilityHint("Opens the \(module.title) board")
    }
}
