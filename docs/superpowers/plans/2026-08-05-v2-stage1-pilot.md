---
title: "P5 — Web /v2 Stage 1 cook pilot"
date: 2026-08-05
status: planned — code complete; in-person enablement
parent: docs/superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md
cutover: docs/V2_CUTOVER_PLAN.md
---

# P5 — `/v2` Stage 1 cook pilot

**Goal:** Run cook-tier v2 on pilot devices; keep v1 as rollback.

## Tasks

1. [ ] Confirm rollback owner (Sean) + Stage 1 window
2. [ ] On each pilot device: visit `/v2/enable`
3. [ ] Full cook shift: today, KDS punch, 86, stations
4. [ ] Watch responsiveness (86-add residual risk under CPU handicap)
5. [ ] Log incidents; rollback via `/v2/disable` if trigger hit
6. [ ] After clean window: allow Stage 2 manager pilot plan

## Gates

- Entry criteria already satisfied (2026-06-12 evidence)
- No v1 route deletion until 30 clean production days (cutover plan)

## Note

Native app is the long-term daily driver; this front is web-edge continuity only.
