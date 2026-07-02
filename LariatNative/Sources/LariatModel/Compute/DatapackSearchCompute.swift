import Foundation

/// Pure helpers for the datapack-search board — the non-I/O pieces of
/// `lib/datapackSearch.ts`, the route's input normalization
/// (`app/api/datapack/search/route.js`), and the drill-in toggle state
/// machine (`app/datapack-search/detailsState.ts`).
public enum DatapackSearchCompute {
    // ── escapeFtsPhrase (lib) ───────────────────────────────────────────

    /// Wrap an arbitrary string as a single FTS5 phrase: strip embedded
    /// double quotes (FTS5 has no in-phrase escape), then quote — so meta
    /// characters like AND/OR/-/* match literally.
    public static func escapeFtsPhrase(_ s: String) -> String {
        "\"\(s.replacingOccurrences(of: "\"", with: ""))\""
    }

    // ── limit clamps ────────────────────────────────────────────────────

    /// Library-level clamp: `Math.max(1, Math.min(200, limit ?? 20))`.
    public static func clampLibLimit(_ limit: Int?) -> Int {
        max(1, min(200, limit ?? 20))
    }

    /// Route-level parse: default 20; non-positive → 20; capped at 100.
    public static func routeLimit(_ raw: Int?) -> Int {
        guard let raw, raw >= 1 else { return 20 }
        return min(raw, 100)
    }

    /// Route-level query clip: trim; empty → nil; cap at 240 UTF-16 units
    /// (bounds FTS latency / accidental query-DoS).
    public static func clipQuery(_ s: String?) -> String? {
        guard let s else { return nil }
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return nil }
        return SpecialsValidators.clipText(t, max: 240)
    }

    // ── pickTopNutrients (DatapackSearchClient) ─────────────────────────

    /// The client's priority list — matched case-insensitively by
    /// nutrient_name PREFIX, in this order; absent nutrients fall through.
    public static let nutrientPriority = [
        "Energy",
        "Protein",
        "Carbohydrate",
        "Total lipid (fat)",
        "Sodium, Na",
        "Sugars, total",
    ]

    public static func pickTopNutrients(_ nutrients: [UsdaNutrient]) -> [UsdaNutrient] {
        var out: [UsdaNutrient] = []
        for wanted in nutrientPriority {
            if let found = nutrients.first(where: {
                ($0.nutrientName ?? "").lowercased().hasPrefix(wanted.lowercased())
            }) {
                out.append(found)
            }
        }
        return out
    }
}

// ── Drill-in toggle state machine (detailsState.ts) ─────────────────────
//
// Per-row state keyed by `${source}:${id}`:
//   nil            — never opened
//   .loading       — fetch in flight
//   .ok(data)      — payload cached and panel open
//   .error(msg)    — fetch failed; panel open showing the error
//   .closed(data?) — panel collapsed; cached data preserved so a future
//                    click re-opens without a refetch
//
// MUST stay deterministic (no clocks/random) — the web version is invoked
// twice under React StrictMode and both invocations must agree.

public enum DatapackDetailEntry<Data: Equatable & Sendable>: Equatable, Sendable {
    case loading
    case ok(data: Data)
    case error(message: String, data: Data? = nil)
    case closed(data: Data? = nil)

    var cachedData: Data? {
        switch self {
        case .loading: return nil
        case .ok(let data): return data
        case .error(_, let data): return data
        case .closed(let data): return data
        }
    }
}

public enum DatapackDetailAction: String, Sendable, Equatable {
    /// No cache — caller should kick off the fetch (row flips to loading).
    case openFresh = "open-fresh"
    /// Closed-but-cached — flip back to ok, no fetch.
    case reopenCached = "reopen-cached"
    /// Currently open (loading is guarded separately; ok/error) → closed.
    case collapse
    /// A fetch is already in flight; the click is dropped (`next == prev`).
    case noopLoading = "noop-loading"
}

public enum DatapackDetailState {
    public static func next<Data>(
        _ prev: [String: DatapackDetailEntry<Data>], key: String
    ) -> (next: [String: DatapackDetailEntry<Data>], action: DatapackDetailAction) {
        guard let existing = prev[key] else {
            var out = prev
            out[key] = .loading
            return (out, .openFresh)
        }

        switch existing {
        case .loading:
            // Concurrent-click guard: drop the click.
            return (prev, .noopLoading)

        case .ok(let data):
            var out = prev
            out[key] = .closed(data: data)
            return (out, .collapse)

        case .error(_, let data):
            var out = prev
            out[key] = .closed(data: data)
            return (out, .collapse)

        case .closed(let data):
            if let data {
                var out = prev
                out[key] = .ok(data: data)
                return (out, .reopenCached)
            }
            // Closed without cache (errored-then-collapsed): refetch.
            var out = prev
            out[key] = .loading
            return (out, .openFresh)
        }
    }
}
