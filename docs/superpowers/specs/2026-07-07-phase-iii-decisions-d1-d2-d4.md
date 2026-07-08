---
title: "Native 0.2 L1 decisions — D1, D2, D4 (owner sign-off)"
date: 2026-07-07
status: approved — owner sign-off 2026-07-07
canonical_id: native-0.2-l1
deprecated_alias: phase-iii
parent: docs/superpowers/plans/2026-07-07-native-0.2-l1-status.md
related:
  - LariatNative/Scripts/PACKAGING.md
  - docs/desktop-wrapper-design.md
  - docs/LARIAT_NATIVE_FINAL_AGENT_GUIDE.md
---

# Native 0.2 L1 decision memo — D1, D2, D4

> **Terminology:** [`docs/NATIVE_RELEASES_AND_TAXONOMY.md`](../../NATIVE_RELEASES_AND_TAXONOMY.md)

**Scope:** Prep only. D3 (copy bom_expand unit tables verbatim for L1 Wave A) is already
recorded in `docs/superpowers/specs/2026-07-07-bom-unit-table-diff.md`.

**Owner action:** Signed 2026-07-07 — D1-B, D2, D4 approved as stated; G4 Native 0.2 L1 scope approved.

---

## Owner sign-off record

| Decision | Status | Date | Owner |
|----------|--------|------|-------|
| **G4** Native 0.2 L1 scope (in-process BOM; web spawn deferred Milestone D) | **Approved** | 2026-07-07 | sburdges |
| **D1-B** Application Support recipe + data layout | **Approved** | 2026-07-07 | sburdges |
| **D2** Native spawn delete L1 Wave C; web Milestone D | **Approved** | 2026-07-07 | sburdges |
| **D4** Keep Python CLIs + lib | **Approved** | 2026-07-07 | sburdges |

---

## D1 — Packaged recipe CSV location (required before L1 Wave C)

### Context

- BOM math reads **filesystem** recipe trees (`recipes/recipe_index.csv`,
  `recipes/normalized/{slug}.csv`, `menus/beo_recipe_map.csv`) — not SQLite.
- Native today resolves project root via `BeoCascadeClient.resolveProjectRoot`:
  `LARIAT_ROOT` → cwd walk for `scripts/beo_cascade_cli.py` → parent of
  `LARIAT_DATA_DIR`.
- `PACKAGING.md` documents `LARIAT_DATA_DIR` for the DB; Finder launch has no cwd.
- `desktop-wrapper-design.md` is the **Electron + Next.js hub** design — **not** the
  H8 native Swift app path. Do not conflate: **Native 0.2 L1** targets `LariatNative`
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
   in `LariatNative_LariatDB.bundle` or a one-time copy step in L1 Wave C (not full live sync).
5. **Dev / CI:** unchanged — `LARIAT_ROOT=<repo>` + `LARIAT_DATA_DIR=<repo>/data`.

**H8 constraints this satisfies:**

- L1 Wave C gate: packaged `.app` on clean Mac **without system Python** ✓
- Recipe updates without app rebuild: rsync/ingest into Application Support ✓
- Parity with web layout (`recipes/`, `menus/`) ✓
- `BeoCascadeClient.resolveProjectRoot` parent-of-data-dir fallback still works ✓

**Explicitly rejected for H8 native:** Option A as primary (stale recipes in bundle);
Option C alone (fails double-click smoke).

### Owner sign-off

- [x] **Approve D1-B** as stated — sburdges, 2026-07-07
- [ ] **Revise:** _______________________________

---

## D2 — Web spawn removal timing

### Context

- Native 0.2 L1 removes spawns from **native** (`AssistantSupport.swift`,
  default `BeoCascadeClient` runner).
- Web still spawns via `lib/recipeCalculator.ts` and `lib/beoCascade.ts` today.
- Kickoff plan: web spawn removal is **Milestone D**, not Native 0.2 L1 done criteria.

### **Proposed D2**

| Surface | When to delete spawn | Rationale |
|---------|---------------------|-----------|
| Native Swift (`PythonBomCalculator`, cascade `Process`) | **L1 Wave C** (Native 0.2) | H8 blocker — no system Python on kitchen Mac |
| Web TS (`recipeCalculator.ts`, `beoCascade.ts`) | **Phase D** after C5 cutover + shutoff test | Edge may still serve iPad/LAN until D; Python oracle stays for cross-check |
| `scripts/bom_expand_cli.py` / `beo_cascade_cli.py` | **Keep** through Phase D | Offline/batch tools + JS integration oracle |

**Not proposed:** Delete web spawns in Native 0.2 L1 — risks iPad hub regression before C4/C5.

### Owner sign-off

- [x] **Approve D2** as stated — sburdges, 2026-07-07
- [ ] **Revise:** _______________________________

---

## D4 — Python CLIs (`beo_order_pull.py` and friends)

### Context

- `scripts/beo_order_pull.py` is a **batch** order-pull tool (not Node-spawned).
- Shares `scripts/lib/bom_expand.py` + `beo_pull.py` with assistant/BEO cascade.
- Native 0.2 L1 does **not** port batch pull to Swift.

### **Proposed D4**

| Artifact | Decision |
|----------|----------|
| `scripts/beo_order_pull.py` | **Keep** indefinitely for batch/CLI workflows |
| `scripts/bom_expand_cli.py` | **Keep** as dev oracle + optional cross-check until Phase D |
| `scripts/beo_cascade_cli.py` | **Keep** same |
| `scripts/lib/bom_expand.py` | **Keep** as parity oracle until web spawn deleted (Phase D) |
| Deprecation notice | Add header comment in CLIs after L1 Wave C: “Native app uses in-process compute; CLI retained for batch/oracle.” |

**Not proposed:** Delete Python CLIs at Native 0.2 L1 completion — breaks batch ops and JS oracle tests.

### Owner sign-off

- [x] **Approve D4** as stated — sburdges, 2026-07-07
- [ ] **Revise:** _______________________________

---

## Summary table

| ID | Proposal | Blocks |
|----|----------|--------|
| D1 | Application Support tree; `LARIAT_ROOT` = support root when bundled | L1 Wave C wire-up + H8 smoke — **layout spec:** `2026-07-07-d1-application-support-layout.md` |
| D2 | Native spawn delete L1 Wave C; web spawn delete Milestone D | L1 Wave C scope boundary |
| D3 | Copy Python unit tables (Wave A) | *(done)* |
| D4 | Keep Python CLIs + lib; deprecate note only | Nothing |

---

## References

- `LariatNative/Scripts/PACKAGING.md` — ad-hoc `.pkg`, `LARIAT_DATA_DIR`, notarization TBD
- `docs/desktop-wrapper-design.md` — Electron hub (separate from native H8)
- `LariatNative/Sources/LariatModel/BeoCascadeClient.swift` — `resolveProjectRoot`
- `docs/superpowers/plans/2026-07-07-native-0.2-l1-kickoff.md` §7.3
