import XCTest
@testable import LariatModel

/// Value-parity tests for `VarianceAttributionCompute`, ported against
/// `lib/varianceAttribution.ts` and the oracle `tests/js/test-variance-attribution.mjs`.
final class VarianceAttributionComputeTests: XCTestCase {

    // MARK: - Task 1: window selection + threshold color + delta rounding

    private func row(_ end: String, amt: Double, pct: Double) -> VarianceAttrRow {
        VarianceAttrRow(periodStart: nil, periodEnd: end, theoreticalCogs: 1000, actualCogs: 1000 + amt,
                        varianceAmount: amt, variancePct: pct)
    }

    // Oracle: "defaults to the two most recent periods" — baseline 2026-05-01 pct2 amt20,
    // current 2026-05-15 pct5.5 amt55 → delta_pct 3.5, delta_amount 35, colors yellow/red.
    func testDefaultWindowDeltaAndColors() {
        let base = row("2026-05-01", amt: 20, pct: 2)
        let cur  = row("2026-05-15", amt: 55, pct: 5.5)
        guard case let .ok(window, delta) =
            VarianceAttributionCompute.selectWindow(baseline: base, current: cur,
                hasFrom: false, hasTo: false, from: nil, to: nil, recentCount: 2)
        else { return XCTFail("expected ok") }
        XCTAssertEqual(window, VarianceAttrWindow(from: "2026-05-01", to: "2026-05-15"))
        XCTAssertEqual(delta.deltaPct, 3.5)
        XCTAssertEqual(delta.deltaAmount, 35)
        XCTAssertEqual(delta.baseline?.thresholdColor, .yellow)   // pct 2 → yellow
        XCTAssertEqual(delta.current?.thresholdColor, .red)       // pct 5.5 → red
    }

    // Oracle: "honors explicit from/to period_end overrides" — happy-path explicit window.
    func testExplicitWindowOverrideOk() {
        let base = row("2026-04-17", amt: 10, pct: 1)
        let cur  = row("2026-05-01", amt: 20, pct: 2)
        guard case let .ok(window, delta) =
            VarianceAttributionCompute.selectWindow(baseline: base, current: cur,
                hasFrom: true, hasTo: true, from: "2026-04-17", to: "2026-05-01", recentCount: 2)
        else { return XCTFail("expected ok") }
        XCTAssertEqual(window, VarianceAttrWindow(from: "2026-04-17", to: "2026-05-01"))
        XCTAssertEqual(delta.baseline?.periodEnd, "2026-04-17")
        XCTAssertEqual(delta.current?.periodEnd, "2026-05-01")
    }

    // Oracle: "returns coherent ok:false when explicit period missing" — from 2026-01-01 absent.
    func testExplicitMissingBaselineFails() {
        let cur = row("2026-05-15", amt: 55, pct: 5.5)
        guard case let .failed(reason) =
            VarianceAttributionCompute.selectWindow(baseline: nil, current: cur,
                hasFrom: true, hasTo: true, from: "2026-01-01", to: "2026-05-15", recentCount: 2)
        else { return XCTFail("expected failed") }
        XCTAssertTrue(reason.contains("2026-01-01"))
    }

    // from >= to guard (lib line 501).
    func testFromNotBeforeToFails() {
        guard case let .failed(reason) =
            VarianceAttributionCompute.selectWindow(baseline: nil, current: nil,
                hasFrom: true, hasTo: true, from: "2026-05-15", to: "2026-05-01", recentCount: 2)
        else { return XCTFail("expected failed") }
        XCTAssertTrue(reason.contains("earlier period_end"))
    }

    // only one of from/to (lib line 496).
    func testOneOfFromToFails() {
        guard case .failed = VarianceAttributionCompute.selectWindow(
            baseline: nil, current: nil, hasFrom: true, hasTo: false,
            from: "2026-05-01", to: nil, recentCount: 2) else { return XCTFail() }
    }

