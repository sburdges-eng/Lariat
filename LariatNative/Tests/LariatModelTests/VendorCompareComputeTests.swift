import XCTest
@testable import LariatModel

/// Value-parity port of the compute half of `lib/vendorCompare.ts`.
/// Parity oracle: `tests/js/test-vendor-compare.mjs` (`computeComparableUnitPrice`
/// describe block) plus targeted cases for every status/reason branch.
final class VendorCompareComputeTests: XCTestCase {

    private func row(
        vendor: String? = "Sysco", sku: String? = "S1", ingredient: String = "Thing",
        packSize: Double?, packUnit: String?, packPrice: Double?,
        unitPrice: Double?, reconciled: Double? = nil, masterId: String? = nil
    ) -> VendorPriceOfferRow {
        VendorPriceOfferRow(
            vendor: vendor, sku: sku, ingredient: ingredient,
            packSize: packSize, packUnit: packUnit, packPrice: packPrice,
            unitPrice: unitPrice, reconciledUnitPrice: reconciled, masterId: masterId
        )
    }

    // ── computeComparableUnitPrice ──────────────────────────────────────

    // Oracle: 'uses reconciled_unit_price when set'
    func testUsesReconciledUnitPriceWhenSet() {
        let r = VendorCompareCompute.computeComparableUnitPrice(
            row(packSize: 1, packUnit: "lb", packPrice: 10, unitPrice: 10, reconciled: 8.5),
            targetUnit: "lb"
        )
        XCTAssertEqual(r.status, .ok)
        XCTAssertEqual(r.price, 8.5)
        XCTAssertEqual(r.unit, "lb")
        XCTAssertNil(r.reason)
    }

    // Oracle: 'returns cannot_compare for incompatible units without bridge'
    // (gal → lb is volume↔weight with no density → 'need_density').
    func testCannotCompareForIncompatibleUnitsWithoutBridge() {
        let r = VendorCompareCompute.computeComparableUnitPrice(
            row(packSize: 1, packUnit: "gal", packPrice: 10, unitPrice: 10),
            targetUnit: "lb"
        )
        XCTAssertEqual(r.status, .cannotCompare)
        XCTAssertEqual(r.reason, "need_density")
    }

    // Price priority: reconciled > unit_price > pack_price/pack_size.
    func testPricePriorityFallbacks() {
        // unit_price wins when reconciled is nil
        let up = VendorCompareCompute.computeComparableUnitPrice(
            row(packSize: 1, packUnit: "lb", packPrice: 99, unitPrice: 10),
            targetUnit: "lb"
        )
        XCTAssertEqual(up.price, 10)
        // pack_price / pack_size when both above missing
        let pp = VendorCompareCompute.computeComparableUnitPrice(
            row(packSize: 4, packUnit: "lb", packPrice: 20, unitPrice: nil),
            targetUnit: "lb"
        )
        XCTAssertEqual(pp.price, 5)
        // non-positive reconciled is skipped (web guards rec > 0)
        let recZero = VendorCompareCompute.computeComparableUnitPrice(
            row(packSize: 1, packUnit: "lb", packPrice: 10, unitPrice: 10, reconciled: 0),
            targetUnit: "lb"
        )
        XCTAssertEqual(recZero.price, 10)
        // nothing usable → no_price
        let none = VendorCompareCompute.computeComparableUnitPrice(
            row(packSize: nil, packUnit: "lb", packPrice: nil, unitPrice: nil),
            targetUnit: "lb"
        )
        XCTAssertEqual(none.status, .cannotCompare)
        XCTAssertEqual(none.reason, "no_price")
    }

    // Synonyms collapse to the same canonical unit → price passes through.
    func testSynonymUnitsCompareAsEqual() {
        let r = VendorCompareCompute.computeComparableUnitPrice(
            row(packSize: 1, packUnit: "pounds", packPrice: 3.5, unitPrice: 3.5),
            targetUnit: "lb"
        )
        XCTAssertEqual(r.status, .ok)
        XCTAssertEqual(r.price, 3.5)
        XCTAssertEqual(r.unit, "lb")
    }

    // Unknown units → 'unknown_unit'.
    func testUnknownUnit() {
        let r = VendorCompareCompute.computeComparableUnitPrice(
            row(packSize: 1, packUnit: "blorp", packPrice: 10, unitPrice: 10),
            targetUnit: "lb"
        )
        XCTAssertEqual(r.status, .cannotCompare)
        XCTAssertEqual(r.reason, "unknown_unit")
    }

