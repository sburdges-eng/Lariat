import XCTest
@testable import LariatModel

/// Compute-layer parity with the web oracle `tests/js/test-margin-deltas.mjs`.
/// The algorithm cases build input arrays directly (no DB) — the repo tests
/// (`MarginDeltasRepositoryTests`) cover the SQL window/scope cases.
///
/// Snapshots must be handed in pre-sorted the way the repo SQL orders them:
/// `ingredient, vendor, sku, snapshot_at ASC, id ASC`. Fixed ISO datetime
/// strings are used so first-seen == baseline and last == latest, matching
/// the SQL ORDER BY. Lexical string compare on these ISO strings equals
/// chronological compare.
final class MarginDeltasComputeTests: XCTestCase {

    // Fixed timestamps, chronologically ordered by lexical string compare.
    private let d6 = "2026-06-25 00:00:00" // "6 days ago"
    private let d5 = "2026-06-26 00:00:00" // "5 days ago"
    private let d4 = "2026-06-27 00:00:00" // "4 days ago"
    private let d3 = "2026-06-28 00:00:00" // "3 days ago"
    private let d0 = "2026-07-01 00:00:00" // "today"

    private func snap(_ ing: String, _ vendor: String, _ sku: String, _ price: Double, _ at: String) -> MarginSnapshot {
        MarginSnapshot(vendor: vendor, sku: sku, ingredient: ing, snapshotAt: at, unitPrice: price)
    }
    private func vendorComp(_ dish: String, _ ing: String, _ qty: Double) -> MarginDishComponent {
        MarginDishComponent(dishName: dish, componentType: "vendor_item", recipeSlug: nil, vendorIngredient: ing, qtyPerServing: qty)
    }
    private func recipeComp(_ dish: String, _ slug: String, _ qty: Double) -> MarginDishComponent {
        MarginDishComponent(dishName: dish, componentType: "recipe", recipeSlug: slug, vendorIngredient: nil, qtyPerServing: qty)
    }

    // ── single vendor_item dish ────────────────────────────────────────────

