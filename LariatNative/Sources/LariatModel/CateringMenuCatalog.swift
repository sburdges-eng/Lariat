import Foundation

/// One catering-menu pick (`CateringMenuItem` in lib/data.ts), enriched with
/// the prep defaults that pre-populate a BEO line item's prep-sheet fields the
/// moment a cook picks it from the menu dropdown. Prep fields are optional:
/// items with no history (`data/cache/catering_prep_defaults.json`) simply
/// add with blank prep, exactly as before.
public struct CateringMenuItem: Codable, Sendable, Equatable, Identifiable {
    public var id: String { "\(category)|\(name)" }
    public let category: String
    public let name: String
    public let cost: Double
    /// Pre-Prep → `beo_line_items.prep_notes`.
    public let prepNotes: String
    /// Plating → `beo_line_items.secondary_prep_notes`.
    public let secondaryPrepNotes: String
    /// Ordering/purchasing note → `beo_line_items.order_items_notes`.
    public let orderItemsNotes: String
    /// How the item is sold + a typical order size, e.g. "per piece ·
    /// typically 50 pieces" / "per pan · typically 1 pan". Empty when the
    /// sidecar is absent.
    public let amountDescription: String
    /// Typical line quantity from invoice history — pre-fills the line so its
    /// Amount is realistic (50 sliders, not 1). Defaults to 1.
    public let defaultQuantity: Double

    public init(
        category: String, name: String, cost: Double,
        prepNotes: String = "", secondaryPrepNotes: String = "", orderItemsNotes: String = "",
        amountDescription: String = "", defaultQuantity: Double = 1
    ) {
        self.category = category
        self.name = name
        self.cost = cost
        self.prepNotes = prepNotes
        self.secondaryPrepNotes = secondaryPrepNotes
        self.orderItemsNotes = orderItemsNotes
        self.amountDescription = amountDescription
        self.defaultQuantity = defaultQuantity
    }

    /// True when picking this item pre-fills at least one prep-sheet field.
    public var hasPrepDefaults: Bool {
        !prepNotes.isEmpty || !secondaryPrepNotes.isEmpty || !orderItemsNotes.isEmpty
    }

    /// Only the base menu fields round-trip through `catering_menu.json`; the
    /// rest are merged from the sidecar after load, so they take defaults.
    enum CodingKeys: String, CodingKey { case category, name, cost }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.category = try c.decode(String.self, forKey: .category)
        self.name = try c.decode(String.self, forKey: .name)
        self.cost = try c.decode(Double.self, forKey: .cost)
        self.prepNotes = ""
        self.secondaryPrepNotes = ""
        self.orderItemsNotes = ""
        self.amountDescription = ""
        self.defaultQuantity = 1
    }
}

/// One line-defaults row (`catering_prep_defaults.json`, produced by
/// `scripts/ingest_catering_prep_defaults.py`), keyed in the file by the
/// normalized item name. Amount fields are optional so an older prep-only
/// cache still decodes.
struct CateringPrepDefault: Codable {
    let prep: String
    let plating: String
    let order: String
    var amountDesc: String?
    var typQty: Double?

    enum CodingKeys: String, CodingKey {
        case prep, plating, order
        case amountDesc = "amount_desc"
        case typQty = "typ_qty"
    }
}

/// Loads the catering menu from `data/cache/catering_menu.json` (the same
/// source the web's `getCateringMenu()` reads) and merges per-item prep
/// defaults from `data/cache/catering_prep_defaults.json`. Follows the
/// `StationCatalog.load()` precedent; NOT in `Compute/` because it does file
/// I/O. Web parity: missing/malformed menu cache → `[]`; a missing prep
/// sidecar just leaves every item's prep fields blank.
public enum CateringMenuCatalog {
    /// Match key shared with the Python ingest (`normalize` there): lowercased,
    /// whitespace-collapsed, trimmed — so `"Braised Chicken Taco Buffet "` and
    /// `"braised chicken taco buffet"` resolve to the same default.
    public static func normalize(_ name: String) -> String {
        name.lowercased()
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
    }

    public static func load(
        env: [String: String] = ProcessInfo.processInfo.environment,
        cwd: String = FileManager.default.currentDirectoryPath
    ) -> [CateringMenuItem] {
        let cacheDir = resolveCacheDirectory(env: env, cwd: cwd)
        return load(cacheDir: cacheDir)
    }

    /// Testable core — merge is exercised against a fixture cache dir.
    public static func load(cacheDir: String) -> [CateringMenuItem] {
        let menuPath = (cacheDir as NSString).appendingPathComponent("catering_menu.json")
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: menuPath)),
              let base = try? JSONDecoder().decode([CateringMenuItem].self, from: data)
        else { return [] }

        let defaults = loadPrepDefaults(cacheDir: cacheDir)
        guard !defaults.isEmpty else { return base }
        return base.map { item in
            guard let d = defaults[normalize(item.name)] else { return item }
            return CateringMenuItem(
                category: item.category, name: item.name, cost: item.cost,
                prepNotes: d.prep, secondaryPrepNotes: d.plating, orderItemsNotes: d.order,
                amountDescription: d.amountDesc ?? "",
                defaultQuantity: (d.typQty.map { $0 > 0 ? $0 : 1 }) ?? 1
            )
        }
    }

    /// `[normalized name: prep default]`; `[:]` when the sidecar is absent.
    static func loadPrepDefaults(cacheDir: String) -> [String: CateringPrepDefault] {
        let path = (cacheDir as NSString).appendingPathComponent("catering_prep_defaults.json")
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
              let map = try? JSONDecoder().decode([String: CateringPrepDefault].self, from: data)
        else { return [:] }
        // The file is already keyed by normalized name, but re-normalize
        // defensively so a hand-edited cache still matches.
        var out: [String: CateringPrepDefault] = [:]
        for (k, v) in map { out[normalize(k)] = v }
        return out
    }
}
