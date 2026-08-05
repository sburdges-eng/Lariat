---
title: "Front 5 — Phase E consolidation"
date: 2026-08-05
status: planned — ☠ user-confirmed steps; gated on D
parent: docs/superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md
checklist: docs/superpowers/specs/2026-07-02-lariat-native-phase-d-e-checklists.md
---

# Front 5 — Phase E consolidation

**Goal:** One canonical home; load-bearing paths absorbed first; duplicates deleted only with explicit confirmation.

## Tasks (E1–E6)

1. [ ] E1 Document canonical home (app bundle, edge, data/, audit dir)
2. [ ] E2 Relocate/absorb load-bearing: hospitality/Lariat, LariatNative, Lariat-KDS, lariat-data-sources (PII)
3. [ ] E3 Delete manifest: classify duplicate / stale / unknown — **unknown ⇒ investigate**
4. [ ] E4 ☠ Verified full backup (restore-tested) before any removal
5. [ ] E5 ☠ Delete in small batches; user confirms each; re-verify launch + tests + data
6. [ ] E6 Archive manifest; H8 distribution live; docs memory updated

## Standing prohibitions

- Never delete load-bearing paths
- Never batch-delete in the same session that built the manifest without re-verify
- PII: relocate + verify, never bare delete
