import Foundation

/// Pure half of `lib/specialsPromotion.ts` — mapping cost-breakdown lines to
/// per-serving vendor components. The DB-touching half (vendor pack-unit
/// alignment, dish_components upsert, promotion record, audit row) lives in
/// `LariatDB.SpecialsRepository`.
public enum SpecialsPromotionCompute {
    /// `componentsFromBreakdown(breakdown, servings)`:
    ///   - no vendor `match` → skipped(reason: unmatched)
    ///   - non-finite / non-positive qty, or unusable unit → invalid_qty
    ///   - duplicate matches (case-insensitive) merge; a failed unit
    ///     conversion during the merge is skipped as invalid_qty
    public static func componentsFromBreakdown(
        _ breakdown: [CostBreakdownLine],
        servings: Double
    ) -> (components: [PromotedComponent], skipped: [SkippedComponent]) {
        var components: [PromotedComponent] = []
        var skipped: [SkippedComponent] = []

        for line in breakdown {
            let item = line.item ?? ""
            let match = (line.match ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if match.isEmpty {
                skipped.append(SkippedComponent(item: item, reason: .unmatched))
                continue
            }
            let qty = line.reqQty ?? Double.nan          // JS Number(undefined) → NaN
            let unit = (line.reqUnit ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let canonUnit = UnitConvert.normalizeUnit(unit)
            if !qty.isFinite || qty <= 0 || canonUnit.isEmpty {
                skipped.append(SkippedComponent(item: item.isEmpty ? match : item, reason: .invalidQty))
                continue
            }
            let qtyPerServing = qty / servings
            let key = match.lowercased()
            if let idx = components.firstIndex(where: { $0.vendorIngredient.lowercased() == key }) {
                guard let converted = UnitConvert.convertQty(
                    qtyPerServing, from: canonUnit, to: components[idx].unit, gPerMl: nil
                ) else {
                    skipped.append(SkippedComponent(item: item.isEmpty ? match : item, reason: .invalidQty))
                    continue
                }
                components[idx].qtyPerServing += converted
                continue
            }
            components.append(PromotedComponent(
                vendorIngredient: match,
                qtyPerServing: qtyPerServing,
                unit: canonUnit
            ))
        }
        return (components, skipped)
    }

    /// Servings default: positive finite number, else 1 (web coercion).
    public static func normalizedServings(_ raw: Double?) -> Double {
        guard let raw, raw.isFinite, raw > 0 else { return 1 }
        return raw
    }
}
