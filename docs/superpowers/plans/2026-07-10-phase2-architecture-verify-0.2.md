---
title: "Phase 2 Architecture — verify Native 0.2 (freeze)"
date: 2026-07-10
status: approved 2026-07-10 — Phase 3/4 executed; GUI smoke owner-pending
contract: ~/Dev/00_AI Engineering Delegation Contract.pdf
parent: docs/superpowers/plans/2026-07-10-phase1-discovery-native-final.md
owner_decision: U1 = verify-0.2 (2026-07-10)
autonomy: level 2
---

# Phase 2 — Architecture: verify & freeze Native 0.2

**Scope:** Confirm L1 Waves A–C on `main` are green, repair stale status docs, run automated oracles + owner-gated GUI smoke, declare Native 0.2 **code-complete / verified**.

**Out of scope:** H8 notarization, G0 shutoff, C4/C5, H7 Phase 2, sick-note impl, web spawn deletion, new Swift features, new dependencies.

**Implementation may begin only after this architecture is approved.**

---

## 1. System boundaries

| Inside | Outside |
|--------|---------|
| `LariatNative/` build + test gates | Web `app/`, `lib/recipeCalculator.ts`, `lib/beoCascade.ts` |
| Status / taxonomy / packaging **docs** truth repair | Developer ID / notarization (H8) |
| Python oracle scripts (read-only verify) | Schema C4/C5, live DB migrations |
| Owner-gated GUI smoke checklist evidence | Electron `desktop/` packaging (Codex lane) |
| Session/MACP claims for this front | `hospitality/future`, dirty foreign WIP on `main` |

**Freeze meaning:** Native 0.2 L1 deliverable is accepted as done; remaining work is tracked under Native 1.0 / H7 / H8 / Milestone C — not as open L1 waves.

---

## 2. Module responsibilities

| Module | Role in verify-0.2 |
|--------|-------------------|
| `LariatModel/Compute/BomExpand*` | Already shipped — **test only** |
| `LariatModel/Compute/BeoPull*` / `BeoCascadeCompute` | Already shipped — **test only** |
| `LariatModel/NativeBomCalculator` | Default assistant calculator — **no code change** |
| `LariatModel/BeoCascadeClient` | In-process default runner — **no code change** |
| `RecipeManifestLoader` + cache | Resolve D1-B roots — **observe in smoke** |
| `LariatApp` UI (assistant + BEO) | Manual smoke surface |
| Docs: `native-0.2-l1-status.md`, taxonomy cross-links, Discovery status | **Truth repair** |
| `scripts/dev/native_0_2_status.sh` | Oracle refresh; note Swift-0-tests anomaly if still present |
| `LariatNative/Scripts/package-app.sh` | Optional rebuild for smoke if existing `.app` stale |

---

## 3. Data flow (verification)

```
Python oracles (bom_expand / beo_pull / beo_cascade_cli)
        │
        ▼
JSON fixtures (16 BomExpand + 15 BeoCascade) ──► Swift BomExpand*/Beo* tests
        │
        ▼
swift test (full LariatNative) ──► PASS/FAIL gate

Packaged or build/Lariat.app
        │  resolveProjectRoot → ~/Library/Application Support/Lariat
        │  (recipes/ + menus/ already present on this machine 2026-07-10)
        ▼
Kitchen assistant scale_recipe ──► NativeBomCalculator (in-process)
BEO cascade tab ───────────────► BeoCascadeClient in-process runner
        │
        ▼
Activity Monitor: no python3 for those actions
```

---

## 4. Interface contracts (unchanged — verify only)

| Contract | Expectation |
|----------|-------------|
| `RecipeCalculating` | Satisfied by `NativeBomCalculator`; spawn-only error codes absent |
| `BeoCascadeClient` default runner | In-process; test seam retained |
| D1-B layout | `~/Library/Application Support/Lariat/{data,recipes,menus}` |
| Wire parity | Per `specs/2026-07-07-phase-iii-wire-parity.md` — no new fields |
| Web spawn | Still allowed (Milestone D) — do not “fix” by deleting |

**No public interface changes in this front.**

---

## 5. Dependency graph

```
verify-0.2
├── existing GRDB / SwiftPM (no adds)
├── Python 3 (oracle only)
├── local Application Support recipe tree (already seeded on owner Mac)
├── optional: package-app.sh ad-hoc .app
└── docs only under docs/superpowers/plans|specs + NATIVE_RELEASES if cross-link needed
```

No new paid services, licenses, or packages.

---

## 6. Testing strategy

