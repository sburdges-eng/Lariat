import Foundation

/// Per-station line-check progress — mirrors `lib/stationProgress.js` return shape.
public struct StationProgress: Equatable, Sendable {
    public let total: Int
    public let done: Int
    public let flagged: Int
    public let signedOff: Bool

    public init(total: Int, done: Int, flagged: Int, signedOff: Bool) {
        self.total = total
        self.done = done
        self.flagged = flagged
        self.signedOff = signedOff
    }
}

/// Latest line-check row per template item (repository supplies grouped rows).
public struct LineCheckItemStatus: Equatable, Sendable {
    public let item: String
    public let status: String

    public init(item: String, status: String) {
        self.item = item
        self.status = status
    }
}

public struct StationWithProgress: Equatable, Sendable {
    public let station: KitchenStation
    public let progress: StationProgress?

    public init(station: KitchenStation, progress: StationProgress?) {
        self.station = station
        self.progress = progress
    }
}

public enum StationProgressCompute {
    /// Pure port of `stationProgress(station, date, locationId)` after DB rows are fetched.
    public static func progress(
        templateItems: [String],
        entries: [LineCheckItemStatus],
        signedOff: Bool
    ) -> StationProgress? {
        guard !templateItems.isEmpty else { return nil }
        let byItem = Dictionary(entries.map { ($0.item, $0) }, uniquingKeysWith: { _, last in last })
        var done = 0
        var flagged = 0
        for item in templateItems {
            if let row = byItem[item] {
                done += 1
                if row.status == "fail" { flagged += 1 }
            }
        }
        return StationProgress(total: templateItems.count, done: done, flagged: flagged, signedOff: signedOff)
    }

    /// Mirrors `lib/lineSummary.ts` `activeLineCheckStations`.
    public static func activeLineCheckStations(_ stations: [StationWithProgress]) -> [StationWithProgress] {
        stations.filter { $0.progress != nil }
    }

    /// Hero stat: stations that are ready (signed off or all items done).
    public static func readyCount(_ stations: [StationWithProgress]) -> Int {
        activeLineCheckStations(stations).filter { station in
            guard let p = station.progress else { return false }
            return p.signedOff || p.done >= p.total
        }.count
    }

    public static func flaggedCount(_ stations: [StationWithProgress]) -> Int {
        activeLineCheckStations(stations).reduce(0) { sum, station in
            sum + (station.progress?.flagged ?? 0)
        }
    }
}

public enum StationProgressLabels {
    public enum Tone: Sendable {
        case muted, red, green, amber
    }

    /// Mirrors `stationTone()` in `app/v2/today/page.jsx`.
    public static func tone(for progress: StationProgress?) -> Tone {
        guard let progress else { return .muted }
        if progress.flagged > 0 { return .red }
        if progress.signedOff || progress.done >= progress.total { return .green }
        if progress.done > 0 { return .amber }
        return .red
    }

    /// Short kitchen copy from `lib/i18n/messages/en.ts` `today.station.*`.
    public static func label(for progress: StationProgress?) -> String {
        guard let progress else { return "No line check" }
        if progress.flagged > 0 {
            return progress.flagged == 1 ? "1 flagged" : "\(progress.flagged) flagged"
        }
        if progress.signedOff { return "Signed off" }
        if progress.done >= progress.total { return "Ready" }
        if progress.done > 0 { return "\(progress.done) of \(progress.total)" }
        return "Open line"
    }
}
