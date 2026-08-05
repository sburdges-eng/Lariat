---
title: "Front 0 — Native 0.2 GUI smoke + G0 service-day shutoff"
date: 2026-08-05
status: ready-for-owner — checklists prepared; run on Mac + service day
canonical_id: g0-gui-smoke-shutoff
parent: docs/superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md
template: docs/superpowers/templates/service-day-shutoff-log.md
evidence: docs/superpowers/plans/2026-07-10-phase4-verify-0.2-evidence.md
packaging: LariatNative/Scripts/PACKAGING.md
---

# Front 0 — GUI smoke (Native 0.2) + G0 shutoff

**Goal:** Close the last Native **0.2** DoD checkbox (no-`python3` GUI smoke) and
pass the endgame **G0** service-day shutoff so C4 may start.

**Who runs what**

| Step | Runner | Where |
|------|--------|-------|
| Preflight package + static wiring | Agent or Mac | any checkout |
| GUI smoke (Activity Monitor) | **Owner** | macOS GUI login |
| G0 full service day | **Owner / PIC** | live venue Mac |
| Doc flip after pass | Agent | PR updating status |

---

## Prerequisites

- [x] L1 Waves A/B/C merged (PR #448)
- [x] Automated verify-0.2 green (`2026-07-10-phase4-verify-0.2-evidence.md`)
- [x] D1-B layout documented; Application Support recipe tree expected on venue Mac
- [ ] Fresh ad-hoc `.app` on the smoke machine (`Scripts/package-app.sh`)
- [ ] Quit any running Lariat; unset `LARIAT_ROOT` / `LARIAT_DATA_DIR` / `LARIAT_PYTHON` in the launch environment (Finder launch = clean env)

---

## Part A — Native 0.2 GUI smoke (no python3)

Source checklist: `LariatNative/Scripts/PACKAGING.md` § H8 packaged-`.app` smoke +
verify-0.2 evidence V4.

### A1. Build (Mac)

```sh
cd LariatNative
Scripts/package-app.sh --version 0.2.0
# → build/Lariat.app
```

- [ ] `codesign --verify --strict build/Lariat.app` exits 0
- [ ] `frozen_schema.sql` present under `Contents/Resources/**/LariatNative_LariatDB.bundle`
- [ ] Recipe tree exists: `~/Library/Application Support/Lariat/recipes/recipe_index.csv`
- [ ] BEO map exists: `~/Library/Application Support/Lariat/menus/beo_recipe_map.csv`

### A2. Launch smoke

1. [ ] Quit any Lariat process
2. [ ] Double-click `LariatNative/build/Lariat.app` (or `open …/Lariat.app`)
3. [ ] App window appears; no crash on launch
4. [ ] Kitchen assistant: run a `scale_recipe` / scale action → leaf rows returned
5. [ ] BEO board: run cascade → order guide + prep demands
6. [ ] Activity Monitor during (4)–(5): **no `python3`** owned by Lariat

### A3. Record

| Field | Value |
|-------|-------|
| Date | |
| Machine | |
| Commit / `.app` version | |
| `scale_recipe` | pass / fail |
| BEO cascade | pass / fail |
| No python3 | pass / fail |
| Notes | |

Reply in chat / handoff: `smoke pass` or `smoke fail <note>`.

### A4. After pass — agent doc flip

- [ ] Check boxes in `2026-07-10-phase4-verify-0.2-evidence.md`
- [ ] `2026-07-07-native-0.2-l1-status.md`: GUI smoke → **PASS**; G3 note if needed
- [ ] `NATIVE_RELEASES_AND_TAXONOMY.md`: Native 0.2 status → verified (GUI smoke done)

**Exit A:** Native 0.2 freeze claim allowed. Does **not** equal Native 1.0 / G0.

---

## Part B — G0 service-day shutoff

North star: endgame §2. Log template:
[`docs/superpowers/templates/service-day-shutoff-log.md`](../templates/service-day-shutoff-log.md)

### B1. Pre-day

- [ ] Backup `data/lariat.db` (+ WAL/SHM) and audit JSONL dir; checksum recorded
- [ ] Confirm edge-blocker list read: guest BEO share, PWA/remote, peers/cloud-bridge transport
- [ ] Print or open blank shutoff log; set Date / Location / Tester / Native build
- [ ] Verify Next.js will be **OFF**: `lsof -i :3000` empty (or venue-specific port)

### B2. During service

Exercise every tier that the venue uses that day. Minimum for G0 claim:

| Tier | Minimum boards | Pass |
|------|----------------|------|
| cook | today / 86 / stations or KDS | ☐ |
| safety | ≥1 HACCP write (temp or receiving) | ☐ |
| labor | breaks or punch-adjacent | ☐ |
| inventory | count or waste or par glance | ☐ |
| manager | command alerts or morning digest path | ☐ |
| costing | variance or recipe cost read | ☐ |
| purchasing | order guide glance | ☐ |
| beo | cascade + prep if event day; else N/A | ☐ |
| assistant | one audited write (scale or 86) | ☐ |
| foh / shows / house | if venue uses that arm today | ☐ / N/A |

Regulated spot-check (from template):

| Action | PIN? | Audit row? | Pass |
|--------|------|------------|------|
| HACCP temp log | | | ☐ |
| 86 item | | | ☐ |
| BEO prep done (if applicable) | | | ☐ |
| Assistant scale_recipe | | | ☐ |

Expected breaks only from `lariat-native-edge-blockers.md`.

### B3. Unexpected failures

Log every surprise in the template table. Any operator-blocking unexpected failure → **G0 FAIL**.

### B4. After day — gate

- [ ] Fill template → save as `docs/superpowers/plans/YYYY-MM-DD-service-day-shutoff-log.md`
- [ ] Append one-line verdict to endgame doc §2 / DoD §5
- [ ] `native-0.2-l1-status.md` G0 → **PASS** or **FAIL** with link
- [ ] Sign-off line completed

**Exit B (PASS):** C4 reconcile window may start (Front 2).  
**Exit B (FAIL):** file blockers; no C5; fix and re-run a full day.

---

## Agent work this PR (headless)

- [x] Author this plan + index
- [x] Point status docs at Front 0
- [x] Correct stale H6/H7a claims that blocked agent routing
- [ ] Cannot execute A2/B2 in Linux cloud — owner run required

---

## Acceptance

| Gate | Criterion |
|------|-----------|
| A | Smoke table filled; no python3; evidence pack boxes checked |
| B | Shutoff log filed; G0 PASS signed; no unexpected blockers |
| Docs | Index + L1 status + taxonomy + endgame DoD agree |

---

## Handoff snippet (owner)

```
Front 0 ready.
1) Mac: package-app.sh → double-click Lariat.app → scale_recipe + BEO cascade → confirm no python3.
2) Reply: smoke pass | smoke fail <note>
3) Pick a service day; Next.js OFF; fill docs/superpowers/templates/service-day-shutoff-log.md
4) File filled log under docs/superpowers/plans/ and ping for G0 doc flip + C4 start.
```
