import Foundation

// Port of the parts of `lib/tempLog.ts` that `commandCenter.ts` summarize()
// depends on: the TempPoints registry and `classifyReadings(..., {expectAllPoints:false})`
// reduced to the single number summarize() takes from it — the count of
// point-summaries whose tile status is 'red'.
//
// PARITY NOTE (load-bearing): classifyReadings buckets rows by point_id and
// SKIPS any row whose point_id is not in the TempPoints registry. It also
// grades each reading against the REGISTRY point's min/max — NOT the
// required_min_f/required_max_f columns on the row. A fixture row with an
// unknown point_id (e.g. 'WALK-IN-COOLER' vs the registry id 'walk_in_cooler')
// is therefore dropped entirely and contributes 0 breaches.

/// A temp point from the registry. Only the fields summarize's breach count
/// needs (id + bounds). Mirrors `TempPoint` in lib/tempLog.ts.
struct TempPoint {
    let id: String
    let requiredMinF: Double?
    let requiredMaxF: Double?
}

enum TempLogCompute {
    /// The CCP temp points cooks log against. Mirrors `TempPoints` in
    /// lib/tempLog.ts (id + bounds only — the rest is UI metadata unused here).
    static let points: [TempPoint] = [
        TempPoint(id: "receiving_cold", requiredMinF: nil, requiredMaxF: 41),
        TempPoint(id: "receiving_frozen", requiredMinF: nil, requiredMaxF: 10),
        TempPoint(id: "walk_in_cooler", requiredMinF: nil, requiredMaxF: 41),
        TempPoint(id: "reach_in_cooler", requiredMinF: nil, requiredMaxF: 41),
        TempPoint(id: "freezer", requiredMinF: nil, requiredMaxF: 0),
        TempPoint(id: "cook_poultry", requiredMinF: 165, requiredMaxF: nil),
        TempPoint(id: "cook_ground_beef", requiredMinF: 155, requiredMaxF: nil),
        TempPoint(id: "cook_fish", requiredMinF: 145, requiredMaxF: nil),
        TempPoint(id: "cook_pork", requiredMinF: 145, requiredMaxF: nil),
        TempPoint(id: "cook_beef_steak", requiredMinF: 145, requiredMaxF: nil),
        TempPoint(id: "cook_eggs", requiredMinF: 155, requiredMaxF: nil),
        TempPoint(id: "hot_hold", requiredMinF: 140, requiredMaxF: nil),
        TempPoint(id: "reheat", requiredMinF: 165, requiredMaxF: nil),
    ]

    private static let byID: [String: TempPoint] =
        Dictionary(uniqueKeysWithValues: points.map { ($0.id, $0) })

    /// Absolute sanity range — outside is 'invalid' (probe broken). Mirrors
    /// ABSOLUTE_MIN_F / ABSOLUTE_MAX_F in lib/tempLog.ts.
    private static let absMinF = -100.0
    private static let absMaxF = 500.0

    private enum ReadingClass { case ok, outOfRange, invalid }

    private static func classifyReading(_ point: TempPoint, _ reading: Double?) -> ReadingClass {
        guard let r = reading, r.isFinite else { return .invalid }
        if r < absMinF || r > absMaxF { return .invalid }
        if let min = point.requiredMinF, r < min { return .outOfRange }
        if let max = point.requiredMaxF, r > max { return .outOfRange }
        return .ok
    }

    private static func normalizeCorrective(_ x: String?) -> String? {
        guard let s = x else { return nil }
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    /// `classifyReadings(temps, {expectAllPoints:false}).filter(t => t.status==='red').length`.
    /// Counts the number of point tiles that resolve to 'red'.
    static func redBreachCount(_ rows: [CmdTempLogRow]) -> Int {
        // Bucket rows by registry point_id (unknown ids dropped).
        var grouped: [String: [CmdTempLogRow]] = [:]
        for r in rows {
            guard let pid = r.pointId, byID[pid] != nil else { continue }
            grouped[pid, default: []].append(r)
        }
        // expectAllPoints:false → only points with rows are evaluated.
        var redCount = 0
        for (pid, bucket) in grouped {
            guard let point = byID[pid] else { continue }
            var ok = 0, corrective = 0, critical = 0, invalid = 0
            for r in bucket {
                switch classifyReading(point, r.readingF) {
                case .invalid: invalid += 1
                case .ok: ok += 1
                case .outOfRange:
                    if normalizeCorrective(r.correctiveAction) != nil { corrective += 1 }
                    else { critical += 1 }
                }
            }
            // status red: critical > 0, OR (rows>0 && ok==0 && corrective==0 && invalid>0)
            let isRed = critical > 0 || (!bucket.isEmpty && ok == 0 && corrective == 0 && invalid > 0)
            if isRed { redCount += 1 }
        }
        return redCount
    }
}
