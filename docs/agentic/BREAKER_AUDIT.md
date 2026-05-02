# Breaker Audit Workflow

A repeatable "edge-caser / section debugger / code breaker / logic gapper" loop that finds real defects in Lariat without broad, noisy churn. Read-only by default; one fix at a time when fixes are approved.

Companion to [`AGENT_ROLES.md`](AGENT_ROLES.md) and [`MULTI_TOOL_PIPELINE.md`](MULTI_TOOL_PIPELINE.md). The Reviewer role from those docs is general-purpose; this is the deep, repeatable form.

## When to run

- Pre-freeze passes (e.g. before a Phase boundary or a release cut).
- After any regulated rule-module change (HACCP, audit_events, PIN gate).
- After any settlement / costing / inventory math change.
- Periodically — every two weeks — as scheduled background hygiene via `/schedule`.

## When NOT to run

- During an active outage. Triage first, audit later.
- During a multi-PR merge train (false positives explode while branches are stale).
- On a green-and-quiet day with no recent landings — skip and come back when there's actual diff to chew on.

---

## 1. Setup / Containment

```bash
# Per-tool worktree to avoid HEAD ping-pong with concurrent sessions.
scripts/worktree.sh new claude breaker-audit       # or codex / gemini
cd ../Lariat-worktrees/claude-breaker-audit

# Register the session so other tools can see what's claimed.
node scripts/agent-session.mjs update \
  --tool claude --role reviewer \
  --status "Breaker audit: section <name>" \
  --claimed "docs/agentic/findings,tests"
```

Discovery is **read-only** unless a specific fix is approved by the Orchestrator. Any write — even a docs-only finding capture — is a separate explicit step.

---

## 2. Section Map

Audit by subsystem, not file order. The eight sections, in priority of regulatory and financial blast radius:

| # | Section | Surfaces | Key invariants |
|---|---|---|---|
| 1 | **HACCP rules + API audit atomicity** | `lib/<concept>.ts`, `app/api/<concept>/route.js`, `lib/auditEvents.ts` | DB-audit row inside the same `db.transaction` as the source INSERT; never weakened thresholds; FDA/CO citations sourced from the rule module |
| 2 | **PIN gate, manager routes, replay/curl protection** | `middleware.js`, `lib/pin.ts`, `/analytics`, `/costing`, `/purchasing`, `/management`, `/menu-engineering`, `/beo` | Both middleware AND in-route `hasPinCookie()` re-check; HMAC-signed cookie via `LARIAT_PIN_SECRET` |
| 3 | **Location scoping** | every operational + financial route, `lib/location.ts`, `useLocation()`, `LOC_EVENT` | Every row carries `location_id`; routes derive from `?location=` or body, NEVER from cookie/header/session |
| 4 | **Costing, inventory, vendor price history, unit parity** | `lib/computeEngine/`, `lib/costingBenchmarks.mjs`, `vendor_prices_history`, `lib/unitConvert.mjs`, `scripts/lib/units.py` | DELETE+INSERT preserves history snapshot AND beverage rows; JS↔Python parity byte-identical |
| 5 | **Shows, settlement, box office, stage/sound ops** | `lib/showsRepo.ts`, `lib/settlementRepo.ts`, `lib/dealPoints.ts`, `box_office_lines`, `show_deals` | Talent payout math vs guarantee/vs%/buyout; settlement variance ≤ $5 / 0.5%; reconciliation against ticket source |
| 6 | **Kitchen Assistant, Specials, Ollama / Data Pack degraded states** | `app/api/kitchen-assistant`, `app/api/specials`, `lib/ollama.ts`, `lib/datapackSearch.ts`, `lib/complianceSearch.ts` | Ollama down → 502 + UI banner, never silent; missing data pack symlink → `available()=false` no-op, never throw |
| 7 | **UI copy rules + money formatting** | every `app/<surface>/`, `docs/UI_COPY_RULES.md` | Kitchen verbs, 5–8th grade reading level; cents always shown via the same formatter; never `Math.round(x*100)/100`-style float drift |
| 8 | **Offline / PWA / e2e flows** | `next.config.*`, service worker, Playwright suite | Offline cook-flows degrade to localStorage drafts; on-reconnect sync never duplicates rows |

Run sections **one at a time**. Don't blend findings across sections.

---

## 3. Breaker Pass Per Section

For each section, run the same six-prong checklist. Write nothing yet — just attempt to break it.

| Prong | Question |
|---|---|
| **Contract** | What invariant must NEVER break? Quote the source-of-truth doc or rule module. |
| **Boundary cases** | Empty, null, malformed, duplicate, stale, over-limit, cross-location, negative numbers, NaN, very large numbers, future dates, far-past dates, non-ASCII, mixed encoding. |
| **Transaction risk** | Can a primary write succeed while audit / log / cache fails? Does a partial failure leave a row without an audit trail? |
| **Determinism risk** | Floating package, `Date.now()`, local path assumption, hidden network call, non-deterministic test setup, random retry order. |
| **Security risk** | PIN bypass via stale cookie or path matcher gap, location spoofing via body vs query mismatch, unchecked JSON shape from LLM-action handler, path traversal in file ops, SQL via string concat. |
| **User risk** | Confusing cook/manager copy, raw error JSON shown to user, money formatted as float, time zone surprises, PII leaked in logs. |