    // Oracle: "computes signed delta_pct from a SKU that moved up"
    func testSingleVendorItemMovedUp() {
        let snaps = [
            snap("Brioche Bun", "sysco", "BUN-1", 0.50, d6),
            snap("Brioche Bun", "sysco", "BUN-1", 0.60, d0),
        ]
        let comps = [vendorComp("Cheeseburger", "Brioche Bun", 1)]
        let rows = MarginDeltasCompute.compute(components: comps, snapshots: snaps,
                                               options: MarginDeltaOptions(windowDays: 7, minPctMove: 5))
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].dishName, "Cheeseburger")
        XCTAssertEqual(rows[0].baselineCost, 0.50, accuracy: 1e-9)
        XCTAssertEqual(rows[0].latestCost, 0.60, accuracy: 1e-9)
        XCTAssertEqual(rows[0].direction, .up)
        XCTAssertEqual(rows[0].deltaPct, 20.0, accuracy: 1e-6)
        XCTAssertEqual(rows[0].topContributors.count, 1)
        XCTAssertEqual(rows[0].topContributors[0].sku, "BUN-1")
        XCTAssertEqual(rows[0].topContributors[0].contributionPct, 100, accuracy: 1e-6)
    }

    // Oracle: "handles a price drop with direction=down"
    func testSingleVendorItemMovedDown() {
        let snaps = [
            snap("Canola Oil", "shamrock", "OIL-1", 10, d5),
            snap("Canola Oil", "shamrock", "OIL-1", 8, d0),
        ]
        let comps = [vendorComp("Fries", "Canola Oil", 0.1)]
        let rows = MarginDeltasCompute.compute(components: comps, snapshots: snaps,
                                               options: MarginDeltaOptions(windowDays: 7, minPctMove: 5))
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].direction, .down)
        XCTAssertLessThan(rows[0].deltaPct, 0)
        XCTAssertEqual(rows[0].deltaPct, -20.0, accuracy: 1e-6)
    }

    // ── multi-component dish ────────────────────────────────────────────────

    // Oracle: "one component up + one down, contributors sorted by abs"
    func testTwoComponentUpAndDownContributorsSortedByAbs() {
        let snaps = [
            // Beef Patty: 8 → 10 (up, qty 0.5 → +1.0)
            snap("Beef Patty", "sysco", "PATTY-1", 8, d5),
            snap("Beef Patty", "sysco", "PATTY-1", 10, d0),
            // Brioche Bun: 1.00 → 0.80 (down, qty 1 → -0.20)
            snap("Brioche Bun", "shamrock", "BUN-1", 1.00, d5),
            snap("Brioche Bun", "shamrock", "BUN-1", 0.80, d0),
        ]
        let comps = [
            vendorComp("Cheeseburger", "Beef Patty", 0.5),
            vendorComp("Cheeseburger", "Brioche Bun", 1),
        ]
        let rows = MarginDeltasCompute.compute(components: comps, snapshots: snaps,
                                               options: MarginDeltaOptions(windowDays: 7, minPctMove: 1))
        XCTAssertEqual(rows.count, 1)
        let r = rows[0]
        // baseline = 8*0.5 + 1.00*1 = 5.00; latest = 10*0.5 + 0.80*1 = 5.80
        XCTAssertEqual(r.baselineCost, 5.00, accuracy: 1e-9)
        XCTAssertEqual(r.latestCost, 5.80, accuracy: 1e-9)
        XCTAssertEqual(r.direction, .up)
        XCTAssertEqual(r.deltaPct, 16.0, accuracy: 1e-6)

        XCTAssertEqual(r.topContributors.count, 2)
        // Patty drove +1.00 of +0.80 net = +125%; Bun -0.20 of +0.80 = -25%.
        // Patty has larger |contribution| → first.
        XCTAssertEqual(r.topContributors[0].ingredient, "Beef Patty")
        XCTAssertGreaterThan(r.topContributors[0].contributionPct, 0)
        XCTAssertEqual(r.topContributors[1].ingredient, "Brioche Bun")
        XCTAssertLessThan(r.topContributors[1].contributionPct, 0)
        let total = r.topContributors[0].contributionPct + r.topContributors[1].contributionPct
        XCTAssertEqual(total, 100, accuracy: 1e-6)
    }

    // ── recipe skip ─────────────────────────────────────────────────────────

    // Oracle: "returns no row when a dish only has recipe components"
    func testRecipeOnlyDishReturnsNothing() {
        let snaps = [
            snap("Tomato", "sysco", "IRRELEVANT", 1, d5),
            snap("Tomato", "sysco", "IRRELEVANT", 2, d0),
        ]
        let comps = [recipeComp("Bowl of Chili", "green_chili", 8)]
        let rows = MarginDeltasCompute.compute(components: comps, snapshots: snaps,
                                               options: MarginDeltaOptions(windowDays: 7, minPctMove: 1))
        XCTAssertEqual(rows, [])
    }

    // Oracle: "mixed recipe + vendor_item dish only counts the vendor_item"
    func testMixedRecipeAndVendorOnlyCountsVendor() {
        let snaps = [
            snap("Cheddar", "v", "CH", 4, d5),
            snap("Cheddar", "v", "CH", 5, d0),
        ]
        let comps = [
            recipeComp("Cheesy Mac", "mac_sauce", 4),
            vendorComp("Cheesy Mac", "Cheddar", 0.25),
        ]
        let rows = MarginDeltasCompute.compute(components: comps, snapshots: snaps,
                                               options: MarginDeltaOptions(windowDays: 7, minPctMove: 1))
        XCTAssertEqual(rows.count, 1)
        // baseline 4*0.25=1.00, latest 5*0.25=1.25, +25%
        XCTAssertEqual(rows[0].deltaPct, 25.0, accuracy: 1e-6)
        XCTAssertEqual(rows[0].topContributors.count, 1)
    }

    // ── gating ──────────────────────────────────────────────────────────────

    // Oracle: "filters dishes whose move is below minPctMove"
    func testMinPctMoveGate() {
        let snaps = [
            // Dish A ingredient "A": 100 → 102 (+2%, below 5% gate)
            snap("A", "v", "A", 100, d5),
            snap("A", "v", "A", 102, d0),
            // Dish B ingredient "B": 100 → 110 (+10%, passes)
            snap("B", "v", "B", 100, d5),
            snap("B", "v", "B", 110, d0),
        ]
        let comps = [
            vendorComp("Dish A", "A", 1),
            vendorComp("Dish B", "B", 1),
        ]
        let rows = MarginDeltasCompute.compute(components: comps, snapshots: snaps,
                                               options: MarginDeltaOptions(windowDays: 7, minPctMove: 5))
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].dishName, "Dish B")
    }

    // Oracle: "sorts by abs delta_pct DESC and trims to limit"
    func testSortsByAbsDeltaDescAndTrimsToLimit() {
        // deltas: A +10, B +30, C -20, D +5; limit 3 → [B, C, A]
        let cases: [(String, Double, Double)] = [
            ("Dish_A", 100, 110),
            ("Dish_B", 100, 130),
            ("Dish_C", 100, 80),
            ("Dish_D", 100, 105),
        ]
        var snaps: [MarginSnapshot] = []
        var comps: [MarginDishComponent] = []
        // Sort input snapshots by ingredient (Ing_Dish_A < Ing_Dish_B < …) to
        // match the SQL ORDER BY the compute assumes.
        for (dish, oldP, newP) in cases.sorted(by: { "Ing_\($0.0)" < "Ing_\($1.0)" }) {
            let ing = "Ing_\(dish)"
            let sku = "SKU_\(dish)"
            snaps.append(snap(ing, "v", sku, oldP, d5))
            snaps.append(snap(ing, "v", sku, newP, d0))
        }
        for (dish, _, _) in cases {
            comps.append(vendorComp(dish, "Ing_\(dish)", 1))
        }
        let rows = MarginDeltasCompute.compute(components: comps, snapshots: snaps,
                                               options: MarginDeltaOptions(windowDays: 7, minPctMove: 5, limit: 3))
        XCTAssertEqual(rows.count, 3)
        XCTAssertEqual(rows.map(\.dishName), ["Dish_B", "Dish_C", "Dish_A"])
    }

    // ── multi-vendor SKU resolution ─────────────────────────────────────────

    // Oracle: "picks the SKU whose latest snapshot is most recent"
    func testMultiVendorPicksMostRecentLatest() {
        // Vendor A last refreshed 3 days ago; Vendor B refreshed today → B wins.
        // Pre-sorted by (ingredient, vendor, sku, snapshot_at ASC).
        let snaps = [
            snap("Tomato", "A", "OLD", 1.00, d6),
            snap("Tomato", "A", "OLD", 1.50, d3),
            snap("Tomato", "B", "NEW", 2.00, d5),
            snap("Tomato", "B", "NEW", 3.00, d0),
        ]
        let comps = [vendorComp("Salsa", "Tomato", 1)]
        let rows = MarginDeltasCompute.compute(components: comps, snapshots: snaps,
                                               options: MarginDeltaOptions(windowDays: 7, minPctMove: 1))
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].topContributors[0].vendor, "B")
        XCTAssertEqual(rows[0].topContributors[0].sku, "NEW")
        XCTAssertEqual(rows[0].deltaPct, 50, accuracy: 1e-6)
    }

    // ── empty-input guard ───────────────────────────────────────────────────

    // Oracle: "returns [] when no dish_components exist"
    func testEmptyComponentsReturnsEmpty() {
        let snaps = [
            snap("Hass Avocado", "sysco", "AVO-1", 1.50, d5),
            snap("Hass Avocado", "sysco", "AVO-1", 2.00, d0),
        ]
        let rows = MarginDeltasCompute.compute(components: [], snapshots: snaps,
                                               options: MarginDeltaOptions(windowDays: 7, minPctMove: 1))
        XCTAssertEqual(rows, [])
    }

    // Oracle: "returns [] when neither dish_components nor history have rows"
    func testEmptyEverythingReturnsEmpty() {
        let rows = MarginDeltasCompute.compute(components: [], snapshots: [],
                                               options: MarginDeltaOptions(windowDays: 7, minPctMove: 1))
        XCTAssertEqual(rows, [])
    }

    // ── NUL-joined key avoids collisions ────────────────────────────────────

    // Oracle: "treats (ingredient,vendor) pairs that would naively
    // concatenate-collide as distinct" — the collision guard. If the key
    // separator were a space or empty, the two SKUs merge into one bucket,
    // baseline becomes 0.40 (earliest of all four) and delta_pct = +100%.
    // With the NUL join the buckets stay distinct: the "Sysco"/"Brioche Bun"
    // SKU wins resolution (most recent) and yields +60%.
    func testNulJoinedKeyAvoidsCollisions() {
        // Sorted by (ingredient, vendor, sku, snapshot_at ASC):
        //   ingredient "Brioche Roll"
        //     vendor "Sysco",         sku "Brioche Bun"  (0.50 d5 → 0.80 d0)
        //     vendor "Sysco Brioche", sku "Bun"          (0.40 d6 → 0.45 d4)
        let snaps = [
            snap("Brioche Roll", "Sysco", "Brioche Bun", 0.50, d5),
            snap("Brioche Roll", "Sysco", "Brioche Bun", 0.80, d0),
            snap("Brioche Roll", "Sysco Brioche", "Bun", 0.40, d6),
            snap("Brioche Roll", "Sysco Brioche", "Bun", 0.45, d4),
        ]
        let comps = [vendorComp("House Cheeseburger", "Brioche Roll", 1)]
        let rows = MarginDeltasCompute.compute(components: comps, snapshots: snaps,
                                               options: MarginDeltaOptions(windowDays: 7, minPctMove: 1))
        XCTAssertEqual(rows.count, 1)
        let r = rows[0]
        XCTAssertEqual(r.topContributors[0].vendor, "Sysco")
        XCTAssertEqual(r.topContributors[0].sku, "Brioche Bun")
        XCTAssertEqual(r.deltaPct, 60, accuracy: 1e-6,
                       "expected +60% from un-collided Sysco/Brioche Bun bucket, got \(r.deltaPct)")
    }

    // ── location scoping (oracle case 7) ────────────────────────────────────

    // Oracle: "scopes dish_components and snapshots by location_id".
    // The compute itself is location-blind — the repository's WHERE clauses
    // scope both reads (pinned in MarginDeltasRepositoryTests). The
    // compute-level contract asserted here is twofold: (a) MarginDeltaOptions
    // normalizes location_id exactly like the web option normalizer (trim,
    // empty → 'default'), and (b) feeding each location's pre-scoped rows
    // through the compute separately cannot cross-contaminate: kitchen-a
    // (100 → 200, +100%) yields its row while kitchen-b (100 → 100.5, +0.5%,
    // below the 5% gate) yields none.
    func testLocationScopingIsolation() {
        // (a) option normalization — lib/marginDeltas.ts L103-124 parity.
        XCTAssertEqual(MarginDeltaOptions(locationId: "  kitchen-a  ").locationId, "kitchen-a")
        XCTAssertEqual(MarginDeltaOptions(locationId: "   ").locationId, "default")
        XCTAssertEqual(MarginDeltaOptions().locationId, "default")

        // (b) per-location isolation through the compute.
        let kitchenASnaps = [
            snap("X", "v", "X", 100, d5),
            snap("X", "v", "X", 200, d0),
        ]
        let kitchenBSnaps = [
            snap("X", "v", "X", 100, d5),
            snap("X", "v", "X", 100.5, d0),
        ]
        let comps = [vendorComp("Dish A", "X", 1)]

        let a = MarginDeltasCompute.compute(
            components: comps, snapshots: kitchenASnaps,
            options: MarginDeltaOptions(locationId: "kitchen-a", windowDays: 7, minPctMove: 5))
        let b = MarginDeltasCompute.compute(
            components: comps, snapshots: kitchenBSnaps,
            options: MarginDeltaOptions(locationId: "kitchen-b", windowDays: 7, minPctMove: 5))
        XCTAssertEqual(a.count, 1)
        XCTAssertEqual(a[0].deltaPct, 100, accuracy: 1e-6)
        XCTAssertEqual(b.count, 0)
    }

    // ── windowDays clamping (oracle case 8) ─────────────────────────────────

    // Oracle: "clamps windowDays to [1, 90]" — 0/negative/nil fall back to
    // the default 7; out-of-range-high clamps to 90; in-range passes through.
    // Snapshot-visibility boundary: a baseline 40 days old is only visible
    // through a ≥40-day window — with the clamped default (7) the repository
    // hands the compute a single snapshot per SKU (baselineAt == latestAt →
    // skipped, 0 rows); with the 90-day clamp both snapshots arrive and the
    // baseline_cost is 100 (oracle asserts huge[0].baseline_cost === 100).
    func testWindowDaysClampingEdgeCases() {
        // Clamp table — lib/marginDeltas.ts option normalization.
        XCTAssertEqual(MarginDeltaOptions(windowDays: 0).windowDays, 7, "0 → default 7")
        XCTAssertEqual(MarginDeltaOptions(windowDays: -3).windowDays, 7, "negative → default 7")
        XCTAssertEqual(MarginDeltaOptions(windowDays: nil).windowDays, 7, "nil → default 7")
        XCTAssertEqual(MarginDeltaOptions(windowDays: 9999).windowDays, 90, "9999 → clamp 90")
        XCTAssertEqual(MarginDeltaOptions(windowDays: 91).windowDays, 90, "91 → clamp 90")
        XCTAssertEqual(MarginDeltaOptions(windowDays: 90).windowDays, 90)
        XCTAssertEqual(MarginDeltaOptions(windowDays: 1).windowDays, 1)

        let d40 = "2026-05-22 00:00:00" // "40 days ago" relative to d0
        let comps = [vendorComp("Dish A", "A", 1)]

        // windowDays:0 → clamped 7 → the 40-day baseline is outside the
        // window; only the d0 snapshot reaches the compute → no movement.
        let zeroWindowVisible = [snap("A", "v", "A", 200, d0)]
        let zero = MarginDeltasCompute.compute(
            components: comps, snapshots: zeroWindowVisible,
            options: MarginDeltaOptions(windowDays: 0, minPctMove: 5))
        XCTAssertEqual(zero.count, 0)

        // windowDays:9999 → clamped 90 → baseline visible → 1 row, baseline 100.
        let hugeWindowVisible = [
            snap("A", "v", "A", 100, d40),
            snap("A", "v", "A", 200, d0),
        ]
        let huge = MarginDeltasCompute.compute(
            components: comps, snapshots: hugeWindowVisible,
            options: MarginDeltaOptions(windowDays: 9999, minPctMove: 5))
        XCTAssertEqual(huge.count, 1)
        XCTAssertEqual(huge[0].baselineCost, 100, accuracy: 1e-9)
    }

    // ── top_contributors trimmed to 3 ───────────────────────────────────────

    // Oracle: "caps top_contributors at three entries even when the dish has more"
    func testTopContributorsCappedAtThree() {
        let ingredients: [(String, Double, Double, Double)] = [
            ("Beef Tenderloin", 5.00, 6.00, 0.5),           // +0.50
            ("Heirloom Tomato", 1.20, 1.80, 0.25),          // +0.15
            ("Sysco Brioche Bun", 0.50, 0.55, 1),           // +0.05
            ("House Sriracha Aioli Base", 2.00, 2.10, 0.1), // +0.01
            ("Iceberg Lettuce", 0.40, 0.41, 0.05),          // +0.0005
        ]
        var snaps: [MarginSnapshot] = []
        // Sort snapshots by ingredient to satisfy the compute's ordering assumption.
        for (ing, base, latest, _) in ingredients.sorted(by: { $0.0 < $1.0 }) {
            snaps.append(snap(ing, "sysco", "SKU-\(ing)", base, d5))
            snaps.append(snap(ing, "sysco", "SKU-\(ing)", latest, d0))
        }
        var comps: [MarginDishComponent] = []
        for (ing, _, _, qty) in ingredients {
            comps.append(vendorComp("Tenderloin Plate", ing, qty))
        }
        let rows = MarginDeltasCompute.compute(components: comps, snapshots: snaps,
                                               options: MarginDeltaOptions(windowDays: 7, minPctMove: 1))
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].topContributors.count, 3)
        XCTAssertEqual(rows[0].topContributors.map(\.ingredient),
                       ["Beef Tenderloin", "Heirloom Tomato", "Sysco Brioche Bun"])
    }
}
