import Foundation

// SPL telemetry pure rules — value-parity port of `lib/splTelemetry.ts`.
// The sound engineer logs dB readings during a show; the UI renders a
// sparkline and threshold strip. No I/O; degenerate inputs never throw.

public enum SplStatus: String, Sendable, Equatable {
    case green, amber, red, unset
}

/// Rollup of a chronologically-ordered reading batch — mirrors `SplSummary`.
public struct SplSummary: Sendable, Equatable {
    public let count: Int
    public let latest: Double?
    public let peak: Double?
    public let avgLastN: Double?
    public let overLimitCount: Int
    public let since: String?          // taken_at of the oldest reading
    public let limitDb: Double?

    public init(
        count: Int, latest: Double?, peak: Double?, avgLastN: Double?,
        overLimitCount: Int, since: String?, limitDb: Double?
    ) {
        self.count = count
        self.latest = latest
        self.peak = peak
        self.avgLastN = avgLastN
        self.overLimitCount = overLimitCount
        self.since = since
        self.limitDb = limitDb
    }
}

public struct SparklineOpts: Sendable {
    public var width: Double?
    public var height: Double?
    public var padding: Double?
    public var yMin: Double?
    public var yMax: Double?

    public init(
        width: Double? = nil, height: Double? = nil, padding: Double? = nil,
        yMin: Double? = nil, yMax: Double? = nil
    ) {
        self.width = width
        self.height = height
        self.padding = padding
        self.yMin = yMin
        self.yMax = yMax
    }
}

/// SVG-path sparkline math — mirrors `SparklineResult`.
public struct SparklineResult: Sendable, Equatable {
    public let d: String
    public let viewBox: String
    public let width: Double
    public let height: Double
    public let peakIdx: Int            // -1 when empty
    public let thresholdY: Double?
    public let yMin: Double
    public let yMax: Double

    public init(
        d: String, viewBox: String, width: Double, height: Double,
        peakIdx: Int, thresholdY: Double?, yMin: Double, yMax: Double
    ) {
        self.d = d
        self.viewBox = viewBox
        self.width = width
        self.height = height
        self.peakIdx = peakIdx
        self.thresholdY = thresholdY
        self.yMin = yMin
        self.yMax = yMax
    }
}

public enum SplTelemetryCompute {
    /// Roll up readings into one summary. `limit` is the scene's
    /// spl_limit_db; nil/invalid → overLimitCount 0.
    public static func summarizeSpl(
        _ readings: [SplReadingRow]?,
        limit: Double?
    ) -> SplSummary {
        let slice = readings ?? []
        let lim = isFinitePositive(limit) ? limit : nil

        guard !slice.isEmpty else {
            return SplSummary(
                count: 0, latest: nil, peak: nil, avgLastN: nil,
                overLimitCount: 0, since: nil, limitDb: lim
            )
        }

        var peak = -Double.infinity
        var sum = 0.0
        var over = 0
        for r in slice {
            let v = r.dbValue
            if v > peak { peak = v }
            sum += v
            if let lim, v > lim { over += 1 }
        }

        return SplSummary(
            count: slice.count,
            latest: slice.last!.dbValue,
            peak: peak,
            avgLastN: round1(sum / Double(slice.count)),
            overLimitCount: over,
            since: slice.first!.takenAt,
            limitDb: lim
        )
    }

    /// Build an SVG path string for `readings`. Y-axis floors to explicit
    /// yMin/yMax options; otherwise scales to data with a 2 dB pad; all-equal
    /// data synthesizes a 4 dB window. `thresholdY` is set when the limit
    /// falls inside the y-range.
    public static func sparklinePath(
        _ readings: [SplReadingRow]?,
        limit: Double?,
        opts: SparklineOpts = SparklineOpts()
    ) -> SparklineResult {
        let width = isFinitePositive(opts.width) ? opts.width! : 160
        let height = isFinitePositive(opts.height) ? opts.height! : 40
        let pad = max(0, opts.padding ?? 2)
        let slice = readings ?? []

        guard !slice.isEmpty else {
            return SparklineResult(
                d: "", viewBox: "0 0 \(jsNum(width)) \(jsNum(height))",
                width: width, height: height, peakIdx: -1, thresholdY: nil,
                yMin: 0, yMax: 0
            )
        }

        let values = slice.map(\.dbValue)
        var yMin = (opts.yMin?.isFinite == true) ? opts.yMin! : values.min()! - 2
        var yMax = (opts.yMax?.isFinite == true) ? opts.yMax! : values.max()! + 2
        if yMax - yMin < 1 {
            // Degenerate (all equal) — synthesize a 4 dB window on the value.
            let center = (yMax + yMin) / 2
            yMin = center - 2
            yMax = center + 2
        }

        let innerW = max(1, width - pad * 2)
        let innerH = max(1, height - pad * 2)
        let range = yMax - yMin

        var peakIdx = 0
        var peakVal = -Double.infinity
        var d = ""
        for (i, v) in values.enumerated() {
            if v > peakVal {
                peakVal = v
                peakIdx = i
            }
            let x = slice.count == 1
                ? pad + innerW / 2
                : pad + (Double(i) / Double(slice.count - 1)) * innerW
            let y = pad + innerH - ((v - yMin) / range) * innerH
            d += "\(i == 0 ? "M" : "L")\(jsNum(round1(x))),\(jsNum(round1(y)))"
        }

        let lim = isFinitePositive(limit) ? limit : nil
        var thresholdY: Double?
        if let lim, lim >= yMin, lim <= yMax {
            thresholdY = round1(pad + innerH - ((lim - yMin) / range) * innerH)
        }

        return SparklineResult(
            d: d, viewBox: "0 0 \(jsNum(width)) \(jsNum(height))",
            width: width, height: height, peakIdx: peakIdx,
            thresholdY: thresholdY, yMin: yMin, yMax: yMax
        )
    }

    /// Threshold band for one reading: green <90% of limit, amber 90–100%,
    /// red >100%; no/zero limit → green; non-finite value → unset.
    public static func splThresholdStatus(
        _ dbValue: Double?,
        limit: Double?
    ) -> SplStatus {
        guard let v = dbValue, v.isFinite else { return .unset }
        guard let lim = limit, lim.isFinite, lim > 0 else { return .green }
        if v > lim { return .red }
        if v >= lim * 0.9 { return .amber }
        return .green
    }

    // ── helpers ───────────────────────────────────────────────────────

    static func isFinitePositive(_ n: Double?) -> Bool {
        guard let n else { return false }
        return n.isFinite && n > 0
    }

    /// JS `Math.round(n * 10) / 10`.
    static func round1(_ n: Double) -> Double {
        ((n * 10) + 0.5).rounded(.down) / 10
    }

    /// JS number-in-template-literal formatting (no trailing `.0`).
    static func jsNum(_ n: Double) -> String {
        ShowStatusValue.jsNumberString(n)
    }
}
