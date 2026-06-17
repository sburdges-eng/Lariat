import SwiftUI

struct FoodSafetyHubView: View {
    var onOpenTempLog: () -> Void

    var body: some View {
        List {
            Section("Today") {
                Button(action: onOpenTempLog) {
                    Label("Temp log", systemImage: "thermometer.medium")
                }
            }
            Section("Coming soon") {
                Label("Date marks", systemImage: "calendar")
                    .foregroundStyle(.tertiary)
                Label("Calibrations", systemImage: "gauge.with.dots.needle.33percent")
                    .foregroundStyle(.tertiary)
                Label("Cleaning", systemImage: "sparkles")
                    .foregroundStyle(.tertiary)
                Label("Breaks", systemImage: "figure.walk")
                    .foregroundStyle(.tertiary)
            }
        }
        .navigationTitle("Food Safety")
    }
}
