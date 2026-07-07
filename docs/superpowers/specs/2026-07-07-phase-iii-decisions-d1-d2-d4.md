---
title: "Phase III decisions — D1, D2, D4 (owner sign-off)"
date: 2026-07-07
status: proposed — awaiting owner sign-off
parent: docs/superpowers/plans/2026-07-07-lariat-native-phase-iii-kickoff-plan.md
related:
  - LariatNative/Scripts/PACKAGING.md
  - docs/desktop-wrapper-design.md
  - docs/LARIAT_NATIVE_FINAL_AGENT_GUIDE.md
---

# Phase III decision memo — D1, D2, D4

**Scope:** Prep only. D3 (copy bom_expand unit tables verbatim for Wave A) is already
recorded in `docs/superpowers/specs/2026-07-07-bom-unit-table-diff.md`.

**Owner action:** Reply with `approved` / edits per decision block before Wave C wiring.

---

## D1 — Packaged recipe CSV location (required before Wave C)

### Context

- BOM math reads **filesystem** recipe trees (`recipes/recipe_index.csv`,
  `recipes/normalized/{slug}.csv`, `menus/beo_recipe_map.csv`) — not SQLite.
- Native today resolves project root via `BeoCascadeClient.resolveProjectRoot`:
  `LARIAT_ROOT` → cwd walk for `scripts/beo_cascade_cli.py` → parent of
  `LARIAT_DATA_DIR`.
- `PACKAGING.md` documents `LARIAT_DATA_DIR` for the DB; Finder launch has no cwd.
- `desktop-wrapper-design.md` is the **Electron + Next.js hub** design — **not** the
  H8 native Swift app path. Do not conflate: Phase III targets `LariatNative`
  (`package-app.sh`), not `desktop/`.

### Options

| ID | Layout | Pros | Cons |
|----|--------|------|------|
| A | Bundle `recipes/` inside `.app/Contents/Resources/` | Double-click works without config | Recipe edits require rebuild/redeploy; diverges from web ingest layout |
| B | Colocate under Application Support: `{support}/recipes/` + `{support}/data/lariat.db` | Matches “data travels with venue” mental model; same parent as DB; ingest can rsync CSVs | First-run seed or wizard must copy/sync tree; larger support dir |
| C | Require explicit `LARIAT_ROOT` in Settings / env only | Simple resolver | Fails H8 smoke on clean Mac without manual setup |

### **Proposed D1 (recommended): B + resolver default**

1. **Packaged default layout** (when `LARIAT_DATA_DIR` unset and app is bundled):
   - `~/Library/Application Support/Lariat/data/lariat.db`
   - `~/Library/Application Support/Lariat/recipes/` (full tree)
   - `~/Library/Application Support/Lariat/menus/beo_recipe_map.csv`
2. **`LARIAT_ROOT`** defaults to `~/Library/Application Support/Lariat` in packaged builds.
3. **`LARIAT_DATA_DIR`** defaults to `{LARIAT_ROOT}/data` (extends existing `resolveDataDirectory`
   future work in `PACKAGING.md`).
4. **First run:** if `recipes/recipe_index.csv` missing, seed from bundled **seed snapshot**
   in `LariatNative_LariatDB.bundle` or a one-time copy step in Wave C (not full live sync).
5. **Dev / CI:** unchanged — `LARIAT_ROOT=<repo>` + `LARIAT_DATA_DIR=<repo>/data`.

**H8 constraints this satisfies:**

- Wave C gate: packaged `.app` on clean Mac **without system Python** ✓
- Recipe updates without app rebuild: rsync/ingest into Application Support ✓
- Parity with web layout (`recipes/`, `menus/`) ✓
- `BeoCascadeClient.resolveProjectRoot` parent-of-data-dir fallback still works ✓

**Explicitly rejected for H8 native:** Option A as primary (stale recipes in bundle);
Option C alone (fails double-click smoke).

### Owner sign-off

- [ ] **Approve D1-B** as stated
- [ ] **Revise:** _______________________________

---

## D2 — Web spawn removal timing

### Context

- Phase III P3-1 removes spawns from **native** (`AssistantSupport.swift`,
  default `BeoCascadeClient` runner).
- Web still spawns via `lib/recipeCalculator.ts` and `lib/beoCascade.ts` today.
- Kickoff plan: web spawn removal is **Phase D**, not P3-1 done criteria.

### **Proposed D2**

| Surface | When to delete spawn | Rationale |
|---------|---------------------|-----------|
| Native Swift (`PythonBomCalculator`, cascade `Process`) | **Wave C** (P3-1) | H8 blocker — no system Python on kitchen Mac |
| Web TS (`recipeCalculator.ts`, `beoCascade.ts`) | **Phase D** after C5 cutover + shutoff test | Edge may still serve iPad/LAN until D; Python oracle stays for cross-check |
| `scripts/bom_expand_cli.py` / `beo_cascade_cli.py` | **Keep** through Phase D | Offline/batch tools + JS integration oracle |

**Not proposed:** Delete web spawns in Phase III — risks iPad hub regression before C4/C5.

### Owner sign-off

- [ ] **Approve D2** as stated
- [ ] **Revise:** _______________________________

---

## D4 — Python CLIs (`beo_order_pull.py` and friends)

### Context

- `scripts/beo_order_pull.py` is a **batch** order-pull tool (not Node-spawned).
- Shares `scripts/lib/bom_expand.py` + `beo_pull.py` with assistant/BEO cascade.
- P3-1 does **not** port batch pull to Swift.

### **Proposed D4**

| Artifact | Decision |
|----------|----------|
| `scripts/beo_order_pull.py` | **Keep** indefinitely for batch/CLI workflows |
| `scripts/bom_expand_cli.py` | **Keep** as dev oracle + optional cross-check until Phase D |
| `scripts/beo_cascade_cli.py` | **Keep** same |
| `scripts/lib/bom_expand.py` | **Keep** as parity oracle until web spawn deleted (Phase D) |
| Deprecation notice | Add header comment in CLIs after Wave C: “Native app uses in-process compute; CLI retained for batch/oracle.” |

**Not proposed:** Delete Python CLIs at P3-1 completion — breaks batch ops and JS oracle tests.

### Owner sign-off

- [ ] **Approve D4** as stated
- [ ] **Revise:** _______________________________

---

## Summary table

| ID | Proposal | Blocks |
|----|----------|--------|
| D1 | Application Support tree; `LARIAT_ROOT` = support root when bundled | Wave C wire-up + H8 smoke |
| D2 | Native spawn delete Wave C; web spawn delete Phase D | Wave C scope boundary |
| D3 | Copy Python unit tables (Wave A) | *(done)* |
| D4 | Keep Python CLIs + lib; deprecate note only | Nothing |

---

## References

- `LariatNative/Scripts/PACKAGING.md` — ad-hoc `.pkg`, `LARIAT_DATA_DIR`, notarization TBD
- `docs/desktop-wrapper-design.md` — Electron hub (separate from native H8)
- `LariatNative/Sources/LariatModel/BeoCascadeClient.swift` — `resolveProjectRoot`
- `docs/superpowers/plans/2026-07-07-lariat-native-phase-iii-kickoff-plan.md` §7.3
