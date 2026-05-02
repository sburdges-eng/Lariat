# Breaker Audit Finding

> Copy this file to `docs/agentic/findings/<YYYY-MM-DD>-<section>-<slug>.md`.
> One finding per file. Capture as you find them — context is freshest when you spot the break.

---

**Subsystem:**
<!-- One of: HACCP / PIN-gate / location / costing-inventory / shows-settlement / kitchen-assistant-specials / ui-copy-money / offline-pwa-e2e -->

**Invariant:**
<!-- The contract that must never break. Quote the source — rule module, docs/PATTERNS.md section, AGENTS.md hard rule. -->

**Break attempt:**
<!-- Concrete payload / sequence you tried. "POST /api/foo with body.qty = -1" not "negative quantity". -->

**Observed result:**
<!-- What actually happened — status code, DB row state, audit row presence/absence, UI render, log line. -->

**Expected result:**
<!-- What the invariant requires. Often the inverse of "Observed". -->

**Risk:**
<!-- One sentence on the worst-case impact: data loss / audit bypass / cross-location leak / money wrong / UI confusion. -->

**Repro command:**
```bash
# Self-contained one-liner or short shell block. Should run from repo root.
```

**Likely files:**
- `path/to/file.ts:line`
- `path/to/other.js:line`

**Fix class:** test-only / logic / schema / UI / docs

**Priority:** P0 / P1 / P2 / P3
<!-- See BREAKER_AUDIT.md §6 for tier definitions. -->

---

## Optional notes

- Adjacent things noticed but NOT this finding: …
- GitNexus impact result: …
- Related existing test: `tests/js/test-…`
