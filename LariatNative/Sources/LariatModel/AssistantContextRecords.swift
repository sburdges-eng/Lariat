import Foundation

// Row/cache types feeding `AssistantContextCompute` — shapes mirror
// `lib/kitchenAssistantContext.ts` + `lib/data.ts`.

/// Full recipe shape from `data/cache/recipes.json` (`Recipe` in lib/data.ts).
/// `BridgeRecipe` (dish-cost bridge) only carries slug/name/menu_items — the
/// assistant needs the whole card.
public struct AssistantRecipe: Codable, Sendable, Equatable {
    public struct Ingredient: Codable, Sendable, Equatable {
        public let item: String?
        public let qty: JSONNumberOrString?
        public let unit: String?

        public init(item: String?, qty: JSONNumberOrString?, unit: String?) {
            self.item = item
            self.qty = qty
            self.unit = unit
        }
    }

    public let slug: String?
    public let name: String?
    public let station: String?
    public let yieldQty: JSONNumberOrString?
    public let yieldUnit: String?
    public let ingredients: [Ingredient]?
    public let procedure: String?
    public let allergens: [String]?
    public let menuItems: [String]?
    public let subRecipes: [String]?

    enum CodingKeys: String, CodingKey {
        case slug, name, station, ingredients, procedure, allergens
        case yieldQty = "yield_qty"
        case yieldUnit = "yield_unit"
        case menuItems = "menu_items"
        case subRecipes = "sub_recipes"
    }

    public init(
        slug: String?, name: String?, station: String? = nil,
        yieldQty: JSONNumberOrString? = nil, yieldUnit: String? = nil,
        ingredients: [Ingredient]? = nil, procedure: String? = nil,
        allergens: [String]? = nil, menuItems: [String]? = nil, subRecipes: [String]? = nil
    ) {
        self.slug = slug
        self.name = name
        self.station = station
        self.yieldQty = yieldQty
        self.yieldUnit = yieldUnit
        self.ingredients = ingredients
        self.procedure = procedure
        self.allergens = allergens
        self.menuItems = menuItems
        self.subRecipes = subRecipes
    }
}

/// JSON fields that are `number | string | null` on the web.
public enum JSONNumberOrString: Codable, Sendable, Equatable {
    case number(Double)
    case string(String)

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let n = try? c.decode(Double.self) { self = .number(n); return }
        self = .string(try c.decode(String.self))
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .number(let n): try c.encode(n)
        case .string(let s): try c.encode(s)
        }
    }

    /// JS template-literal rendering (`${qty}`).
    public var display: String {
        switch self {
        case .number(let n): return JsValueFormat.numberString(n)
        case .string(let s): return s
        }
    }
}

/// `MenuItem` in lib/data.ts (menu.json).
public struct AssistantMenuItem: Codable, Sendable, Equatable {
    public let displayName: String?
    public let recipeSlug: String?

    enum CodingKeys: String, CodingKey {
        case displayName = "display_name"
        case recipeSlug = "recipe_slug"
    }

    public init(displayName: String?, recipeSlug: String? = nil) {
        self.displayName = displayName
        self.recipeSlug = recipeSlug
    }
}

/// `AllergenEntry` / `AllergenMatrix` in lib/data.ts (allergen_matrix.json).
public struct AssistantAllergenEntry: Codable, Sendable, Equatable {
    public let ingredient: String
    public let big9: [String]?

    public init(ingredient: String, big9: [String]?) {
        self.ingredient = ingredient
        self.big9 = big9
    }
}

public typealias AssistantAllergenMatrix = [String: [AssistantAllergenEntry]]

/// One HACCP CCP row from food_safety.json.
public struct AssistantHaccpCcp: Codable, Sendable, Equatable {
    public let ccpId: String?
    public let criticalControlPoint: String?
    public let hazard: String?
    public let criticalLimit: String?
    public let monitoringProcedure: String?
    public let correctiveAction: String?

    enum CodingKeys: String, CodingKey {
        case ccpId = "ccp_id"
        case criticalControlPoint = "critical_control_point"
        case hazard
        case criticalLimit = "critical_limit"
        case monitoringProcedure = "monitoring_procedure"
        case correctiveAction = "corrective_action"
    }

    public init(ccpId: String?, criticalControlPoint: String?, hazard: String?, criticalLimit: String?, monitoringProcedure: String?, correctiveAction: String?) {
        self.ccpId = ccpId
        self.criticalControlPoint = criticalControlPoint
        self.hazard = hazard
        self.criticalLimit = criticalLimit
        self.monitoringProcedure = monitoringProcedure
        self.correctiveAction = correctiveAction
    }
}

public struct AssistantFoodSafetyData: Codable, Sendable, Equatable {
    public let ccps: [AssistantHaccpCcp]?

    public init(ccps: [AssistantHaccpCcp]?) {
        self.ccps = ccps
    }
}

/// `VendorSummary` (vendor_summary.json) — only the fields the renderer reads.
public struct AssistantVendorSummary: Codable, Sendable, Equatable {
    public struct Sysco: Codable, Sendable, Equatable {
        public struct Item: Codable, Sendable, Equatable {
            public let description: String?
            public let category: String?
            public let packSize: String?
            public let price: Double?

            enum CodingKeys: String, CodingKey {
                case description, category, price
                case packSize = "pack_size"
            }

            public init(description: String?, category: String?, packSize: String?, price: Double?) {
                self.description = description
                self.category = category
                self.packSize = packSize
                self.price = price
            }
        }

        public let recentItems: [Item]?
        public let lastInvoiceDate: String?

