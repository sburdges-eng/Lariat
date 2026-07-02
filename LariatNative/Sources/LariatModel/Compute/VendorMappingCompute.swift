import Foundation

/// Pure port of the compute pieces of `lib/vendorMapping.ts` (catalog key
/// round-trip, pack label, limit clamp) plus `deriveMasterId` from
/// `lib/ingredientKey.ts`. No I/O; the SQL lives in
/// `LariatDB/VendorMappingRepository` / `VendorMappingWriteRepository`.
///
/// `deriveMasterId` REUSES `IngredientKey.normalize` (the A4.1 byte-exact port
/// of `normalizeIngredientKey`) — the web function is literally
/// `normalizeIngredientKey(x).replace(/ /g, '_')`, so no re-port.
public enum VendorMappingCompute {
    static let defaultLimit = 50
    static let maxLimit = 200

    /// The `\x1f` (UNIT SEPARATOR) delimiter of `catalogKeyString`.
    static let keySeparator = "\u{1F}"

    /// `clampLimit` (vendorMapping.ts L43-48): nil → 50, clamp [1, 200].
    public static func clampLimit(_ raw: Int?) -> Int {
        guard let raw else { return defaultLimit }
        return max(1, min(maxLimit, raw))
    }

    /// `normVendor` — `(v ?? '').trim().toLowerCase()`.
    public static func normVendor(_ v: String?) -> String {
        (v ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// `isCompareVendor` — normalized string is one of sysco/shamrock.
    public static func compareVendor(_ v: String?) -> CompareVendor? {
        CompareVendor(rawValue: normVendor(v))
    }

    /// `deriveMasterId` (lib/ingredientKey.ts L34-38): normalize, nil when the
    /// input normalizes to empty, else spaces → underscores.
    /// "Chicken Breast" → "chicken_breast".
    public static func deriveMasterId(_ recipeIngredient: String?) -> String? {
        let norm = IngredientKey.normalize(recipeIngredient)
        if norm.isEmpty { return nil }
        return norm.replacingOccurrences(of: " ", with: "_")
    }

    /// `catalogKeyString` (vendorMapping.ts L65-67) — vendor is normalized; sku
    /// and ingredient pass through verbatim.
    public static func catalogKeyString(_ key: CatalogKey) -> String {
        "\(normVendor(key.vendor))\(keySeparator)\(key.sku)\(keySeparator)\(key.ingredient)"
    }

    /// `parseCatalogKeyString` (vendorMapping.ts L69-78). Fewer than 3 parts,
    /// a non-compare vendor, or an empty sku/ingredient → nil. Extra `\x1f`
    /// separators re-join into the ingredient (JS `parts.slice(2).join('\x1f')`).
    public static func parseCatalogKeyString(_ raw: String) -> CatalogKey? {
        let parts = raw.components(separatedBy: keySeparator)
        guard parts.count >= 3 else { return nil }
        guard let vendor = compareVendor(parts[0]) else { return nil }
        let sku = parts[1]
        let ingredient = parts[2...].joined(separator: keySeparator)
        guard !sku.isEmpty, !ingredient.isEmpty else { return nil }
        return CatalogKey(vendor: vendor.rawValue, sku: sku, ingredient: ingredient)
    }

    /// `packLabel` (vendorMapping.ts L58-63). NOTE: intentionally different from
    /// `VendorCompareCompute.packLabel` — this variant does not trim the unit and
    /// falls back to the bare pack size when the unit is missing. Web behavior:
    ///   size=nil unit=nil/'' → nil
    ///   size=nil unit='lb'  → 'lb'
    ///   size=5   unit='lb'  → '5 lb'
    ///   size=5   unit=nil/'' → '5'
    public static func packLabel(packSize: Double?, packUnit: String?) -> String? {
        // JS: if (row.pack_size == null && !row.pack_unit) return null;
        let unitFalsy = packUnit == nil || packUnit!.isEmpty
        if packSize == nil && unitFalsy { return nil }
        let u = packUnit ?? ""
        guard let packSize else { return u.isEmpty ? nil : u }
        let size = VendorCompareCompute.jsNumberString(packSize)
        return u.isEmpty ? size : "\(size) \(u)"
    }
}
