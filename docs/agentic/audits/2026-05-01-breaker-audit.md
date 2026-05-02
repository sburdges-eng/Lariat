# Breaker Audit — 2026-05-01

**Section covered:** 1 — HACCP rules + API audit atomicity (one of eight; see [`BREAKER_AUDIT.md`](../BREAKER_AUDIT.md) §2 for the full section map).

**Auditor:** claude (orchestrator + reviewer this session)

**Branch:** `breaker-audit-workflow`

**Read-only:** YES. No source code edited; findings only.

---

## Method

Six-prong checklist per [`BREAKER_AUDIT.md`](../BREAKER_AUDIT.md) §3 applied to:

- `lib/auditEvents.ts` — the audit helper contract
- `lib/receiving.ts` — sample HACCP rule module
- `app/api/<concept>/route.js` — every route that calls `postAuditEvent` (40 callers across 22 files)
- `app/api/<concept>/route.js` — every route that opens `db.transaction` but does NOT call `postAuditEvent` directly (4 routes; 3 delegate to a repo, 1 has the gap)

GitNexus index was stale this session; did not block the read-only sweep but limits the dynamic-call-site pickup. Recommend `npx gitnexus analyze` before the next pass.

---

## Findings

| # | Priority | Section | Title |
|---|---|---|---|
| 1 | **P0** | HACCP / audit atomicity | `app/api/signoff/route.js` writes to `station_signoffs` (regulated CCP attestation) without a `postAuditEvent` call. [Full record](findings/2026-05-01-haccp-signoff-missing-audit.md). |
| 2 | **P2** | HACCP / Kitchen Assistant LLM action | `log_haccp_receiving` action silently demotes validator throws to `status='na'`, bypassing the yellow/red HACCP distinction. Defense-in-depth concern; catch is dead code on current main but sits on the LLM-driven path. [Full record](findings/2026-05-01-haccp-ka-llm-action-receiving-status-na-on-throw.md). |

No P1 or P3 findings this pass.

---

## Verified-correct surfaces

The same six-prong sweep cleared these specific shapes:

- **`lib/auditEvents.ts::postAuditEvent`** — defensive `safeJson` for exotic payloads, in-tx warning (not throw — caller must enforce), `safeJson` returns a stub object on error rather than losing the row. Contract preserved.
- **`app/api/gold-stars/route.ts`** — db.transaction wraps INSERT + postAuditEvent; outer try/catch is the standard 500 handler. Reference shape for the signoff fix.
- **`app/api/shows/[id]/box-office/[lineId]/route.js`** — false positive in the `db.transaction without postAuditEvent` grep; audit lives in `lib/boxOfficeRepo.ts::markScanned` which the route delegates to.
- **`app/api/dish-components/route.ts`** + **`app/api/shows/[id]/sound/[sceneId]/route.js`** — same pattern; audit (file-audit for sound, file-audit for dish-components since these are operational not regulated) lives in the repo helpers.
- **`lib/receiving.ts::validateReceivingReading`** — `accept_with_note` path for unknown category restored on current main; throws were the regression PR #95 introduced and reverted. Contract preserved.

---

## Test gaps surfaced

- **No `tests/js/test-signoff-audit-atomicity.mjs`.** The two existing tests touching `station_signoffs` (`test-bundle-h-apis.mjs`, `test-toctou-race-regressions.mjs`) treat the table as a read-only projection — they INSERT directly into the table for setup, never round-trip through the route. The P0 above is the first thing that should pin the new contract.
- **No `tests/js/test-kitchen-assistant-haccp-receiving-throw-path.mjs`.** The catch path on lines 474–503 is uncovered.
- **`tests/js/test-haccp-audit-atomicity.mjs`** does not include signoff in its fixture matrix. Recommend extending it once finding #1 is fixed.

---

## Recommended next moves

1. Fix finding #1 (signoff audit) on a fresh branch from `main`. Mirror `gold-stars/route.ts:36-47` exactly. Pair with `tests/js/test-signoff-audit-atomicity.mjs`. Single-purpose PR.
2. After #1 lands, fix finding #2 on a separate branch. The fix is small (`status = 'fail'` instead of `'na'` in the catch) but the test pattern is non-obvious because it requires forcing validateReceivingReading to throw — likely via `_setRuleResolverForTest` or a spy.
3. Schedule the next breaker pass for **Section 2 — PIN gate, manager routes, replay/curl protection** in the next session. That section interacts with #84 (now #100, audit atomicity fix) and the new `/management` rollup tile (#96), both of which moved through the merge train this session — high value to sweep.

---

## Stop conditions hit

None. Section 1 sweep completed within the time budget. P0 found but read-only mode held — no fix written this session.

---

## Workflow self-check

This was the first end-to-end run of the new breaker workflow. The mechanics worked as written:

- Worktree (`scripts/worktree.sh new claude breaker-audit-workflow`) gave isolation; no HEAD ping-pong with the merge-watch loop running in parallel.
- Agent-session claim (`docs/agentic/findings`) prevented overlap with the implementers fixing #89/#95/#96.
- Six-prong checklist surfaced the signoff gap on the first pass through the audit-atomicity surfaces.
- Evidence template (`templates/breaker-finding.md`) captured findings cleanly without the auditor improvising fields.
- Narrow tests > broad verify — never ran `npm run verify`; only targeted greps and reads.

One workflow tweak suggested for the next pass: add a **"call-graph reach"** prong before the six-prong checklist that uses `mcp__gitnexus__query` to enumerate every route under a section's surface set. The signoff finding came from a brute-force grep of `db.transaction` minus `postAuditEvent` — a graph query keyed on "writes to a regulated table" would have been faster and more thorough.