    // count vs weight → 'count_bridge'.
    func testCountBridge() {
        let r = VendorCompareCompute.computeComparableUnitPrice(
            row(packSize: 1, packUnit: "ea", packPrice: 10, unitPrice: 10),
            targetUnit: "lb"
        )
        XCTAssertEqual(r.status, .cannotCompare)
        XCTAssertEqual(r.reason, "count_bridge")
    }

    // count vs count with DIFFERENT canonical units: same dimension, but
    // convertQty refuses count conversions → 'unit_mismatch' (web branch order).
    func testCountVsCountDifferentCanonIsUnitMismatch() {
        let r = VendorCompareCompute.computeComparableUnitPrice(
            row(packSize: 1, packUnit: "ea", packPrice: 10, unitPrice: 10),
            targetUnit: "cs"
        )
        XCTAssertEqual(r.status, .cannotCompare)
        XCTAssertEqual(r.reason, "unit_mismatch")
    }

    // volume → weight WITH a density bridges fine.
    func testVolumeToWeightWithDensity() {
        let r = VendorCompareCompute.computeComparableUnitPrice(
            row(packSize: 1, packUnit: "gal", packPrice: 10, unitPrice: 10),
            targetUnit: "lb", densityGPerMl: 1.0
        )
        XCTAssertEqual(r.status, .ok)
        XCTAssertEqual(r.unit, "lb")
        // convertQty(10, gal→lb, ρ=1) = 10 * 3785.411784 / 453.59237
        XCTAssertEqual(r.price!, 10 * 3785.411784 / 453.59237, accuracy: 1e-9)
    }

    // PORTED WEB QUIRK (documented in the plan doc, asserted so a silent "fix"
    // trips this test): a $/oz price converted to $/lb goes through convertQty
    // as a quantity — price ÷ 16, not × 16.
    func testCrossWeightUnitConversionMatchesWebQuirk() {
        let r = VendorCompareCompute.computeComparableUnitPrice(
            row(packSize: 1, packUnit: "oz", packPrice: 16, unitPrice: 16),
            targetUnit: "lb"
        )
        XCTAssertEqual(r.status, .ok)
        XCTAssertEqual(r.price!, 16 * 28.3495231 / 453.59237, accuracy: 1e-9)   // ≈ 1.0, the web's ÷16
    }

    // ── pickTargetUnit ──────────────────────────────────────────────────

    func testPickTargetUnitAllWeightPrefersLb() {
        let offers = [
            row(packSize: 1, packUnit: "oz", packPrice: 1, unitPrice: 1),
            row(packSize: 1, packUnit: "lb", packPrice: 1, unitPrice: 1),
        ]
        XCTAssertEqual(VendorCompareCompute.pickTargetUnit(offers), "lb")
    }

    func testPickTargetUnitSameNonWeightUnit() {
        let offers = [
            row(packSize: 1, packUnit: "gal", packPrice: 1, unitPrice: 1),
            row(packSize: 1, packUnit: "gallon", packPrice: 1, unitPrice: 1),   // synonym → gal
        ]
        XCTAssertEqual(VendorCompareCompute.pickTargetUnit(offers), "gal")
    }

    func testPickTargetUnitMixedDimensionsIsNil() {
        let offers = [
            row(packSize: 1, packUnit: "gal", packPrice: 1, unitPrice: 1),
            row(packSize: 1, packUnit: "lb", packPrice: 1, unitPrice: 1),
        ]
        XCTAssertNil(VendorCompareCompute.pickTargetUnit(offers))
    }

    func testPickTargetUnitNoKnownUnitsIsNil() {
        let offers = [row(packSize: 1, packUnit: nil, packPrice: 1, unitPrice: 1)]
        XCTAssertNil(VendorCompareCompute.pickTargetUnit(offers))
    }

    // One known weight unit + one missing unit: dims=['weight'] → 'lb'
    // (JS `.filter(Boolean)` drops the unknown before the every() check).
    func testPickTargetUnitIgnoresMissingUnitWhenRestIsWeight() {
        let offers = [
            row(packSize: 1, packUnit: "lb", packPrice: 1, unitPrice: 1),
            row(packSize: 1, packUnit: nil, packPrice: 1, unitPrice: 1),
        ]
        XCTAssertEqual(VendorCompareCompute.pickTargetUnit(offers), "lb")
    }

