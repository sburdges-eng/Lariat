import SwiftUI

struct FoodSafetyHubView: View {
    var onOpenTempLog: () -> Void
    var onOpenDateMarks: () -> Void
    var onOpenCalibrations: () -> Void
    var onOpenCleaning: () -> Void
    var onOpenBreaks: () -> Void

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
            Section("Labor & cleaning") {
                Button(action: onOpenCleaning) {
                    Label("Cleaning", systemImage: "sparkles")
                }
                Button(action: onOpenBreaks) {
                    Label("Breaks", systemImage: "figure.walk")
                }
            }
        }
        .navigationTitle("Food Safety")
    }
}