    // Oracle: "empty DB" — fewer than two recent periods.
    func testEmptyDbNeedsTwoPeriods() {
        guard case let .failed(reason) = VarianceAttributionCompute.selectWindow(
            baseline: nil, current: nil, hasFrom: false, hasTo: false,
            from: nil, to: nil, recentCount: 0) else { return XCTFail() }
        XCTAssertTrue(reason.contains("two variance periods"))
    }

    // Delta half-up tie: 2.5 → 3 not 2 (jsRound floor(x+0.5)).
    func testDeltaRoundingHalfUp() {
        let base = row("2026-05-01", amt: 0, pct: 0)
        let cur  = row("2026-05-15", amt: 2.5, pct: 2.5)
        guard case let .ok(_, delta) = VarianceAttributionCompute.selectWindow(
            baseline: base, current: cur, hasFrom: false, hasTo: false,
            from: nil, to: nil, recentCount: 2) else { return XCTFail() }
        // Math.round(2.5*100)/100 = 2.5; but Math.round(2.5)=3 at 1s place — here 2.5 rounds to 2.5.
        XCTAssertEqual(delta.deltaAmount, 2.5)
    }

    // Gap-fix: exercise an actual *.5 tie at the 2dp rounding boundary, and a negative
    // delta to pin jsRound's floor(x+0.5) (round-toward-+inf on ties), matching JS
    // Math.round (NOT Swift .rounded() which is half-away-from-zero on negatives).
    func testDeltaRoundingTieAtHundredthsBoundary() {
        // delta_amount raw = 0.005 → *100 = 0.5 → jsRound(0.5) = floor(1.0) = 1 → /100 = 0.01
        let base = row("2026-05-01", amt: 0, pct: 0)
        let cur  = row("2026-05-15", amt: 0.005, pct: 0)
        guard case let .ok(_, delta) = VarianceAttributionCompute.selectWindow(
            baseline: base, current: cur, hasFrom: false, hasTo: false,
            from: nil, to: nil, recentCount: 2) else { return XCTFail() }
        XCTAssertEqual(delta.deltaAmount, 0.01)
    }

    func testDeltaRoundingNegativeTieRoundsTowardPositiveInfinity() {
        // delta_amount raw = -0.005 → *100 = -0.5 → jsRound(-0.5) = floor(0.0) = 0 → /100 = 0
        // (JS Math.round(-0.5) === 0, NOT -1 — differs from Swift .rounded() which gives -1.)
        let base = row("2026-05-01", amt: 0.005, pct: 0)
        let cur  = row("2026-05-15", amt: 0, pct: 0)
        guard case let .ok(_, delta) = VarianceAttributionCompute.selectWindow(
            baseline: base, current: cur, hasFrom: false, hasTo: false,
            from: nil, to: nil, recentCount: 2) else { return XCTFail() }
        XCTAssertEqual(delta.deltaAmount, -0.0)
    }

    func testThresholdColorBuckets() {
        XCTAssertEqual(VarianceAttributionCompute.thresholdColor(nil), .green)
        XCTAssertEqual(VarianceAttributionCompute.thresholdColor(-5.0), .red)
        XCTAssertEqual(VarianceAttributionCompute.thresholdColor(2.0), .yellow)
        XCTAssertEqual(VarianceAttributionCompute.thresholdColor(1.99), .green)
    }

    // MARK: - Task 2: four evidence-section algorithms

