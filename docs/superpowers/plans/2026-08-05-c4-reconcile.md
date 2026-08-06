---
title: "Front 2 — C4 reconcile window"
date: 2026-08-05
status: planned — gated on G0 PASS
parent: docs/superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md
c2c3: docs/superpowers/specs/2026-07-03-lariat-native-phase-c2-c3-activation.md
phase_c: docs/superpowers/specs/2026-07-02-lariat-native-phase-c-schema-inversion.md
---

# Front 2 — C4 reconcile (≥7 green service days)

**Goal:** Prove native + edge stay consistent long enough to trust C5 cutover.

**Prerequisite:** Front 0 G0 **PASS**.

## Tasks

1. [ ] Confirm `scripts/phase-c-reconcile.mjs` (or current reconcile entry) runs clean on a backup copy of live DB
2. [ ] Document daily reconcile ritual (who runs, when, where log lands)
3. [ ] Backup + restore drill: restore into scratch DB; app opens; checksum match recorded
4. [ ] Collect ≥7 consecutive green service days (reconcile exit 0 + no audit integrity alarms)
5. [ ] Money/checksum spot-checks per phase-C spec (recipe_costs TOTAL vs SUM; sample variance)
6. [ ] ActorSource set still matches C3 enum (reconcile pins)

## Gates

| Gate | Pass when |
|------|-----------|
| Restore drill | One documented restore with checksums |
| 7 green days | Linked daily logs / reconcile outputs |
| Integrity | No unexplained audit gap or money drift |

## Prohibitions

- Do not enable native SchemaMigrator on live `data/lariat.db`
- Do not delete web write routes
- Do not freeze web migrations yet

## Exit → Front 3 (C5)