        enum CodingKeys: String, CodingKey {
            case recentItems = "recent_items"
            case lastInvoiceDate = "last_invoice_date"
        }

        public init(recentItems: [Item]?, lastInvoiceDate: String?) {
            self.recentItems = recentItems
            self.lastInvoiceDate = lastInvoiceDate
        }
    }

    public let sysco: Sysco?

    public init(sysco: Sysco?) {
        self.sysco = sysco
    }
}

/// `LaborSummary` (labor_summary.json).
public struct AssistantLaborSummary: Codable, Sendable, Equatable {
    public struct Role: Codable, Sendable, Equatable {
        public let jobTitle: String?
        public let role: String?
        public let otHours: Double?
        public let totalHours: Double?
        public let totalCost: Double?
        public let laborPctNet: Double?

        enum CodingKeys: String, CodingKey {
            case role
            case jobTitle = "job_title"
            case otHours = "ot_hours"
            case totalHours = "total_hours"
            case totalCost = "total_cost"
            case laborPctNet = "labor_pct_net"
        }

        public init(jobTitle: String?, role: String?, otHours: Double?, totalHours: Double?, totalCost: Double?, laborPctNet: Double?) {
            self.jobTitle = jobTitle
            self.role = role
            self.otHours = otHours
            self.totalHours = totalHours
            self.totalCost = totalCost
            self.laborPctNet = laborPctNet
        }
    }

    public struct Employee: Codable, Sendable, Equatable {
        public let lastName: String?
        public let firstName: String?
        public let jobTitle: String?
        public let otHours: Double?
        public let totalHours: Double?
        public let totalCost: Double?

        enum CodingKeys: String, CodingKey {
            case lastName = "last_name"
            case firstName = "first_name"
            case jobTitle = "job_title"
            case otHours = "ot_hours"
            case totalHours = "total_hours"
            case totalCost = "total_cost"
        }

        public init(lastName: String?, firstName: String?, jobTitle: String?, otHours: Double?, totalHours: Double?, totalCost: Double?) {
            self.lastName = lastName
            self.firstName = firstName
            self.jobTitle = jobTitle
            self.otHours = otHours
            self.totalHours = totalHours
            self.totalCost = totalCost
        }
    }

    public let period: String?
    public let netSales: Double?
    public let laborCost: Double?
    public let laborPctNet: Double?
    public let splhNet: Double?
    public let byRole: [Role]?
    public let byEmployee: [Employee]?

    enum CodingKeys: String, CodingKey {
        case period
        case netSales = "net_sales"
        case laborCost = "labor_cost"
        case laborPctNet = "labor_pct_net"
        case splhNet = "splh_net"
        case byRole = "by_role"
        case byEmployee = "by_employee"
    }

    public init(period: String?, netSales: Double?, laborCost: Double?, laborPctNet: Double?, splhNet: Double?, byRole: [Role]?, byEmployee: [Employee]?) {
        self.period = period
        self.netSales = netSales
        self.laborCost = laborCost
        self.laborPctNet = laborPctNet
        self.splhNet = splhNet
        self.byRole = byRole
        self.byEmployee = byEmployee
    }
}

/// Loaders for the assistant's JSON caches — same graceful degradation as
/// `lib/data.ts` getters (missing/malformed → empty). I/O ⇒ model root, not
/// Compute/ (DishBridgeRecipeLoader precedent).
public enum AssistantDataCaches {
    public static func loadRecipes(
        env: [String: String] = ProcessInfo.processInfo.environment,
        cwd: String = FileManager.default.currentDirectoryPath
    ) -> [AssistantRecipe] {
        decode([AssistantRecipe].self, "recipes.json", env: env, cwd: cwd) ?? []
    }

    public static func loadMenu(
        env: [String: String] = ProcessInfo.processInfo.environment,
        cwd: String = FileManager.default.currentDirectoryPath
    ) -> [AssistantMenuItem] {
        decode([AssistantMenuItem].self, "menu.json", env: env, cwd: cwd) ?? []
    }

    public static func loadAllergenMatrix(
        env: [String: String] = ProcessInfo.processInfo.environment,
        cwd: String = FileManager.default.currentDirectoryPath
    ) -> AssistantAllergenMatrix {
        decode(AssistantAllergenMatrix.self, "allergen_matrix.json", env: env, cwd: cwd) ?? [:]
    }

    public static func loadFoodSafety(
        env: [String: String] = ProcessInfo.processInfo.environment,
        cwd: String = FileManager.default.currentDirectoryPath
    ) -> AssistantFoodSafetyData {
        decode(AssistantFoodSafetyData.self, "food_safety.json", env: env, cwd: cwd)
            ?? AssistantFoodSafetyData(ccps: [])
    }

    public static func loadVendorSummary(
        env: [String: String] = ProcessInfo.processInfo.environment,
        cwd: String = FileManager.default.currentDirectoryPath
    ) -> AssistantVendorSummary? {
        decode(AssistantVendorSummary.self, "vendor_summary.json", env: env, cwd: cwd)
    }

    public static func loadLaborSummary(
        env: [String: String] = ProcessInfo.processInfo.environment,
        cwd: String = FileManager.default.currentDirectoryPath
    ) -> AssistantLaborSummary? {
        decode(AssistantLaborSummary.self, "labor_summary.json", env: env, cwd: cwd)
    }

    private static func decode<T: Decodable>(
        _ type: T.Type, _ file: String, env: [String: String], cwd: String
    ) -> T? {
        let cacheDir = resolveCacheDirectory(env: env, cwd: cwd)
        let path = (cacheDir as NSString).appendingPathComponent(file)
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}