    // Oracle price_moves: Avocado 10→12 (+20%), linked; Lime flat (excluded);
    // Tomato out-of-window (repository won't hand it in). Here we hand only in-window snaps.
    func testPriceMovesFirstToLastAndLinkFlag() {
        let snaps = [
            PriceSnapRow(vendor: "sysco", sku: "AVO-1", ingredient: "Avocado", unitPrice: 10, snapshotAt: "2026-05-03 08:00:00"),
            PriceSnapRow(vendor: "sysco", sku: "AVO-1", ingredient: "Avocado", unitPrice: 12, snapshotAt: "2026-05-10 12:00:00"),
            PriceSnapRow(vendor: "sysco", sku: "LIM-1", ingredient: "Lime", unitPrice: 5, snapshotAt: "2026-05-03 08:00:00"),
            PriceSnapRow(vendor: "sysco", sku: "LIM-1", ingredient: "Lime", unitPrice: 5, snapshotAt: "2026-05-10 12:00:00"),
        ]
        let out = VarianceAttributionCompute.priceMoves(snaps: snaps, linkedIngredients: ["Avocado"])
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].ingredient, "Avocado")
        XCTAssertEqual(out[0].firstPrice, 10); XCTAssertEqual(out[0].lastPrice, 12)
        XCTAssertEqual(out[0].pctMove, 20); XCTAssertEqual(out[0].snapshots, 2)
        XCTAssertTrue(out[0].linkedToMenu)
    }

    // Gap-fix: a move where first.unitPrice is nil but last differs → still emitted
    // (JS `null !== 5` is a "move"), with pctMove == nil, sorted as abs(nil ?? 0) == 0.
    func testPriceMovesNullFirstPriceStillEmittedWithNilPct() {
        let snaps = [
            PriceSnapRow(vendor: "sysco", sku: "MYS-1", ingredient: "Mystery", unitPrice: nil, snapshotAt: "2026-05-03 08:00:00"),
            PriceSnapRow(vendor: "sysco", sku: "MYS-1", ingredient: "Mystery", unitPrice: 5, snapshotAt: "2026-05-10 12:00:00"),
            PriceSnapRow(vendor: "sysco", sku: "AVO-1", ingredient: "Avocado", unitPrice: 10, snapshotAt: "2026-05-03 08:00:00"),
            PriceSnapRow(vendor: "sysco", sku: "AVO-1", ingredient: "Avocado", unitPrice: 12, snapshotAt: "2026-05-10 12:00:00"),
        ]
        let out = VarianceAttributionCompute.priceMoves(snaps: snaps, linkedIngredients: [])
        XCTAssertEqual(out.count, 2)
        // pctMove nil sorts as abs(0) — Avocado's 20 sorts first (20 > 0).
        XCTAssertEqual(out[0].ingredient, "Avocado")
        let mystery = out.first { $0.ingredient == "Mystery" }
        XCTAssertNotNil(mystery)
        XCTAssertNil(mystery?.pctMove)
        XCTAssertNil(mystery?.firstPrice)
        XCTAssertEqual(mystery?.lastPrice, 5)
    }

    // Two groups both with nil pctMove: stable-sort keeps insertion order (JS Array.sort stable).
    func testPriceMovesStableSortOnEqualAbsPct() {
        let snaps = [
            PriceSnapRow(vendor: "a", sku: "1", ingredient: "First", unitPrice: nil, snapshotAt: "2026-05-03 08:00:00"),
            PriceSnapRow(vendor: "a", sku: "1", ingredient: "First", unitPrice: 5, snapshotAt: "2026-05-10 12:00:00"),
            PriceSnapRow(vendor: "b", sku: "2", ingredient: "Second", unitPrice: nil, snapshotAt: "2026-05-03 08:00:00"),
            PriceSnapRow(vendor: "b", sku: "2", ingredient: "Second", unitPrice: 6, snapshotAt: "2026-05-10 12:00:00"),
        ]
        let out = VarianceAttributionCompute.priceMoves(snaps: snaps, linkedIngredients: [])
        XCTAssertEqual(out.map(\.ingredient), ["First", "Second"])
    }

    // Oracle composition_changes: New Dish created-in-window; Edited Dish (created 2026-01,
    // updated in-window) → "updated" + component contains salsa-verde; Old Dish excluded by repo.
    func testCompositionChangeKind() {
        let rows = [
            CompRow(dishName: "New Dish", componentType: "vendor_item", recipeSlug: nil, vendorIngredient: "Halibut",
                    qtyPerServing: 1, unit: "ea", createdAt: "2026-05-10 12:00:00", updatedAt: "2026-05-10 12:00:00"),
            CompRow(dishName: "Edited Dish", componentType: "recipe", recipeSlug: "salsa-verde", vendorIngredient: nil,
                    qtyPerServing: 1, unit: "ea", createdAt: "2026-01-01 00:00:00", updatedAt: "2026-05-10 12:00:00"),
        ]
        let out = VarianceAttributionCompute.compositionChanges(rows: rows, from: "2026-05-01", to: "2026-05-15")
        let byDish = Dictionary(uniqueKeysWithValues: out.map { ($0.dishName, $0) })
        XCTAssertEqual(byDish["New Dish"]?.changeKind, "created")
        XCTAssertEqual(byDish["Edited Dish"]?.changeKind, "updated")
        XCTAssertTrue(byDish["Edited Dish"]!.component.contains("salsa-verde"))
    }

    // Gap-fix: changedAt field-level parity — "updated" row's changedAt equals updatedAt,
    // NOT createdAt (lib:315 `createdInWindow ? created_at : (updated_at ?? created_at) ?? ''`).
    func testCompositionChangedAtUsesUpdatedAtWhenUpdatedInWindow() {
        let rows = [
            CompRow(dishName: "Edited Dish", componentType: "recipe", recipeSlug: "salsa-verde", vendorIngredient: nil,
                    qtyPerServing: 1, unit: "ea", createdAt: "2026-01-01 00:00:00", updatedAt: "2026-05-10 12:00:00"),
        ]
        let out = VarianceAttributionCompute.compositionChanges(rows: rows, from: "2026-05-01", to: "2026-05-15")
        XCTAssertEqual(out.first?.changedAt, "2026-05-10 12:00:00")
    }

    func testCompositionChangedAtUsesCreatedAtWhenCreatedInWindow() {
        let rows = [
            CompRow(dishName: "New Dish", componentType: "vendor_item", recipeSlug: nil, vendorIngredient: "Halibut",
                    qtyPerServing: 1, unit: "ea", createdAt: "2026-05-10 12:00:00", updatedAt: "2026-05-10 12:00:00"),
        ]
        let out = VarianceAttributionCompute.compositionChanges(rows: rows, from: "2026-05-01", to: "2026-05-15")
        XCTAssertEqual(out.first?.changedAt, "2026-05-10 12:00:00")
        XCTAssertEqual(out.first?.changeKind, "created")
    }

    // Oracle count_corrections: 1 closed + 2 audits (reopen + line update), closed first.
    func testCountCorrectionsUnionClosedFirst() {
        let audits = [
            AuditRow(entity: "inventory_counts", entityId: 1, action: "update",
                     actorCookId: "cook-1", payloadJson: "{\"transition\":\"reopen\"}", createdAt: "2026-05-10 12:00:00"),
            AuditRow(entity: "inventory_count_lines", entityId: 1, action: "update",
                     actorCookId: "cook-2", payloadJson: nil, createdAt: "2026-05-10 12:00:00"),
        ]
        let closed = [ClosedCountRow(id: 7, label: "Weekly walk-in", countDate: "2026-05-09", closedAt: "2026-05-10 12:00:00", lines: 3)]
        let out = VarianceAttributionCompute.countCorrections(audits: audits, closed: closed)
        XCTAssertEqual(out.count, 3)
        XCTAssertEqual(out[0].kind, "count_closed")            // closed first
        XCTAssertEqual(out[0].label, "Weekly walk-in"); XCTAssertEqual(out[0].lines, 3)
        XCTAssertEqual(out.first { $0.transition == "reopen" }?.entity, "inventory_counts")
    }

    // Malformed payload_json → transition stays nil, row still included (lib:354-360 try/catch).
    func testCountCorrectionsMalformedPayloadLeavesTransitionNil() {
        let audits = [
            AuditRow(entity: "inventory_counts", entityId: 1, action: "update",
                     actorCookId: "cook-1", payloadJson: "{not valid json", createdAt: "2026-05-10 12:00:00"),
        ]
        let out = VarianceAttributionCompute.countCorrections(audits: audits, closed: [])
        XCTAssertEqual(out.count, 1)
        XCTAssertNil(out[0].transition)
    }

    // Oracle unresolved: Mystery Burger in-window unresolved; Guac Bowl resolved (has component).
    func testUnresolvedDepletionsWindowed() {
        let sales = [
            SalesLineRow(itemName: "Mystery Burger", periodLabel: "2026-05-08", quantitySold: 4, netSales: 60),
            SalesLineRow(itemName: "Mystery Burger", periodLabel: "2026-04-15", quantitySold: 9, netSales: 135),
            SalesLineRow(itemName: "Guac Bowl", periodLabel: "2026-05-08", quantitySold: 2, netSales: 24),
        ]
        let comps = [CompRow(dishName: "Guac Bowl", componentType: "vendor_item", recipeSlug: nil,
                             vendorIngredient: "Avocado", qtyPerServing: 1, unit: "ea",
                             createdAt: "2026-01-01 00:00:00", updatedAt: "2026-01-01 00:00:00")]
        let r = VarianceAttributionCompute.unresolvedDepletions(sales: sales, components: comps,
            from: "2026-05-01", to: "2026-05-15", dateLikeCount: 3, totalCount: 3)
        XCTAssertEqual(r.items.count, 1)
        XCTAssertEqual(r.items[0].itemName, "Mystery Burger")
        XCTAssertEqual(r.items[0].periodLabel, "2026-05-08")
        XCTAssertEqual(r.items[0].qtySold, 4); XCTAssertEqual(r.items[0].netSales, 60)
        XCTAssertNil(r.note)
    }

    // Oracle: "treats punctuation and casing variants as resolved" — GUAC---BOWL!!! resolves to Guac Bowl.
    func testUnresolvedNormalizationResolvesVariants() {
        let sales = [SalesLineRow(itemName: "GUAC---BOWL!!!", periodLabel: "2026-05-08", quantitySold: 2, netSales: 24)]
        let comps = [CompRow(dishName: "Guac Bowl", componentType: "vendor_item", recipeSlug: nil,
                             vendorIngredient: "Avocado", qtyPerServing: 1, unit: "ea", createdAt: nil, updatedAt: nil)]
        let r = VarianceAttributionCompute.unresolvedDepletions(sales: sales, components: comps,
            from: "2026-05-01", to: "2026-05-15", dateLikeCount: 1, totalCount: 1)
        XCTAssertEqual(r.items.count, 0)
    }

    // Gap-fix: net_sales rounds with SQLite ROUND(x,2) (round-half-AWAY-from-zero),
    // NOT JS Math.round (round-toward-+infinity) — lib/varianceAttribution.ts:450
    // computes `ROUND(SUM(net_sales), 2)` in raw SQL. These two modes diverge on
    // negative half-ties: summed net_sales -60.005 → SQLite -60.01, but the old
    // jsRound-based `round2` would give -60.00. This pins the away-from-zero mode.
    func testUnresolvedDepletionsNetSalesNegativeTieRoundsAwayFromZero() {
        let sales = [
            SalesLineRow(itemName: "Refund Combo", periodLabel: "2026-05-08", quantitySold: 1, netSales: -30.0025),
            SalesLineRow(itemName: "Refund Combo", periodLabel: "2026-05-08", quantitySold: 1, netSales: -30.0025),
        ]
        let r = VarianceAttributionCompute.unresolvedDepletions(sales: sales, components: [],
            from: "2026-05-01", to: "2026-05-15", dateLikeCount: 2, totalCount: 2)
        XCTAssertEqual(r.items.count, 1)
        // Sum = -60.005 exactly (as a Double literal sum of two -30.0025s).
        XCTAssertEqual(r.items[0].netSales, -60.01)
    }

    // Companion positive-tie case: positive half-ties agree between SQLite ROUND
    // and JS Math.round, so this must stay green regardless of which mode is used —
    // guards against the fix flipping the sign convention.
    func testUnresolvedDepletionsNetSalesPositiveTieRoundsAwayFromZero() {
        let sales = [
            SalesLineRow(itemName: "Bundle Combo", periodLabel: "2026-05-08", quantitySold: 1, netSales: 30.0025),
            SalesLineRow(itemName: "Bundle Combo", periodLabel: "2026-05-08", quantitySold: 1, netSales: 30.0025),
        ]
        let r = VarianceAttributionCompute.unresolvedDepletions(sales: sales, components: [],
            from: "2026-05-01", to: "2026-05-15", dateLikeCount: 1, totalCount: 1)
        XCTAssertEqual(r.items.count, 1)
        XCTAssertEqual(r.items[0].netSales, 60.01)
    }

    // Gap-fix: SQLite sorts NULL as smallest, so in `ORDER BY net_sales DESC` a NULL
    // net_sales group must land strictly LAST — after every non-NULL group, including
    // negative ones. Coalescing nil→0 (as the old comparator did) would wrongly place
    // a NULL-net group ahead of a negative-net group.
    func testUnresolvedDepletionsNullNetSalesSortsStrictlyLast() {
        let sales = [
            // NULL net_sales (quantity present, dollars never recorded).
            SalesLineRow(itemName: "Comp Item", periodLabel: "2026-05-08", quantitySold: 3, netSales: nil),
            // Negative net_sales (refund) — should still outrank the NULL group in DESC order.
            SalesLineRow(itemName: "Refunded Item", periodLabel: "2026-05-09", quantitySold: 1, netSales: -10),
            // Positive net_sales — should sort first.
            SalesLineRow(itemName: "Normal Item", periodLabel: "2026-05-10", quantitySold: 2, netSales: 40),
        ]
        let r = VarianceAttributionCompute.unresolvedDepletions(sales: sales, components: [],
            from: "2026-05-01", to: "2026-05-15", dateLikeCount: 3, totalCount: 3)
        XCTAssertEqual(r.items.map(\.itemName), ["Normal Item", "Refunded Item", "Comp Item"])
    }

    // Oracle: "falls back to all-time with honest note" — non-date-like labels.
    func testUnresolvedAllTimeFallbackNote() {
        let sales = [SalesLineRow(itemName: "Legacy Item", periodLabel: "Lunch FY26", quantitySold: 7, netSales: 70)]
        let r = VarianceAttributionCompute.unresolvedDepletions(sales: sales, components: [],
            from: "2026-05-01", to: "2026-05-15", dateLikeCount: 0, totalCount: 1)
        XCTAssertEqual(r.items.count, 1)
        XCTAssertEqual(r.items[0].itemName, "Legacy Item")
        XCTAssertTrue(r.note!.contains("not date-like"))
    }

    func testNormalizeDishName() {
        XCTAssertEqual(VarianceAttributionCompute.normalizeDishName("GUAC---BOWL!!!"), "guac bowl")
        XCTAssertEqual(VarianceAttributionCompute.normalizeDishName(nil), "")
        XCTAssertEqual(VarianceAttributionCompute.normalizeDishName("  Mtn  Mac & Cheese "), "mtn mac cheese")
    }

    // Gap-fix: all-punctuation input collapses to empty string (JS "---".replace(...).trim() === "").
    func testNormalizeDishNameAllSeparatorsCollapsesToEmpty() {
        XCTAssertEqual(VarianceAttributionCompute.normalizeDishName("---"), "")
        XCTAssertEqual(VarianceAttributionCompute.normalizeDishName(""), "")
    }

    // Gap-fix: numeric-string input is truthy in JS (`!s` is false for "0"), so it is
    // normalized (not short-circuited to "") — matches the Swift `!s.isEmpty` guard.
    func testNormalizeDishNameNumericStringIsNormalizedNotShortCircuited() {
        XCTAssertEqual(VarianceAttributionCompute.normalizeDishName("0"), "0")
    }
}
