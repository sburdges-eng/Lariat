---
title: "Phase 1 Discovery — Lariat Native Final (Claude / Delegation Contract)"
date: 2026-07-10
status: discovery complete — U1=verify-0.2 approved 2026-07-10; Phase 2 architecture filed
contract: ~/Dev/00_AI Engineering Delegation Contract.pdf
role: technical lead / software engineering coordinator (Claude seat)
autonomy: level 2
canonical_workspace: ~/Dev/workspaces/lariat-native.code-workspace
related:
  - docs/LARIAT_NATIVE_FINAL_AGENT_GUIDE.md
  - docs/NATIVE_RELEASES_AND_TAXONOMY.md
  - docs/superpowers/plans/2026-07-07-native-0.2-l1-status.md
  - docs/superpowers/specs/2026-07-02-lariat-native-endgame.md
---

# Phase 1 — Discovery

**Contract rule:** No implementation code in this phase.  
**Seat:** Claude (technical lead / engineering coordinator).  
**Owner:** system architect / product owner (you).

---

## 1. Repository assessment

| Item | Finding (2026-07-10) |
|------|----------------------|
| Canonical app repo | `~/Dev/hospitality/Lariat` on branch **`main`** @ `3e1f283` |
| Native package | `LariatNative/` SwiftPM — targets `LariatModel` → `LariatDB` → `LariatApp` |
| Companion KDS | `~/Dev/Lariat-KDS` (separate repo; touch only on ticket contract) |
| Data / PII | `~/Dev/lariat-data-sources` — read/ingest only |
| Checkout health | **Dirty** on `main`: modified desktop/cache/menu CSVs + untracked `app/v2/*`, design-atlas zip, plans |
| Concurrent agents | Active: Claude (sick-note / stale L1 claims in worktree), Codex (tier3 / desktop paths), Cursor (stale), Gemini (stale) |
| Worktrees | `Lariat-worktrees/codex-larios-swiftui-kit`, `Lariat-wt-p06`, `.claude/worktrees/lariat-ka-v2-local-model` |
| Edit guard | Hooks report dirty `hospitality/future` or `Lariat-worktrees` — do not edit those paths |

**Verdict:** Repo is production-capable for Native 0.2 compute, but the working tree and agent session board are noisy. Next engineering must use an isolated worktree and a fresh claim set.

---

## 2. Current system inventory

### Product releases (binding taxonomy)

| Release | Status |
|---------|--------|
| Web v2.0.x | Live / evolving |
| **Native 0.1.x** | Effectively done (Milestones A–B) |
| **Native 0.2.x (L1 in-process BOM)** | **Merged to `main` via PR #448 (2026-07-08)** — Waves A/B/C landed |
| Native 1.0.x | Blocked on G0, C4, C5, H8 |

### Native 0.2 L1 — evidence (overrides stale status doc)

Status file `2026-07-07-native-0.2-l1-status.md` still says Wave A “Not started”. **That is false as of HEAD.**

| Wave | Evidence on `main` |
|------|--------------------|
| A BomExpand | `BomExpandCompute.swift` (447 LOC), `BomExpandTypes.swift`, fixture tests + 16 JSON fixtures |
| B BeoPull/Cascade | `BeoPullCompute.swift`, `BeoCascadeCompute.swift`, Beo fixture tests + 15 JSON fixtures |
| C Wire + delete native spawns | `NativeBomCalculator`, in-process `BeoCascadeClient` default runner, D1-B resolver + manifest cache commits (`1b5202f`…`1dae9b2`) |

Oracle refresh (`scripts/dev/native_0_2_status.sh`, 2026-07-10):

- Python BOM/BEO: **54 run, OK (1 skip)**
- JS recipe calculator: green
- Fixtures present: 16 + 15
- Swift full suite in that script reported **0 tests** — tooling anomaly (see Unknowns)

### Endgame milestones

| Milestone | Status |
|-----------|--------|
| A Port waves | Complete |
| B Kitchen assistant native | Complete |
| C Schema C1–C5 | **C1 PASS (71/71)**; C2/C3 artifacts exist; **C4/C5 not started** |
| D Edge reduction (web spawn delete) | Deferred (D2 approved) |
| E Consolidation | Not started |

### Holistic bars

| Track | Status |
|-------|--------|
| H1–H5 | Complete |
| H6 | Complete (H6d multi-window may still need merge confirmation) |
| H7 | Phase 1 merged; **Phase 2 (~61 files) not started** |
| H8 | Ad-hoc `.pkg` works; **Developer ID + notarization + `.dmg` decision open** |
| H9 | Deferred polish |

### Layering (approved)

```
LariatApp (SwiftUI / OS) → LariatDB (GRDB) → LariatModel (pure compute + records)
```

