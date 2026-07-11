# Native releases and taxonomy

**Binding for all agents** (Cursor, Claude Code, Codex, Gemini, Antigravity, Xcode).

This document is the single source of truth for how we name **product releases**,
**endgame milestones**, and the **Native 0.2 L1 program**. Chat memory and older
docs that say "Phase III" or "P3-1" are deprecated unless they link here.

Project-local path: `hospitality/Lariat/docs/NATIVE_RELEASES_AND_TAXONOMY.md`.

---

## Product releases (version numbers)

These are what ships to operators — not internal milestone letters.

| Release | Scope | Status (2026-07-10) |
|---------|-------|---------------------|
| **Web v2.0.x** | Next.js ops app on `main` | Live / evolving |
| **Native 0.1.x** | macOS parity + Python spawn (assistant/BEO via `python3`) | Effectively done (endgame Milestones A–B) |
| **Native 0.2.x** | **L1 in-process BOM** — BomExpand + BeoCascade in Swift, native spawn removal | **Code-complete on `main` (PR #448)** — automated verify-0.2 green 2026-07-10; owner GUI smoke pending |
| **Native 1.0.x** | Service-day shutoff, schema ownership flip (C4/C5), thin web edge | Blocked on G0, C4, C5, H8 |

Packaging version strings follow `LariatNative/Scripts/PACKAGING.md` (e.g. `0.2.0` for L1 work).

---

## Endgame milestones (A–E) — not releases

From `docs/superpowers/specs/2026-07-02-lariat-native-endgame.md`. These are
**milestones**, never "Phase III" and never version bumps.

| Milestone | Meaning |
|-----------|---------|
| **A** | Port waves (A0–A6 boards) — recorded complete |
| **B** | Kitchen assistant native path — recorded complete |
| **C** | Schema inversion program **C1–C5** (ledger, migrator, actor_source, reconcile, cutover) |
| **D** | Edge reduction — delete non-blocker web routes; **web** spawn removal lives here |
| **E** | Consolidation / duplicate absorption |

**Phase C** (capital C) always means the **schema program C1–C5**, not L1 Wave C.

---

## Native 0.2 — L1 in-process BOM (current work)

The program formerly called "Phase III" / "P3-1" is **Native 0.2 L1**:

- **Goal:** Native assistant + BEO cascade without `python3` spawn (H8 blocker).
- **North star:** ~40 ms spawn latency → ~2 ms in-process; no system Python on kitchen Mac.
- **Not in scope for 0.2 done:** Web route deletion, full schema flip, Python CLI removal.

### L1 implementation waves (inside Native 0.2 only)

Always prefix with **L1 Wave** in new prose:

| L1 Wave | Deliverable |
|---------|-------------|
| **L1 Wave A** | BomExpand parity (compute + loader + tests) |
| **L1 Wave B** | BeoPull + BeoCascade compute + tests |
| **L1 Wave C** | Wire-up, cache, **native** spawn deletion |

**L1 Wave C ≠ Milestone C.** L1 Wave C removes native spawns; Milestone C is schema C1–C5.

### L1 read order (agents)

1. **Live status:** `docs/superpowers/plans/2026-07-07-native-0.2-l1-status.md`
2. **Architecture map:** `docs/superpowers/plans/2026-07-07-native-0.2-l1-kickoff.md`
3. **Wave execution:** `...-lariat-native-phase-iii-wave-a.md` (and B/C) — filenames legacy; content uses L1 Wave labels
4. **Owner decisions:** `docs/superpowers/specs/2026-07-07-phase-iii-decisions-d1-d2-d4.md`
5. **Native final guide:** `docs/LARIAT_NATIVE_FINAL_AGENT_GUIDE.md`

Gate refresh: `scripts/dev/native_0_2_status.sh` (alias: `phase_iii_status.sh`).

---

## Release criteria (H6–H9)

Cross-cutting bars per native version — not separate "phases":

| Track | Meaning |
|-------|---------|
| **H6** | Platform integration (notifications, printing, menu bar, multi-window) — complete |
| **H7** | Accessibility / iPad — **H7 Phase 1** and **H7 Phase 2** are H7 sub-tracks, not Native 0.2 |
| **H8** | Distribution (Developer ID, notarization, `.pkg`/`.dmg`, data dir D1-B) |
| **H9** | Post-1.0 polish (deferred) |

---

## Deprecated aliases (do not use in new prose)

| Deprecated | Use instead |
|------------|-------------|
| Phase III, P3-1, P3-2 | **Native 0.2**, **L1 in-process BOM**, or **L1 backlog** |
| Phase III Wave A/B/C | **L1 Wave A/B/C** |
| G4 "P3-1 scope" | **G4 Native 0.2 L1 scope** |
| `phase-iii-*` filenames | Still valid paths; see `deprecated_alias: phase-iii` in frontmatter |
| Branch `feat/lariat-native-phase-iii-bom-inprocess` | Legacy git slug; work is **Native 0.2 L1** |

Historical quotes in endgame or decision memos may retain old terms when marked as archival.

---

## Disambiguation quick reference

```
Native 0.2 L1 Wave C  →  delete native Python spawns (AssistantSupport, etc.)
Milestone C (C1–C5)   →  schema ownership, audit ledger, web write cutover
Milestone D             →  delete web spawns + edge routes
H7 Phase 2              →  accessibility files (~61), unrelated to L1
Endgame "Phase B done"  →  assistant milestone, not "Native 0.2"
```

---

## Agent broadcast

On session start for `lariat-native` scope, read this file before interpreting any
"Phase III" reference. Active multi-agent sessions: check `.agent-sessions/handoff.md`
for `BROADCAST 2026-07-07 — Native 0.2 taxonomy`.