Use the GitNexus tools (`mcp__gitnexus__query` for concept search, `mcp__gitnexus__impact` for blast radius) so you find dynamic/string-keyed call sites that grep misses.

---

## 4. Evidence Capture

Every suspected issue gets a short record using [`templates/breaker-finding.md`](templates/breaker-finding.md). Capture **as you find them**, not at the end of the section — context is freshest when you spot the break.

```
Subsystem:
Invariant:
Break attempt:
Observed result:
Expected result:
Risk:
Repro command:
Likely files:
Fix class: test-only / logic / schema / UI / docs
```

Findings live at `docs/agentic/findings/<YYYY-MM-DD>-<section>-<slug>.md`. One file per finding so they review/cite cleanly.

---

## 5. Test Strategy (narrow → wide)

In Lariat, prefer narrow tests that pin behavior over broad sweeps:

```bash
# Pure rule modules (HACCP thresholds, citations)
npm run test:rules

# Schema migration idempotency + assertCriticalSchemas
npm run test:schema

# Critical finance + audit acid
node --experimental-strip-types --test tests/js/test-financial-acid.mjs
node --experimental-strip-types --test tests/js/test-haccp-audit-atomicity.mjs

# Settlement
node --experimental-strip-types --test tests/js/test-settlement-repo.mjs tests/js/test-settlement-route.mjs tests/js/test-deal-points.mjs

# Compute engine regression contracts (C1–C4 / R2-C5 / I2 / I4)
npm run test:compute-engine

# JS↔Python parity helpers
npm run test:unit-convert
npm run test:ingredient-key

# UI regressions (Jest + jsdom — scoped to app/__tests__/**)
npm run test:unit

# TS .ts imports under node --test
node --experimental-strip-types --test tests/js/test-<name>.mjs

# Browser smoke — only after targeted is green
npm run test:e2e
```

The `--experimental-strip-types` flag is required for any `node --test` that imports a `.ts` file directly. See `package.json` for the canonical patterns.

**Never** run `npm run verify` first — it's the wide gate, run last.

---

## 6. Output

Produce one prioritized report per audit pass, written to `docs/agentic/audits/<YYYY-MM-DD>-breaker-audit.md`:

| Tier | Definition | Examples |
|---|---|---|
| **P0** | Data loss, audit bypass, PIN/security, regulated HACCP violation. | Audit row missing on regulated INSERT; PIN cookie accepted without HMAC verify; cooling-rule threshold weakened |
| **P1** | Cross-location leakage, money/math wrong, failed degraded mode. | `loc=DEFAULT_LOCATION_ID` hardcode; cents stored as float; Ollama-down returns 200 with empty body |
| **P2** | Confusing UI copy, missing edge tests, weak validation. | "rollup tile" jargon; route accepts negative quantity; missing test for 0-row CSV |
| **P3** | Cleanup, docs, non-blocking polish. | Stale comment; redundant cast; lint-only change |

A P0 stops the rest of the audit until triaged. P1 gets a fix branch within the same session. P2/P3 batch into a follow-up issue.

---

## 7. Fix Loop

For each approved fix:

1. **GitNexus impact first** — `mcp__gitnexus__impact({target: "<symbol>", direction: "upstream"})`. Stop and report if HIGH/CRITICAL.
2. **Write the failing test** — pure-rule test if possible, route test if not. The test pins the new contract.
3. **Minimal fix** — smallest diff that makes the test pass. No speculative refactors riding along (those go through `REFACTOR_GOVERNANCE.md`).
4. **Targeted test** — re-run only the tests for this section.
5. **Section-level test** — re-run the full section's test list.
6. **`git diff --check`** for whitespace, then typecheck/build only when blast radius warrants.

Commit message convention:
```
fix(<section>): <one-liner>

Found via breaker audit YYYY-MM-DD. Section: <section>.
Invariant: <quoted from rule module / doc>.
Repro: <one-line repro>.
```

---

## Change Declaration (for this workflow doc)

- **Affected subsystem:** QA/debug automation for Lariat.
- **Freeze-readiness impact:** improves freeze confidence.
- **Determinism impact:** positive — runner uses pinned commands and no live cloud dependencies.
- **Security impact:** positive — focused on finding bypasses.
- **Runtime coupling introduced:** NO.

---

## See also

- [`AGENT_ROLES.md`](AGENT_ROLES.md) — base role definitions; this workflow expands the Reviewer role.
- [`MULTI_TOOL_PIPELINE.md`](MULTI_TOOL_PIPELINE.md) — which tool runs which role.
- [`REFACTOR_GOVERNANCE.md`](REFACTOR_GOVERNANCE.md) — the sister workflow for structure changes.
- [`templates/breaker-finding.md`](templates/breaker-finding.md) — finding template.
- `docs/PATTERNS.md` §1 (rule-module shape), §3 (audit two-track), §4 (location scoping), §10 (LLM action JSON).
- `docs/ARCHITECTURE.md` §4 (PIN gate), §7 (compute engine).
