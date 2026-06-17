import SwiftUI

struct FoodSafetyHubView: View {
    var onOpenTempLog: () -> Void
    var onOpenDateMarks: () -> Void
    var onOpenCalibrations: () -> Void

    var body: some View {
        List {
            Section("Today") {
                Button(action: onOpenTempLog) {
                    Label("Temp log", systemImage: "thermometer.medium")
                }
                Button(action: onOpenDateMarks) {
                    Label("Date marks", systemImage: "calendar")
                }
                Button(action: onOpenCalibrations) {
                    Label("Calibrations", systemImage: "gauge.with.dots.needle.33percent")
                }
            }
            Section("Coming soon") {
                Label("Cleaning", systemImage: "sparkles")
                    .foregroundStyle(.tertiary)
                Label("Breaks", systemImage: "figure.walk")
                    .foregroundStyle(.tertiary)
            }
        }
        .navigationTitle("Food Safety")
    }
}
