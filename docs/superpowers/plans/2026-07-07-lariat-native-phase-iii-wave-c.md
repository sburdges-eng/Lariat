# L1 Wave C — Wire-up + native spawn removal (Native 0.2)

> **Terminology:** [`docs/NATIVE_RELEASES_AND_TAXONOMY.md`](../../NATIVE_RELEASES_AND_TAXONOMY.md) — **L1 Wave C ≠ Milestone C** (schema C1–C5).
> **Prerequisites:** L1 Wave A + B merged; D1-B approved (signed); Opus review on parity.

**Goal:** Native assistant + BEO board use in-process compute; delete `python3` spawns;
H8 smoke on packaged `.app` without system Python.

---

## Blast radius (review before editing)

| Symbol | File | Risk |
|--------|------|------|
| `PythonBomCalculator` | `LariatApp/AssistantSupport.swift` | Kitchen assistant scale_recipe |
| `BeoCascadeClient` default runner | `LariatModel/BeoCascadeClient.swift` | BEO order guide + prep tab |
| `AssistantActionRepository` | `LariatDB/` | Protocol stable if `RecipeCalculating` unchanged |
| `BeoCascadeRepository` | `LariatDB/` | Inject in-process client |
| `resolveProjectRoot` / `resolveDataDirectory` | `LariatModel` | D1-B packaged defaults |

Run GitNexus `impact` on `BeoCascadeClient`, `AssistantActionRepository` before first edit.

---

## PR slices

| PR | Scope |
|----|--------|
| **C1** | `NativeBomCalculator` + wire `KitchenAssistantViewModel` |
| **C2** | In-process `BeoCascadeClient` runner + repository default |
| **C3** | D1-B resolver defaults + manifest cache + packaged smoke doc |

---

## C1 — Native BOM calculator

- [ ] Add `NativeBomCalculator: RecipeCalculating` using `BomExpandCompute` + `RecipeManifestLoader`
- [ ] Replace `PythonBomCalculator` in `AssistantSupport` / DI
- [ ] Remove spawn paths: `timeout`, `spawn_failed` error codes (see wire parity spec)
- [ ] Extend `KitchenAssistantEngineTests` with `NativeBomCalculator` integration
- [ ] `swift test` green; JS `test-recipe-calculator.mjs` still green (web spawn unchanged per D2)

---

## C2 — In-process BEO cascade

- [ ] Default `BeoCascadeClient` runner calls `BeoCascadeCompute.buildCascade` in-process
- [ ] Keep injectable runner seam for tests (`BeoCascadeClientTests` no spawn)
- [ ] `BeoCascadeRepositoryTests` use in-process default
- [ ] Delete `Process` spawn from cascade path
- [ ] Close A6.5 #369 watch note when tests prove math

---

## C3 — D1-B packaging + H8 smoke

Spec: `specs/2026-07-07-d1-application-support-layout.md`

- [ ] Packaged default: `LARIAT_ROOT` = Application Support; `LARIAT_DATA_DIR` = `{root}/data`
- [ ] Manifest cache mtime invalidation (kickoff §7.2)
- [ ] First-run seed stub or bundled minimal recipe tree
- [ ] Manual smoke checklist: launch `.app` from Finder, scale_recipe, BEO cascade, no `python3` in Activity Monitor
- [ ] Update `PACKAGING.md` with D1-B defaults

---

## L1 Wave C exit gates

- [ ] Full `swift test` green
- [ ] Python oracle tests unchanged + green
- [ ] No `python3` in `Process` trace for assistant/BEO actions
- [ ] Packaged app smoke documented (date + machine)
- [ ] STATUS + endgame docs updated

**Not in L1 Wave C:** Web TS spawn removal (Milestone D), `beo_order_pull.py` port.
