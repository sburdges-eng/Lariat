import Foundation

/// Pure port of the compute half of `lib/vendorCompare.ts` — normalized
/// Sysco-vs-Shamrock unit-price comparison. No I/O; the SQL half lives in
/// `LariatDB/VendorCompareRepository`.
///
/// Unit math REUSES `UnitConvert` (A4.2 byte-exact port of `lib/unitConvert.mjs`)
/// — normalizeUnit / unitDimension / convertQty are NOT re-ported here.
///
/// ── Ported web quirk (flagged, not fixed) ───────────────────────────────────
/// `computeComparableUnitPrice` passes a PRICE ($/unit) through `convertQty` as
/// if it were a quantity, so a cross-unit conversion multiplies where a
/// per-unit price should divide (e.g. $/oz → $/lb yields price÷16, not ×16).
/// `pickTargetUnit` makes this rare (weight compares always target 'lb'; equal
/// canonical units skip conversion entirely) but it IS reachable for mixed
/// weight units. Ported faithfully per rule-parity policy; web-side fix
/// candidate recorded in the A4.4 plan doc.
public enum VendorCompareCompute {
    public static let compareVendors: [CompareVendor] = [.sysco, .shamrock]
    static let defaultLimit = 200
    static let maxLimit = 1000
    /// `WEIGHT_COMPARE_UNIT` — all-weight offer sets normalize to $/lb.
    public static let weightCompareUnit = "lb"

    /// `clampLimit` (vendorCompare.ts L69-74): nil → 200, clamp [1, 1000].
    public static func clampLimit(_ raw: Int?) -> Int {
        guard let raw else { return defaultLimit }
        return max(1, min(maxLimit, raw))
    }

