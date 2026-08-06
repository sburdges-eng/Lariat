---
title: "P2 — Purchase-record consolidation"
date: 2026-08-05
status: planned — DRAFT design awaiting approval; no code until approved
parent: docs/superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md
spec: docs/superpowers/specs/2026-07-31-purchase-record-consolidation-design.md
---

# P2 — Purchase-record consolidation

**Problem:** Five spend stores, five ID namespaces, order vs invoice lifecycle mismatch.
Naive union is wrong.

## Tasks

1. [ ] Owner approves Phase 1 consolidation design (or revise)
2. [ ] Implement Phase 1 only (per spec) — do not start Phase 2 chaining without re-spec
3. [ ] Migration for any new tables; never in-place rewrite of PII paths
4. [ ] Tests with realistic Shamrock/Sysco-shaped fixtures (cp1252 / invoice numbers)
5. [ ] Manager-readable “what we spent” board using consolidated view
6. [ ] Re-spec Phase 2 BOM chaining only after Phase 1 green in production window

## Gates

- No false invoice-number dedupe claims
- Date/lifecycle matching documented and tested
- Audit trail for any merge/link writes
