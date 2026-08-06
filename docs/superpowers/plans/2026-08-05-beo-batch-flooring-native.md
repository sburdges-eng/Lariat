---
title: "P3 — BEO batch flooring native parity"
date: 2026-08-05
status: planned — web engine has math; Swift port open
parent: docs/superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md
spec: docs/superpowers/specs/2026-07-28-beo-batch-ordering-design.md
---

# P3 — BEO batch flooring → Swift

**Problem:** Web cascade floors batch/case orders; `BeoCascadeCompute` does not.
Fixture export not on CI → silent web/native drift.

## Tasks

1. [ ] Audit Python/TS flooring rules vs current `BeoCascadeCompute`
2. [ ] Add/extend JSON fixtures under `BeoCascade/` covering batch floor cases
3. [ ] Wire `scripts/dev/export_bom_expand_fixtures.py` (and BEO twin) into npm/CI or documented gate
4. [ ] Port flooring into `LariatModel` compute; TDD against fixtures
5. [ ] Native board shows same order guide as web for fixture BEOs
6. [ ] `swift test --filter BeoCascade` + Python oracle green

## Gates

- Byte/fixture parity on batch-floor cases
- CI fails if fixtures drift from Python oracle
- No weakening of cascade warnings passthrough (#544/#552)
