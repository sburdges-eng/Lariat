# Lariat Native — Risk Mitigations & Preparation

**Date:** 2026-06-30
**Companion to:** `2026-06-30-lariat-native-full-replacement-roadmap-design.md`
**Purpose:** Concrete preparation for the four cross-cutting risks, so they're
handled by design rather than discovered mid-wave. **Max parallelism** was
chosen for Phase A, which sharpens risk (1) into a prerequisite.

---

## Risk 1 — Shell-file registration bottleneck → feature self-registration (Task A0)

### The problem (measured against current code)

Adding ONE feature today edits **four shared spots**, all conflict-prone under
parallel waves:

1. `SafetySection.swift` — a new `SafetyDestination` enum case.
2. `LariatApp.swift` — a new `case` (~10 lines) in the `detailView` switch.
3. `FoodSafetyHubView.swift` — a new hub button **and** a new `onOpenX` closure param.
4. `LariatApp.swift` — a new closure argument at the `FoodSafetyHubView(...)` call site.

Inserting a `case` into a switch and a case into an enum are the *worst* kind of
merge conflict (non-append, same hunk). With ~25 remaining feature areas fanned
out in parallel, every integration step fights these files.

### The fix: a registry of self-describing feature modules

Each feature ships ONE file that fully describes how it mounts. The shell becomes
generic and **stops changing per feature**. The only shared edit left is a
single **append** to one array — which git usually auto-merges, and is mechanical
to resolve when it doesn't.

```swift
// FeatureModule.swift  (shared infra — written once)
enum Tier: String, CaseIterable { case cook = "Cook", safety = "Safety", manager = "Manager" }

struct AppContext {
    let database: LariatDatabase
    let writeDatabase: LariatWriteDatabase?
    let catalog: StationCatalog?
    let navigate: (String) -> Void          // replaces the onOpenX closures
}

struct FeatureModule: Identifiable {
    let id: String                          // stable key, e.g. "safety.cooling"
    let tier: Tier
    let title: String
    let enabled: Bool
    let makeView: (AppContext) -> AnyView   // owns its own DI + degrade fallback
}
```

```swift
// CoolingFeature.swift  (ships in the feature's own file — ZERO shared edits here)
extension FeatureModule {
    static let cooling = FeatureModule(
        id: "safety.cooling", tier: .safety, title: "Cooling", enabled: true,
        makeView: { ctx in
            guard let writeDB = ctx.writeDatabase else {
                return AnyView(TileDegrade(title: "Cooling unavailable",
                    message: "Could not open the write database.", systemImage: "lock"))
            }
            return AnyView(CoolingView(readDB: ctx.database, writeDB: writeDB))
        }
    )
}
```

```swift
// FeatureRegistry.swift  (the ONE shared file; each port appends a single line)
enum FeatureRegistry {
    static let all: [FeatureModule] = [
        .today, .eightySix, .stations, .kds,                 // cook
        .foodSafetyHub, .tempLog, .dateMarks, .calibrations,
        .cleaning, .breaks, .cooling,                        // safety  ← append here
        .command, .analytics, .costing, .management,         // manager
    ]
}
```

The shell collapses to generic iteration — `LariatApp.swift` and the hub view
no longer change per feature:

```swift
List(selection: $selectedId) {
    ForEach(Tier.allCases, id: \.self) { tier in
        Section(tier.rawValue) {
            ForEach(FeatureRegistry.all.filter { $0.tier == tier }) { m in
                if m.enabled { Text(m.title).tag(m.id) }
                else { Text(m.title).foregroundStyle(.tertiary).badge("Soon") }
            }
        }
    }
}
// detail:
if let m = FeatureRegistry.all.first(where: { $0.id == selectedId }) { m.makeView(ctx) }
```

Inter-feature navigation (hub→board, today→86) uses `ctx.navigate(id)` instead of
bespoke `onOpenX` closures, so hubs iterate `FeatureRegistry.all.filter { $0.tier == .safety }`
and render a button per module generically.

### Plan

