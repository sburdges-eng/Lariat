---
title: "P4 — Master product catalog land"
date: 2026-08-05
status: planned — PR #604 open
parent: docs/superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md
pr: https://github.com/sburdges-eng/Lariat/pull/604
---

# P4 — Master product catalog importer

**Problem:** Catalog line 1 is `0,1,2…`; real header on line 2. Pack Size case
breakdown unread. Aug 2026 price-less vendor_prices shape.

## Tasks

1. [ ] Review PR #604 (parser + dry-run importer; refuse ambiguous pack sizes)
2. [ ] Confirm tests cover header-skip + pack-size aliases + dry-run default
3. [ ] Operator dry-run against live catalog path (outside repo)
4. [ ] Merge when review green; document operator command in OPERATIONS
5. [ ] Follow-up: apply import only through `validateVendorPriceRow` / history snapshot

## Gates

- Wrong/missing price refused, not guessed
- Average-weight / dimensional packs refused by name
- Empty importable set → exit 1
