import XCTest
@testable import LariatModel

/// Value-parity with `tests/js/test-datapack-search-toggle-detail.mjs`
/// (`app/datapack-search/detailsState.ts`) plus the compute helpers from the
/// route/client (`escapeFtsPhrase`, limit clamps, `pickTopNutrients`).
final class DatapackDetailStateTests: XCTestCase {
    private let key = "usda:12345"
    private typealias Entry = DatapackDetailEntry<String>

    // ── open-fresh ──────────────────────────────────────────────────────

    func testOpenFreshFlipsUndefinedRowToLoading() {
        let (next, action) = DatapackDetailState.next([String: Entry](), key: key)
        XCTAssertEqual(action, .openFresh)
        XCTAssertEqual(next[key], .loading)
    }

    func testClosedWithoutCacheRefetches() {
        // A previously-closed row WITHOUT cached data (errored, then
        // collapsed) refetches on the next click.
        let prev: [String: Entry] = [key: .closed(data: nil)]
        let (next, action) = DatapackDetailState.next(prev, key: key)
        XCTAssertEqual(action, .openFresh)
        XCTAssertEqual(next[key], .loading)
    }

    func testDoesNotMutatePrev() {
        let prev = [String: Entry]()
        let (next, _) = DatapackDetailState.next(prev, key: key)
        XCTAssertNil(prev[key])
        XCTAssertNotNil(next[key])
    }

    // ── collapse ────────────────────────────────────────────────────────

    func testCollapseOkPreservesCachedData() {
        let prev: [String: Entry] = [key: .ok(data: "egg-payload")]
        let (next, action) = DatapackDetailState.next(prev, key: key)
        XCTAssertEqual(action, .collapse)
        XCTAssertEqual(next[key], .closed(data: "egg-payload"))
    }

    func testCollapseErrorThenNextClickRefetches() {
        let prev: [String: Entry] = [key: .error(message: "HTTP 500")]
        let (next, action) = DatapackDetailState.next(prev, key: key)
        XCTAssertEqual(action, .collapse)
        XCTAssertEqual(next[key], .closed(data: nil))
        let (_, second) = DatapackDetailState.next(next, key: key)
        XCTAssertEqual(second, .openFresh)
    }

    // ── reopen-cached ───────────────────────────────────────────────────

    func testReopenCachedFlipsBackToOkWithoutFetch() {
        let prev: [String: Entry] = [key: .closed(data: "egg-payload")]
        let (next, action) = DatapackDetailState.next(prev, key: key)
        XCTAssertEqual(action, .reopenCached)
        XCTAssertEqual(next[key], .ok(data: "egg-payload"))
    }

    // ── noop-loading ────────────────────────────────────────────────────

    func testNoopLoadingDropsConcurrentClick() {
        let prev: [String: Entry] = [key: .loading]
        let (next, action) = DatapackDetailState.next(prev, key: key)
        XCTAssertEqual(action, .noopLoading)
        XCTAssertEqual(next, prev)
    }

    // ── full lifecycle ──────────────────────────────────────────────────

    func testFullLifecycleWalksOpenOkCollapseReopenWithoutRefetch() {
        var state = [String: Entry]()

        let r1 = DatapackDetailState.next(state, key: key)
        XCTAssertEqual(r1.action, .openFresh)
        state = r1.next
        XCTAssertEqual(state[key], .loading)

        let r2 = DatapackDetailState.next(state, key: key)
        XCTAssertEqual(r2.action, .noopLoading)

        state[key] = .ok(data: "payload")

        let r3 = DatapackDetailState.next(state, key: key)
        XCTAssertEqual(r3.action, .collapse)
        state = r3.next
        XCTAssertEqual(state[key], .closed(data: "payload"))

        let r4 = DatapackDetailState.next(state, key: key)
        XCTAssertEqual(r4.action, .reopenCached)
        state = r4.next
        XCTAssertEqual(state[key], .ok(data: "payload"))

        let r5 = DatapackDetailState.next(state, key: key)
        XCTAssertEqual(r5.action, .collapse)
        XCTAssertEqual(r5.next[key], .closed(data: "payload"))
    }

    func testUnrelatedRowsUntouchedOnEveryTransition() {
        let otherKey = "wikibooks:99"
        var state: [String: Entry] = [otherKey: .ok(data: "other")]
        let r1 = DatapackDetailState.next(state, key: key)
        XCTAssertEqual(r1.next[otherKey], .ok(data: "other"))
        state = r1.next
        state[key] = .ok(data: "mine")
        let r2 = DatapackDetailState.next(state, key: key)
        XCTAssertEqual(r2.next[otherKey], .ok(data: "other"))
    }

    func testDeterminismSamePrevSameResult() {
        let prev: [String: Entry] = [key: .closed(data: "payload")]
        let a = DatapackDetailState.next(prev, key: key)
        let b = DatapackDetailState.next(prev, key: key)
        XCTAssertEqual(a.action, b.action)
        XCTAssertEqual(a.next, b.next)
    }

    // ── compute helpers ─────────────────────────────────────────────────

    func testEscapeFtsPhrase() {
        XCTAssertEqual(DatapackSearchCompute.escapeFtsPhrase("hello world"), "\"hello world\"")
        XCTAssertEqual(DatapackSearchCompute.escapeFtsPhrase("he said \"hi\""), "\"he said hi\"")
    }

    func testLimitClamps() {
        XCTAssertEqual(DatapackSearchCompute.clampLibLimit(nil), 20)
        XCTAssertEqual(DatapackSearchCompute.clampLibLimit(500), 200)
        XCTAssertEqual(DatapackSearchCompute.clampLibLimit(0), 1)
        XCTAssertEqual(DatapackSearchCompute.routeLimit(nil), 20)
        XCTAssertEqual(DatapackSearchCompute.routeLimit(0), 20)
        XCTAssertEqual(DatapackSearchCompute.routeLimit(300), 100)
        XCTAssertEqual(DatapackSearchCompute.routeLimit(5), 5)
    }

    func testClipQuery() {
        XCTAssertNil(DatapackSearchCompute.clipQuery(nil))
        XCTAssertNil(DatapackSearchCompute.clipQuery("   "))
        XCTAssertEqual(DatapackSearchCompute.clipQuery(" eggs "), "eggs")
        XCTAssertEqual(DatapackSearchCompute.clipQuery(String(repeating: "q", count: 300))?.count, 240)
    }

    func testPickTopNutrientsMatchesPriorityPrefixOrder() {
        let nutrients = [
            UsdaNutrient(nutrientId: 5, nutrientName: "Sugars, total including NLEA", amount: 1, unitName: "g"),
            UsdaNutrient(nutrientId: 1, nutrientName: "Protein", amount: 12, unitName: "g"),
            UsdaNutrient(nutrientId: 2, nutrientName: "Energy", amount: 100, unitName: "kcal"),
            UsdaNutrient(nutrientId: 3, nutrientName: "Vitamin C", amount: 3, unitName: "mg"),
        ]
        let top = DatapackSearchCompute.pickTopNutrients(nutrients)
        XCTAssertEqual(top.map(\.nutrientId), [2, 1, 5])   // priority order, prefix match
    }
}
