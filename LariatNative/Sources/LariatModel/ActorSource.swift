import Foundation

/// Phase C3 — the canonical `actor_source` taxonomy (spec §C3).
///
/// Every regulated write records who made it via `audit_events.actor_source`.
/// Today those literals are spread across ~17 web surfaces plus the three
/// native writers. Phase C makes native the system of record, so the union
/// becomes a single owned enum here in `LariatModel`, and the C4 reconciliation
/// checker (`scripts/phase-c-reconcile.mjs :: CANONICAL_ACTOR_SOURCES`) mirrors
/// this exact set — a row whose `actor_source` is outside it fails reconcile.
///
/// Historical rows are **never rewritten** (§C3): this taxonomy governs new
/// writes only. The values are frozen strings — do not rename a case's
/// `rawValue` without a data migration.
///
/// Provenance (first web occurrence; native writers cite their Swift home):
///  - api                        app/api/reservations/[id]/route.js
///  - beo_client_share           app/api/beo/share/[token]/sign/route.js (edge-retained writer)
///  - box_office                 lib/boxOfficeRepo.ts
///  - cook_ui                    app/api/breaks/route.js
///  - dice_ingest                lib/boxOfficeRepo.ts
///  - kds_app                    app/api/kds/tickets/[id]/bump/route.js (also the native KDS writer)
///  - kds_login                  app/api/auth/temp-pin/login/route.js
///  - kitchen_assistant          app/api/kitchen-assistant/route.js
///  - kitchen_assistant_undo     lib/kitchenAssistantUndo.ts
///  - management_ui              app/api/recipes/[slug]/route.js
///  - manager_pin                app/api/gold-stars/[id]/route.ts
///  - manager_ui                 app/api/auth/temp-pin/revoke/route.js
///  - pic_ui                     app/api/sick-worker/route.js
///  - prism_backfill             scripts/import-prism-deals.mjs
///  - receiving_closed_loop      app/api/receiving/route.js
///  - receiving_match_resolution app/api/receiving/matches/[id]/route.js
///  - sales_depletion            lib/salesDepletion.ts
///  - native_cook / native_mac   LariatModel/AuditEvent.swift (RegulatedWriteContext)
public enum ActorSource: String, CaseIterable, Sendable, Codable {
    // Web surfaces
    case api
    case beoClientShare = "beo_client_share"
    case boxOffice = "box_office"
    case cookUI = "cook_ui"
    case diceIngest = "dice_ingest"
    case kdsApp = "kds_app"
    case kdsLogin = "kds_login"
    case kitchenAssistant = "kitchen_assistant"
    case kitchenAssistantUndo = "kitchen_assistant_undo"
    case managementUI = "management_ui"
    case managerPin = "manager_pin"
    case managerUI = "manager_ui"
    case picUI = "pic_ui"
    case prismBackfill = "prism_backfill"
    case receivingClosedLoop = "receiving_closed_loop"
    case receivingMatchResolution = "receiving_match_resolution"
    case salesDepletion = "sales_depletion"
    // Native writers
    case nativeCook = "native_cook"
    case nativeMac = "native_mac"

    /// The canonical string set — the reconcile checker mirrors this.
    public static let canonicalRawValues: Set<String> = Set(allCases.map(\.rawValue))

    /// Whether a stored `actor_source` string belongs to the canonical set.
    /// New writes must; historical rows are grandfathered and not rewritten.
    public static func isCanonical(_ value: String) -> Bool {
        canonicalRawValues.contains(value)
    }
}