    // ── pickCheaper ─────────────────────────────────────────────────────

    private func offer(_ vendor: CompareVendor, price: Double?, status: CompareOfferStatus = .ok) -> VendorOfferSnapshot {
        VendorOfferSnapshot(
            vendor: vendor, sku: "X", packLabel: nil,
            normalizedPrice: price, normalizedUnit: "lb", status: status,
            reason: status == .ok ? nil : "no_price"
        )
    }

    func testPickCheaperNoPreference() {
        XCTAssertEqual(
            VendorCompareCompute.pickCheaper(
                sysco: offer(.sysco, price: 3.5), shamrock: offer(.shamrock, price: 3.2),
                preferred: nil, locked: false
            ),
            .shamrock
        )
        XCTAssertEqual(
            VendorCompareCompute.pickCheaper(
                sysco: offer(.sysco, price: 3.0), shamrock: offer(.shamrock, price: 3.2),
                preferred: nil, locked: false
            ),
            .sysco
        )
        // tie → nil
        XCTAssertNil(
            VendorCompareCompute.pickCheaper(
                sysco: offer(.sysco, price: 3.2), shamrock: offer(.shamrock, price: 3.2),
                preferred: nil, locked: false
            )
        )
    }

    // Oracle: 'does not flag cheaper when quality locked'
    func testPickCheaperLockedIsNil() {
        XCTAssertNil(
            VendorCompareCompute.pickCheaper(
                sysco: offer(.sysco, price: 3.5), shamrock: offer(.shamrock, price: 3.2),
                preferred: "sysco", locked: true
            )
        )
    }

    // Preference-override: only the OTHER vendor being strictly cheaper flags.
    func testPickCheaperPreferenceOverride() {
        // preferred sysco, shamrock cheaper → flag shamrock
        XCTAssertEqual(
            VendorCompareCompute.pickCheaper(
                sysco: offer(.sysco, price: 3.5), shamrock: offer(.shamrock, price: 3.2),
                preferred: "sysco", locked: false
            ),
            .shamrock
        )
        // preferred sysco, sysco already cheaper → nil
        XCTAssertNil(
            VendorCompareCompute.pickCheaper(
                sysco: offer(.sysco, price: 3.0), shamrock: offer(.shamrock, price: 3.2),
                preferred: "sysco", locked: false
            )
        )
        // preferred shamrock, sysco cheaper → flag sysco (case/space-insensitive pref)
        XCTAssertEqual(
            VendorCompareCompute.pickCheaper(
                sysco: offer(.sysco, price: 3.0), shamrock: offer(.shamrock, price: 3.2),
                preferred: " Shamrock ", locked: false
            ),
            .sysco
        )
    }

    func testPickCheaperRequiresBothOkWithPrices() {
        XCTAssertNil(
            VendorCompareCompute.pickCheaper(
                sysco: offer(.sysco, price: nil, status: .cannotCompare),
                shamrock: offer(.shamrock, price: 3.2),
                preferred: nil, locked: false
            )
        )
        XCTAssertNil(
            VendorCompareCompute.pickCheaper(
                sysco: nil, shamrock: offer(.shamrock, price: 3.2), preferred: nil, locked: false
            )
        )
    }

    // ── packLabel (compare variant) + clampLimit ────────────────────────

    func testPackLabelCompareVariant() {
        XCTAssertEqual(
            VendorCompareCompute.packLabel(row(packSize: 5, packUnit: "lb", packPrice: 1, unitPrice: 1)),
            "5 lb"
        )
        XCTAssertEqual(
            VendorCompareCompute.packLabel(row(packSize: 2.5, packUnit: " lb ", packPrice: 1, unitPrice: 1)),
            "2.5 lb"
        )
        XCTAssertEqual(
            VendorCompareCompute.packLabel(row(packSize: nil, packUnit: "lb", packPrice: 1, unitPrice: 1)),
            "lb"
        )
        XCTAssertNil(
            VendorCompareCompute.packLabel(row(packSize: 5, packUnit: nil, packPrice: 1, unitPrice: 1))
        )
    }

    func testClampLimit() {
        XCTAssertEqual(VendorCompareCompute.clampLimit(nil), 200)
        XCTAssertEqual(VendorCompareCompute.clampLimit(0), 1)
        XCTAssertEqual(VendorCompareCompute.clampLimit(5000), 1000)
        XCTAssertEqual(VendorCompareCompute.clampLimit(7), 7)
    }
}
