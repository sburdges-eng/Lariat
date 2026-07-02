import XCTest
@testable import LariatModel

/// Value-parity port of the compute pieces of `lib/vendorMapping.ts`
/// (catalog-key round-trip, mapping packLabel, clampLimit) and
/// `deriveMasterId` from `lib/ingredientKey.ts`.
/// Parity oracle: `tests/js/test-vendor-mapping.mjs` ('catalog key round-trip').
final class VendorMappingComputeTests: XCTestCase {

    // ── catalog key string round-trip ───────────────────────────────────

    // Oracle: 'catalog key round-trip'
    func testCatalogKeyRoundTrip() {
        let key = CatalogKey(vendor: "sysco", sku: "S1", ingredient: "Chicken")
        let raw = VendorMappingCompute.catalogKeyString(key)
        XCTAssertEqual(VendorMappingCompute.parseCatalogKeyString(raw), key)
    }

    func testCatalogKeyStringNormalizesVendor() {
        let key = CatalogKey(vendor: "  SYSCO ", sku: "S1", ingredient: "Chicken")
        XCTAssertEqual(
            VendorMappingCompute.catalogKeyString(key),
            "sysco\u{1F}S1\u{1F}Chicken"
        )
    }

    func testParseRejectsMalformedKeys() {
        // fewer than 3 parts
        XCTAssertNil(VendorMappingCompute.parseCatalogKeyString("sysco\u{1F}S1"))
        // non-compare vendor
        XCTAssertNil(VendorMappingCompute.parseCatalogKeyString("usfoods\u{1F}S1\u{1F}Chicken"))
        // empty sku
        XCTAssertNil(VendorMappingCompute.parseCatalogKeyString("sysco\u{1F}\u{1F}Chicken"))
        // empty ingredient
        XCTAssertNil(VendorMappingCompute.parseCatalogKeyString("sysco\u{1F}S1\u{1F}"))
    }

    // JS `parts.slice(2).join('\x1f')` — an ingredient containing the separator
    // survives the round-trip.
    func testParseRejoinsIngredientContainingSeparator() {
        let parsed = VendorMappingCompute.parseCatalogKeyString("shamrock\u{1F}H1\u{1F}A\u{1F}B")
        XCTAssertEqual(parsed, CatalogKey(vendor: "shamrock", sku: "H1", ingredient: "A\u{1F}B"))
    }

    // Vendor is normalized during parse (web normVendor before isCompareVendor).
    func testParseNormalizesVendorCase() {
        let parsed = VendorMappingCompute.parseCatalogKeyString(" Sysco \u{1F}S1\u{1F}Chicken")
        XCTAssertEqual(parsed?.vendor, "sysco")
    }

    // ── deriveMasterId (lib/ingredientKey.ts) ───────────────────────────

    func testDeriveMasterId() {
        XCTAssertEqual(VendorMappingCompute.deriveMasterId("Chicken Breast"), "chicken_breast")
        // punctuation collapses to separators (normalizeIngredientKey semantics)
        XCTAssertEqual(VendorMappingCompute.deriveMasterId("Ketchup — Heinz 1gal"), "ketchup_heinz_1gal")
        // bracketed prefix stripped
        XCTAssertEqual(VendorMappingCompute.deriveMasterId("[Sysco] Chicken Breast"), "chicken_breast")
        // normalizes to empty → nil (the web 'Staple name is too short.' trigger)
        XCTAssertNil(VendorMappingCompute.deriveMasterId("!!!"))
        XCTAssertNil(VendorMappingCompute.deriveMasterId(nil))
        XCTAssertNil(VendorMappingCompute.deriveMasterId("   "))
    }

    // ── packLabel (mapping variant — vendorMapping.ts L58-63) ───────────

    func testPackLabelMappingVariant() {
        XCTAssertNil(VendorMappingCompute.packLabel(packSize: nil, packUnit: nil))
        XCTAssertNil(VendorMappingCompute.packLabel(packSize: nil, packUnit: ""))
        XCTAssertEqual(VendorMappingCompute.packLabel(packSize: nil, packUnit: "lb"), "lb")
        XCTAssertEqual(VendorMappingCompute.packLabel(packSize: 5, packUnit: "lb"), "5 lb")
        XCTAssertEqual(VendorMappingCompute.packLabel(packSize: 0.25, packUnit: "lb"), "0.25 lb")
        // size present, unit falsy → bare size (differs from the compare variant)
        XCTAssertEqual(VendorMappingCompute.packLabel(packSize: 5, packUnit: nil), "5")
        XCTAssertEqual(VendorMappingCompute.packLabel(packSize: 5, packUnit: ""), "5")
    }

    // ── clampLimit ([1, 200] default 50) ────────────────────────────────

    func testClampLimit() {
        XCTAssertEqual(VendorMappingCompute.clampLimit(nil), 50)
        XCTAssertEqual(VendorMappingCompute.clampLimit(0), 1)
        XCTAssertEqual(VendorMappingCompute.clampLimit(999), 200)
        XCTAssertEqual(VendorMappingCompute.clampLimit(75), 75)
    }

    // ── vendor helpers ──────────────────────────────────────────────────

    func testCompareVendorNormalization() {
        XCTAssertEqual(VendorMappingCompute.compareVendor(" Shamrock "), .shamrock)
        XCTAssertEqual(VendorMappingCompute.compareVendor("SYSCO"), .sysco)
        XCTAssertNil(VendorMappingCompute.compareVendor("usfoods"))
        XCTAssertNil(VendorMappingCompute.compareVendor(nil))
        XCTAssertEqual(CompareVendor.sysco.counterpart, .shamrock)
        XCTAssertEqual(CompareVendor.shamrock.counterpart, .sysco)
    }
}