| Layer | Command / action | Pass criteria |
|-------|------------------|---------------|
| Unit / parity | `cd LariatNative && swift build && swift test` | 0 failures |
| Filtered sanity | `swift test --filter BomExpand` and `--filter Beo` | Green |
| Python oracle | `python3 -m unittest tests.python.test_bom_expand tests.python.test_beo_pull tests.python.test_beo_cascade_cli -v` | OK (skips allowed if pre-existing) |
| Status script | `bash scripts/dev/native_0_2_status.sh` | Oracles green; if Swift reports 0 tests, record as tooling bug — full `swift test` is authoritative |
| GUI smoke (owner) | PACKAGING.md H8 smoke checklist (items that do **not** require notarization) | scale_recipe + BEO cascade work; **no python3** in Activity Monitor |
| Regression | Do not touch web/desktop; spot-check `git diff` only claimed files | No unrelated scope |

---

## 7. Deployment model

- **Not a release.** No notarization, no App Store, no production cutover.
- Evidence stays in-repo: updated status plan + short verification log section in that plan (or handoff).
- Existing ad-hoc `LariatNative/build/Lariat.app` may be used; rebuild only if smoke fails due to stale binary.

---

## 8. Agent work breakdown

| ID | Task | Agent | Files allowed | Out of scope |
|----|------|-------|---------------|--------------|
| V0 | Worktree + MACP claim | Main (Claude seat) | session board only | editing foreign dirty paths |
| V1 | Full `swift build && swift test` | Main | none (read/run) | fixing unrelated red tests without stop |
| V2 | Python oracles + status script | Main | none (read/run) | changing Python lib |
| V3 | Status doc truth repair | Main | `docs/superpowers/plans/2026-07-07-native-0.2-l1-status.md`, Discovery status field, optional kickoff gate snapshot lines | rewriting wave execution plans |
| V4 | GUI smoke checklist | **Owner** (manual) + Main records results | evidence in status/handoff | notarization |
| V5 | Phase 4 evidence pack + declare freeze | Main | status + this architecture status → verified | opening H8/C4 work |

**Subagents:** none required at Level 2 for this front. Optional Haiku/scout only if `swift test` log is huge.

**Collision rules:**

- Do **not** edit `desktop/**` (Codex).
- Do **not** edit sick-note Swift/docs claimed by other Claude session unless owner reassigns.
- Prefer worktree `scripts/worktree.sh new cursor chore/native-0.2-verify-freeze` so dirty `main` WIP is untouched.
- Edit guard: never write under `hospitality/future` or `Lariat-worktrees` contents belonging to others.

---

## 9. Implementation sequence

```
1. Owner approves this Phase 2 doc
2. V0 worktree + claims
3. V1 swift build && swift test          ── if red: STOP (Failure Handling)
4. V2 python oracles + status script
5. V3 update L1 status → Waves A/B/C DONE; prep “L1 Wave A code” → Done;
     point “next” to Native 1.0 / H8 / G0 (not A1)
6. V4 owner runs GUI smoke (or confirms already done); Main logs pass/fail
7. V5 Phase 4 checklist → Phase 5: merge only the doc PR (no product code)
```

**Definition of done (verify-0.2):**

- [ ] `swift build && swift test` green (evidence: date + summary counts)
- [ ] Python oracles green
- [ ] Status doc matches git truth (L1 A/B/C complete; PR #448 cited)
- [ ] GUI smoke: assistant + BEO in-process, no python3 — **or** explicitly deferred with owner note if GUI unavailable
- [ ] No Swift/TS product code changes unless a verify-blocking bug is found (then STOP for new Architecture slice)
- [ ] Independently reviewable PR (docs + evidence only preferred)

---

## 10. Provisional assumptions (still open from Phase 1)

| ID | Provisional | Action if wrong |
|----|-------------|-----------------|
| U6 | Dirty `main` WIP is foreign — leave alone; use worktree | Owner says commit/stash differently |
| Seat | This Cursor/Claude seat owns verify-0.2 docs+gates only | Owner reassigns |
| GUI | Owner can run Activity Monitor smoke on this Mac (Support dir already seeded) | Defer V4 with written waiver |

---

## Handoff (Phase 2 → owner approval)

| Field | Content |
|-------|---------|
| Inputs | Phase 1 Discovery; U1=`verify-0.2`; PACKAGING D1-B + smoke list; PR #448 history |
| Outputs | This architecture |
| Assumptions | U6 leave-alone; no H8; no code unless gate-red |
| Decisions sought | Approve Phase 2 → start Phase 3 (V0–V5) |
| Tests | None yet (Architecture phase) |
| Files changed | This file; Phase 1 status bump |

**Reply `approve` (or amend) to start Phase 3.**