Regulated writes: `AuditedWriteRunner` / `AuditEventWriter`.  
Recipe BOM/BEO math: filesystem manifests, not SQLite.

### Sibling surfaces still spawning Python

- Web edge: `lib/recipeCalculator.ts`, `lib/beoCascade.ts` — **out of Native 0.2** (Milestone D)
- Python CLIs retained (D4 approved)

---

## 3. Requirements interpretation

**Owner intent (from active scope + guides):** Finish the macOS-native Lariat app so a kitchen Mac can run operator workflows without depending on Next.js for core BOH compute, and without requiring system Python for assistant/BEO.

**Interpreted near-term product outcomes:**

1. **Native 0.2 is code-complete on `main`** for in-process BOM/BEO — remaining 0.2 work is verification, packaging smoke, and status-doc truth repair.
2. **Native 1.0** requires: service-day shutoff (G0), C4 reconcile window, C5 write-route cutover, H8 notarized distribution.
3. Parallel polish: H7 Phase 2 accessibility; sick-note capture (docs landed #452; implementation claimed by another Claude session).

**Not interpreted as permission to:** flip schema ownership, delete web routes, notarize without identity, or edit dirty worktrees/future paths.

---

## 4. Unknowns register

| ID | Unknown | Severity | Disposition |
|----|---------|----------|-------------|
| U1 | **Which front is next after L1?** H8 notarization vs G0 shutoff vs C4 vs H7 Phase 2 vs sick-note impl | **Critical** | **STOP — owner choose** |
| U2 | Developer ID Application identity + team + notary keychain profile | **Critical** | **STOP — owner provide** (H8) |
| U3 | Distribution artifact: stapled `.pkg` vs `.dmg` containing `.app` | **Critical** | **STOP — owner choose** (PACKAGING.md open) |
| U4 | Is H6d multi-window fully merged to `main` or still branch-only? | Moderate | Provisional: treat as “verify before claiming H6 complete in release notes” |
| U5 | Why `native_0_2_status.sh` Swift section reported 0 tests | Moderate | Re-run `cd LariatNative && swift test` in Phase 2/4; do not trust script alone |
| U6 | Dirty `main` files (desktop/, caches, `app/v2/*`) — intentional WIP or abandoned? | Moderate | Assume foreign/WIP; do not commit; use worktree |
| U7 | Claude agent session claims L1 paths + sick-note while L1 already merged | Moderate | Refresh session board before Phase 3; avoid claim collision |
| U8 | GitNexus index still references deleted `PythonBomCalculator` | Minor | Index stale; refresh before impact analysis on those symbols |
| U9 | Live `data/lariat.db` shutoff gaps (G0 never logged) | **Critical** for Native 1.0 | Documented FAIL; required before C5 |
| U10 | Whether sick-note implementation is in-scope for this Claude seat now | Moderate | Depends on U1 |

---

## 5. Assumptions register

| ID | Assumption | Risk if wrong |
|----|------------|---------------|
| A1 | Approved product vision for this seat = **Native final macOS app**, not web v2 redesign | Wrong front of work |
| A2 | Native 0.2 L1 Waves A–C on `main` are the source of truth; status markdown is stale | Re-implementing L1 wastes cycles |
| A3 | D1-B / D2 / D4 / G4 remain owner-approved | Re-litigating closed decisions |
| A4 | Web Python spawn removal stays Milestone D | Accidental scope into web edge |
| A5 | Autonomy Level 2: reversible, module-local work only after Architecture approval | Overreach into C5/H8 secrets |
| A6 | `swift test` from `LariatNative/` is still the native gate (script anomaly is tooling, not product) | False green/red |
| A7 | Edit guard paths (`hospitality/future`, `Lariat-worktrees`) stay off-limits until cleared | Hook / collision failures |

---

## 6. Risk register

| ID | Risk | Impact | Likelihood | Mitigation |
|----|------|--------|------------|------------|
| R1 | Proceeding on stale “Wave A not started” docs | Duplicate L1 work / thrash | High | Treat PR #448 as done; update status in Phase 2 docs only after approval |
| R2 | Committing on dirty shared `main` | Trample concurrent Codex/Claude work | High | Mandatory worktree + MACP claims |
| R3 | H8 without Developer ID | Cannot ship Gatekeeper-clean builds | High | Block packaging “done” claims until U2/U3 resolved |
| R4 | C5 cutover before G0 + C4 | Live DB / audit integrity failure | Medium | Hard gate per endgame guide |
| R5 | Weakening PIN/HACCP/audit on any “cleanup” | Compliance breach | Medium | Opus/Max review; fail closed |
| R6 | Confusing L1 Wave C with Milestone C | Wrong schema work | Medium | Taxonomy doc binding |
| R7 | Touching `lariat-data-sources` or live DB | PII / data loss | Low–Med | Read-only; no native migrations on live DB |

---

## 7. Dependency inventory

| Dependency | Purpose | License / notes | Lock-in | Approval |
|------------|---------|-----------------|---------|----------|
| GRDB.swift ≥ 6.29 | SQLite access in LariatDB/Model | MIT (verify) | Medium | Existing — do not expand without review |
| Swift 5.9 / macOS 14 / iOS 17 | Platform floor | Apple | High | Existing |
| Python 3 + `scripts/lib/bom_expand.py` etc. | Oracle + web edge + CLIs (D4) | Project | Medium | Keep; not required at native runtime post-L1 |
| Next.js web app | Edge / ingest / remaining spawns | Project | High until Milestone D/C5 | Retain |
| Apple Developer ID + notarytool | H8 distribution | Apple paid membership | High | **Needs U2** |
| Lariat-KDS | Kitchen display client | Sibling repo | Medium | Only if ticket contract changes |
| Electron `desktop/` | Separate hub packaging path | Project | Do not conflate with H8 native | Codex currently touching |

**No new dependencies proposed in Discovery.**

---

## 8. Architecture options (post-L1)

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **O1 — Verify & freeze Native 0.2** | Update status docs, run full `swift test`, GUI smoke of in-process BOM/BEO, declare 0.2 code-complete | Low risk; clears false backlog | Does not advance 1.0 |
| **O2 — H8 distribution push** | Developer ID, notarize, first-run D1-B seed smoke on clean Mac | Unblocks real install | Blocked on U2/U3; paid/infra |
| **O3 — G0 + C4 reconcile track** | Service-day shutoff log + ≥7 green days + backup drill | Required for Native 1.0 | Operational; multi-day; needs live venue window |
| **O4 — H7 Phase 2 a11y** | Remaining ~61 board files VoiceOver/Dynamic Type | Parallel polish; reversible | Does not unblock 1.0 |
| **O5 — Sick-note implementation** | Build against #452 docs/spec | Clear scoped feature | Parallel Claude session already claimed; collision risk |
| **O6 — Milestone D web spawn removal** | Delete web python spawns | Completes edge story | Explicitly deferred; expands scope |

---

## 9. Recommended approach

**Recommendation: O1 first (short), then owner-selected primary front among O2 / O3 / O4.**

Rationale:

1. Discovery found **L1 already shipped** — the highest-value immediate engineering act is truth repair + verification, not more BomExpand code.
2. O2 is the highest product leverage for “double-click kitchen Mac” but is **approval-gated** (U2/U3).
3. O3 is the highest leverage for Native **1.0** but is calendar/ops gated (U9).
4. O4/O5 are valid Level-2 tracks once U1 is chosen and claims are cleared.

**Proposed sequence after owner answers critical unknowns:**

```
Phase 1 (this doc) ──approve──► Phase 2 Architecture
                                 (boundaries, sequence, agent WBS for chosen front)
                                      │
                                      ▼
                                 Phase 3 Implementation (worktree, Level 2)
                                      │
                                      ▼
                                 Phase 4 Verification → Phase 5 Integration
```

---

## 10. Critical unknowns — STOP for approval

Per Delegation Contract §Unknowns Policy / §Decision Authority, **do not start Phase 2 Architecture until you answer:**

1. **U1 — Next primary front?**  
   Choose one: `verify-0.2` | `h8-distribution` | `g0-c4-reconcile` | `h7-phase2` | `sick-note` | other (specify).

2. **If H8:** provide **U2** (Developer ID string / team) and **U3** (`.pkg` vs `.dmg`).

3. **Confirm dirty `main` WIP (U6):** leave alone / stash / belongs to another agent?

4. **Confirm this Claude seat owns the chosen front** (vs existing Claude sick-note / Codex desktop sessions).

---

## Handoff contract (Phase 1 → owner)

| Field | Content |
|-------|---------|
| Inputs received | Delegation Contract PDF; native final guide; taxonomy; L1 status/kickoff/wave plans; decisions D1/D2/D4; live git/session/worktree inventory |
| Outputs produced | This Discovery document |
| Assumptions used | A1–A7 |
| Decisions made | None irreversible; recommendation O1→owner pick |
| Tests performed | `native_0_2_status.sh` oracle refresh; file/commit inventory; spawn-path comment audit |
| Test results | Python OK; JS OK; Swift-via-script anomalous (0 tests); L1 symbols present on `main` |
| Known limitations | Did not run full `swift test` interactively beyond status script; did not GUI-smoke packaged app; did not edit status doc yet |
| Unresolved risks | R1–R7; critical U1–U3, U9 |
| Files changed | `docs/superpowers/plans/2026-07-10-phase1-discovery-native-final.md` (this file only) |
| Interfaces added/modified | None |

---

**Phase 1 complete pending owner answers above.**  
No Phase 2 / implementation until approval.