    /// `normVendor` — `(v ?? '').trim().toLowerCase()`.
    public static func normVendor(_ v: String?) -> String {
        (v ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// `packLabel` (vendorCompare.ts L84-88). NOTE: vendorMapping.ts has its own
    /// slightly different packLabel — see `VendorMappingCompute.packLabel`.
    public static func packLabel(_ row: VendorPriceOfferRow) -> String? {
        // JS: if (row.pack_size == null || !row.pack_unit) return row.pack_unit ?? null;
        guard let packSize = row.packSize, let packUnit = row.packUnit, !packUnit.isEmpty else {
            return row.packUnit
        }
        let u = packUnit.trimmingCharacters(in: .whitespacesAndNewlines)
        return "\(jsNumberString(packSize)) \(u)".trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// JS number→string for template interpolation: integers print without a
    /// trailing ".0" ("5", not "5.0"); non-integers use Swift's shortest
    /// round-trip form, which matches JS for the decimal pack sizes seen in
    /// vendor data ("0.25", "1.5").
    static func jsNumberString(_ d: Double) -> String {
        if d.isFinite, d == d.rounded(.towardZero), abs(d) < 1e15 {
            return String(Int64(d))
        }
        return String(d)
    }

    /// `dollarPerPackUnit` (vendorCompare.ts L90-101) — price priority:
    /// reconciled_unit_price > unit_price > pack_price/pack_size. Non-finite or
    /// non-positive candidates are skipped, matching the web guards.
    static func dollarPerPackUnit(_ row: VendorPriceOfferRow) -> Double? {
        if let rec = row.reconciledUnitPrice, rec.isFinite, rec > 0 { return rec }
        if let up = row.unitPrice, up.isFinite, up > 0 { return up }
        if let pp = row.packPrice, let ps = row.packSize,
           pp.isFinite, ps.isFinite, ps > 0, pp > 0 {
            return pp / ps
        }
        return nil
    }

    /// `computeComparableUnitPrice` (vendorCompare.ts L110-152).
    /// Status/reason contract:
    ///   no price at all              → cannot_compare / 'no_price'
    ///   unknown pack or target unit  → cannot_compare / 'unknown_unit'
    ///   same canonical unit          → ok (price unchanged)
    ///   same dimension, unconvertible→ cannot_compare / 'unit_mismatch'
    ///   count vs non-count           → cannot_compare / 'count_bridge'
    ///   weight↔volume, no density    → cannot_compare / 'need_density'
    public static func computeComparableUnitPrice(
        _ row: VendorPriceOfferRow,
        targetUnit: String,
        densityGPerMl: Double? = nil
    ) -> ComparableUnitPriceResult {
        guard let perUnit = dollarPerPackUnit(row) else {
            return ComparableUnitPriceResult(price: nil, unit: nil, status: .cannotCompare, reason: "no_price")
        }

        let packCanon = UnitConvert.normalizeUnit(row.packUnit)
        let targetCanon = UnitConvert.normalizeUnit(targetUnit)
        if packCanon.isEmpty || targetCanon.isEmpty {
            return ComparableUnitPriceResult(price: nil, unit: nil, status: .cannotCompare, reason: "unknown_unit")
        }
        if packCanon == targetCanon {
            return ComparableUnitPriceResult(price: perUnit, unit: targetCanon, status: .ok, reason: nil)
        }

        guard let packDim = UnitConvert.unitDimension(packCanon),
              let targetDim = UnitConvert.unitDimension(targetCanon) else {
            return ComparableUnitPriceResult(price: nil, unit: nil, status: .cannotCompare, reason: "unknown_unit")
        }

        if packDim == targetDim {
            guard let converted = UnitConvert.convertQty(perUnit, from: packCanon, to: targetCanon, gPerMl: densityGPerMl),
                  converted.isFinite else {
                return ComparableUnitPriceResult(price: nil, unit: nil, status: .cannotCompare, reason: "unit_mismatch")
            }
            return ComparableUnitPriceResult(price: converted, unit: targetCanon, status: .ok, reason: nil)
        }

        if packDim == "count" || targetDim == "count" {
            return ComparableUnitPriceResult(price: nil, unit: nil, status: .cannotCompare, reason: "count_bridge")
        }

        guard let converted = UnitConvert.convertQty(perUnit, from: packCanon, to: targetCanon, gPerMl: densityGPerMl),
              converted.isFinite else {
            return ComparableUnitPriceResult(price: nil, unit: nil, status: .cannotCompare, reason: "need_density")
        }
        return ComparableUnitPriceResult(price: converted, unit: targetCanon, status: .ok, reason: nil)
    }

    /// `pickTargetUnit` (vendorCompare.ts L154-163): all-weight → 'lb'; all the
    /// same canonical unit → that unit; otherwise nil (offer becomes
    /// 'unit_mismatch' via `buildOffer`).
    public static func pickTargetUnit(_ offers: [VendorPriceOfferRow]) -> String? {
        let dims = offers.compactMap { UnitConvert.unitDimension(UnitConvert.normalizeUnit($0.packUnit)) }
        if dims.isEmpty { return nil }
        if dims.allSatisfy({ $0 == "weight" }) { return weightCompareUnit }
        let units = offers.map { UnitConvert.normalizeUnit($0.packUnit) }.filter { !$0.isEmpty }
        if let first = units.first, units.allSatisfy({ $0 == first }) { return first }
        return nil
    }

    /// `buildOffer` (vendorCompare.ts L193-220).
    public static func buildOffer(
        vendor: CompareVendor,
        row: VendorPriceOfferRow,
        targetUnit: String?,
        density: Double?
    ) -> VendorOfferSnapshot {
        guard let targetUnit else {
            return VendorOfferSnapshot(
                vendor: vendor, sku: row.sku, packLabel: packLabel(row),
                normalizedPrice: nil, normalizedUnit: nil,
                status: .cannotCompare, reason: "unit_mismatch"
            )
        }
        let comp = computeComparableUnitPrice(row, targetUnit: targetUnit, densityGPerMl: density)
        return VendorOfferSnapshot(
            vendor: vendor, sku: row.sku, packLabel: packLabel(row),
            normalizedPrice: comp.price, normalizedUnit: comp.unit,
            status: comp.status, reason: comp.reason
        )
    }

    /// `pickCheaper` (vendorCompare.ts L222-243). quality_locked → nil (never
    /// flag a locked master). With a preference set, only the OTHER vendor being
    /// strictly cheaper flags (the preference-override signal); with no
    /// preference, the strictly cheaper vendor flags; ties → nil.
    public static func pickCheaper(
        sysco: VendorOfferSnapshot?,
        shamrock: VendorOfferSnapshot?,
        preferred: String?,
        locked: Bool
    ) -> CompareVendor? {
        if locked { return nil }
        guard let sysco, let shamrock else { return nil }
        guard sysco.status == .ok, shamrock.status == .ok else { return nil }
        guard let s = sysco.normalizedPrice, let h = shamrock.normalizedPrice else { return nil }

        let pref = normVendor(preferred)
        if pref == "sysco", h < s { return .shamrock }
        if pref == "shamrock", s < h { return .sysco }
        if pref.isEmpty {
            if s < h { return .sysco }
            if h < s { return .shamrock }
        }
        return nil
    }
}