- **Task A0 (prerequisite, lands before the wave):** introduce `FeatureModule` /
  `AppContext` / `FeatureRegistry`, convert the existing screens (cook, safety,
  manager) to modules, make `LariatApp.swift` + `FoodSafetyHubView` generic.
  Net: per-feature shared edits drop from 4 (incl. a switch case) to 1 (an array append).
- **Update the `swift-port` agent:** a port now creates `XFeature.swift` and adds
  ONE line to `FeatureRegistry.all` — no switch/enum/hub edits. Update the agent's
  procedure + MAY-modify list accordingly.
- Re-base the cooling pilot onto the registry (its 3 shell edits become 1 append +
  a `CoolingFeature.swift`).

---

## Risk 2 — Schema-ownership inversion (Phase C) → dedicated sub-spec outline

Phase C is the highest-risk phase (flips Swift from reader to system-of-record).
It will NOT be designed inline; it gets its own spec covering at minimum:

- **Migration ownership handoff.** Who runs migrations during the transition; how
  the web app's `lib/db.ts` migration list is ported/frozen; versioning + a single
  writer of DDL at any moment.
- **Shadow / dual-write period.** Run native writes and web writes against the same
  DB with reconciliation before cutting the web write-path; define the invariant
  checks that must hold.
- **Rule inventory.** Enumerate the write-side business rules in the ~130 API
  routes (validation, status codes, audit semantics, idempotency, location scoping)
  and map each to a native owner. This inventory is itself a Phase-C task.
- **Rollback.** Every step reversible; verified backups; a "fall back to web as
  writer" switch retained until C is fully validated.
- **Data-integrity tests.** Parity tests that the same operation produces identical
  rows + `audit_events` whether driven by web or native, before web writes are removed.

---

## Risk 3 — `actor_source` divergence → canonical taxonomy (standardize in Phase C)

### Finding (measured)

Web emits a **16-value** taxonomy keyed to the acting *surface*:

```
api, cook_ui, kitchen_assistant, pic_ui, manager_ui, management_ui, manager_pin,
kds_app, kds_login, beo_client_share, box_office, receiving_match_resolution,
receiving_closed_loop, sales_depletion, dice_ingest, kitchen_assistant_undo
```

Native currently collapses to **two**: `native_cook` and `native_mac`
(`AuditEvent.swift`). This loses audit fidelity — a native manager write and a
native cook write are indistinguishable from each other and from their web
equivalents.

### Mitigation

- **Single source of truth.** Introduce a shared `ActorSource` enum in
  `LariatModel` listing the canonical values; web + native both reference the same
  vocabulary (web side aligned during Phase C).
- **Mapping rule:** `actor_source` names the *surface that acted*, not the platform.
  A native cook surface should emit the cook-surface value; a native manager surface
  the manager value. Decision to lock in Phase C: either (a) map native surfaces
  onto the existing web values (`cook_ui`, `manager_ui`, …) so audits are
  platform-agnostic, or (b) add explicit `native_*` siblings to the canonical set
  if platform provenance must be queryable. Recommendation: **(a)** for audit
  continuity, with platform captured separately (e.g., a `device`/`client` column
  or audit metadata) if needed — do not overload `actor_source` with platform.
- **Until C:** new ports keep the established `native_cook`/`native_mac` convention
  (consistency with existing native writes); the standardization is a single
  coordinated change in Phase C, not per-port churn.

---

## Risk 4 — "Can't-go-native" blockers → living edge-server scope log

Every surface a port determines cannot be native is appended to a single living
log: **`docs/superpowers/specs/lariat-native-edge-blockers.md`**. That file is the
authoritative scope for the Phase D thin Next.js edge server.

- **Process:** the `swift-port` agent, on hitting a hard blocker, records it
  (surface, why it can't be native, what the edge server must keep) in the blocker
  log and proceeds with the rest of its feature — it does NOT force the blocker
  into Swift.
- **Seeded** with the two known blockers: guest BEO share-and-sign public link;
  PWA / remote browser access.
- Phase D reads this log as its requirements list.
