---
title: "P1 — Costing confidence UI"
date: 2026-08-05
status: planned — design draft exists; needs approval then TDD
parent: docs/superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md
spec: docs/superpowers/specs/2026-07-07-lariat-cost-confidence-triage-design.md
---

# P1 — Costing confidence & gap triage UI

**Problem:** ~83% of recipe costs carry interpretations with no operator-visible signal.
Native == web math is proven; inaccuracy is data + missing UI.

## Tasks

1. [ ] Owner approves `2026-07-07-lariat-cost-confidence-triage-design.md` (or revise)
2. [ ] Surface `bom_lines.map_status` + `recipe_costs.{costed_lines,total_lines,interpretations}` on web costing + native costing boards
3. [ ] Ranked unmapped / NEEDS_DENSITY / cost_proxy worklist (B2 from mapping gaps)
4. [ ] Read-time plausibility guardrail per spec (fail loud, no silent rewrite)
5. [ ] Tests: fixtures with mixed map_status; UI copy per `UI_COPY_RULES.md`
6. [ ] Data-ops worklist export (CSV) for density/map closure — separate from code PR

## Gates

- Operator can tell clean vs estimated vs incomplete in <2s
- No change to batch_cost math without parity oracle
- Protected costing surfaces keep fail-loud behavior
