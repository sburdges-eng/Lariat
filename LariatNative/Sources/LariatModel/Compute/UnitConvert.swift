import Foundation

/// Byte-exact port of the subset of `lib/unitConvert.mjs` that `computeRecipeRatio`
/// needs: normalizeUnit + unitDimension + convertQty (identity, same-dim, cross-dim).
/// Python (scripts/lib/units.py) is authoritative; JS mirrors it and we mirror JS.
/// `bridgeCount` / `convertPackSizeToLineUnit` are intentionally NOT ported here
/// (T4/T5 count-bridge territory, out of scope for the depletion-exception board).
public enum UnitConvert {
    static let weightToG: [String: Double] = [
        "mg": 0.001, "g": 1.0, "gram": 1.0, "grams": 1.0, "kg": 1000.0,
        "oz": 28.3495231, "lb": 453.59237, "lbs": 453.59237,
        "pound": 453.59237, "pounds": 453.59237,
    ]
    static let volumeToMl: [String: Double] = [
        "ml": 1.0, "l": 1000.0, "liter": 1000.0, "litre": 1000.0,
        "tsp": 4.92892159, "tbsp": 14.78676478, "floz": 29.5735296,
        "fl_oz": 29.5735296, "fl oz": 29.5735296, "cup": 236.5882365,
        "cups": 236.5882365, "pt": 473.176473, "pint": 473.176473,
        "qt": 946.352946, "quart": 946.352946, "gal": 3785.411784, "gallon": 3785.411784,
    ]
    static let countToEa: [String: Double] = [
        "ea": 1.0, "each": 1.0, "pc": 1.0, "pcs": 1.0, "ct": 1.0, "count": 1.0,
        "pk": 1.0, "pack": 1.0, "cs": 1.0, "case": 1.0, "bag": 1.0, "bottle": 1.0,
        "btl": 1.0, "can": 1.0, "cn": 1.0, "jar": 1.0, "bunch": 1.0, "box": 1.0,
        "slice": 1.0, "sprig": 1.0, "clove": 1.0, "doz": 12.0, "dozen": 12.0,
    ]
    static let synonyms: [String: String] = [
        "": "", "pound": "lb", "pounds": "lb", "lbs": "lb", "ounce": "oz", "ounces": "oz",
        "gram": "g", "grams": "g", "kilogram": "kg", "kilograms": "kg",
        "milligram": "mg", "milligrams": "mg", "liter": "l", "litre": "l", "liters": "l",
        "millilitre": "ml", "milliliter": "ml", "milliliters": "ml",
        "teaspoon": "tsp", "teaspoons": "tsp", "tablespoon": "tbsp", "tablespoons": "tbsp",
        "fluid_ounce": "floz", "fluid ounce": "floz", "fl_oz": "floz", "fl oz": "floz",
        "cups": "cup", "pint": "pt", "pints": "pt", "quart": "qt", "quarts": "qt",
        "gallon": "gal", "gallons": "gal", "each": "ea", "pcs": "pc", "count": "ct",
        "pack": "pk", "packs": "pk", "case": "cs", "cases": "cs", "bags": "bag",
        "bottles": "bottle", "btl": "bottle", "cans": "can", "#10 can": "can",
        "#10_can": "can", "jars": "jar", "bunches": "bunch", "boxes": "box",
        "slices": "slice", "sprigs": "sprig", "cloves": "clove", "dozen": "doz", "dozens": "doz",
    ]

    public static func normalizeUnit(_ raw: String?) -> String {
        guard let raw else { return "" }
        let s = raw.trimmingCharacters(in: .whitespaces).lowercased()
        if s.isEmpty { return "" }
        return synonyms[s] ?? s
    }

    public static func unitDimension(_ canon: String) -> String? {
        if weightToG[canon] != nil { return "weight" }
        if volumeToMl[canon] != nil { return "volume" }
        if countToEa[canon] != nil { return "count" }
        return nil
    }

    public static func convertQty(_ qty: Double, from fromUnit: String?, to toUnit: String?, gPerMl: Double?) -> Double? {
        guard qty.isFinite else { return nil }
        let from = normalizeUnit(fromUnit)
        let to = normalizeUnit(toUnit)
        if from.isEmpty || to.isEmpty { return nil }
        if from == to { return qty }                                  // identity (incl. count)
        guard let fromDim = unitDimension(from), let toDim = unitDimension(to) else { return nil }
        if fromDim == "count" || toDim == "count" { return nil }
        if fromDim == toDim {
            if fromDim == "weight" {
                guard let fg = weightToG[from], let tg = weightToG[to], fg > 0, tg > 0 else { return nil }
                return (qty * fg) / tg
            }
            guard let fm = volumeToMl[from], let tm = volumeToMl[to], fm > 0, tm > 0 else { return nil }
            return (qty * fm) / tm
        }
        guard let d = gPerMl, d.isFinite, d > 0 else { return nil }
        if fromDim == "volume", toDim == "weight" {
            let g = qty * volumeToMl[from]! * d
            guard let tg = weightToG[to], tg > 0 else { return nil }
            return g / tg
        }
        if fromDim == "weight", toDim == "volume" {
            let ml = (qty * weightToG[from]!) / d
            guard let tm = volumeToMl[to], tm > 0 else { return nil }
            return ml / tm
        }
        return nil
    }
}
