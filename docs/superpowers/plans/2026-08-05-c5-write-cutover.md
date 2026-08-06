---
title: "Front 3 — C5 write-route cutover"
date: 2026-08-05
status: planned — gated on C4
parent: docs/superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md
ledger: docs/superpowers/specs/2026-07-03-lariat-native-phase-c1-rule-ledger.md
---

# Front 3 — C5 write-route cutover

**Goal:** Native owns writes wave-by-wave; web write routes go read-only or delete
per C1 ledger, never before C4.

**Prerequisite:** C1 complete; C4 window green; Opus/Max review per wave.

## Tasks

1. [ ] Re-read C1 ledger; list C5-DELETE-BLOCKED rows (e.g. HACCP needing sync_feed)
2. [ ] Freeze web migration growth (CI guard) — first flip step from C2/C3 activation guide
3. [ ] Enable SchemaMigrator on native open **only** after freeze + backup
4. [ ] Cutover waves mirroring C1 port order; each wave: ≥2 clean days before next
5. [ ] Web-edge schema_version refusal handshake (fail closed on newer DB)
6. [ ] Update PROTECTED_CONTRACTS / edge-blocker log if transport stays edge

## Gates

- Per-wave: targeted contract suites green; reconcile green
- No silent audit/PIN/HACCP weakening
- Rollback plan rehearsed once (restore from C4 backup)

## Exit → Front 4 (Phase D)
