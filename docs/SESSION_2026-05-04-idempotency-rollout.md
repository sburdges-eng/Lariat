# Session Summary — 2026-05-04 — §8 P1 SW-replay idempotency rollout

> Closes the breaker-audit Section 8 P1 invariant from `docs/agentic/findings/2026-05-02-sw-replay-no-idempotency.md`: "on-reconnect sync never duplicates rows." Every regulated mutation route now opts into `withIdempotency`. End-to-end HTTP-level dedup test landed; the deeper SW-queue round-trip e2e is acknowledged TODO.

## Completed Work

### Idempotency wrapper rollout (10 PRs)

- **#126** — HACCP rule-module routes (10): `beo`, `cleaning`, `cooling`, `date-marks`, `pest`, `sanitizer`, `sds`, `sick-worker`, `thermometer-calibrations`, `tphc`
- **#127** — Shows phase-2 (5): `shows/[id]/{deal,sound,sound/[sceneId],stage,box-office/[lineId]}`
- **#129** — Labor compliance + regulated stockout (4): `eighty-six`, `eighty-six/resolve`, `breaks`, `certifications`
- **#130** — Inventory financial (5): `inventory`, `inventory/counts`, `inventory/counts/[id]`, `inventory/counts/[id]/lines`, `inventory/par`
- **#131** — FOH (5): `dining-tables`, `dining-tables/[id]`, `reservations`, `reservations/[id]`, `service-hours`
- **#132** — Equipment (4): `equipment`, `equipment/maintenance`, `equipment/parts`, `equipment/schedule`
- **#133** — Prep + tracking (5): `prep-tasks`, `prep-tasks/[id]`, `gold-stars`, `gold-stars/[id]`, `preshift-notes`
- **#134** — Specials (3): `specials`, `specials/saved`, `specials/saved/[id]`
- **#135** — Misc finishers (7): `checks`, `cleaning-schedule`, `recipes/[slug]`, `compute/status`, `costing/pack-changes`, `dish-components`, `kitchen-assistant`

Plus prior session: #118–#121 shipped the wrapper kit + coverage gate; #126/#127 retrofitted the first batches.

`TODO_RETROFIT` set in `tests/js/test-idempotency-coverage.mjs`: **48 → 0**.

### Adherence pattern applied to every retrofit

- Wrapper sits AFTER any PIN gate and BEFORE the handler body
- `postAuditEvent()` stays inside the handler's `db.transaction(...)` — wrapper does not span the audit boundary
- Un-keyed callers pass through unchanged (header opt-in)
- GitNexus pre-edit `impact()` per representative handler — every result LOW risk, 0 affected processes
- Per-batch worktree (`scripts/worktree.sh new claude <branch>`); session-board claim before edits, clear after

### Conflict resolution during merge cascade

Each open PR's `tests/js/test-idempotency-coverage.mjs` conflicted with sister PRs' overlapping comment-block edits to the same `TODO_RETROFIT` Set. Resolution pattern: keep both drain-comments side by side; drop duplicate listed entries that main had already drained. Three force-with-lease pushes total (initial rebase pass + two cascade rebases for #133 and #135).

### Gitnexus stat regen + chore

- **#128** — `npx gitnexus analyze` index-stat refresh in `AGENTS.md` / `CLAUDE.md` (14,895 → 16,537 symbols; 22,920 → 25,447 relationships; flow count stable at 300)

### E2E + SW production bug fix (#136 — open)

- **Production bug found and fixed:** `public/sw.js::handleMutation` was consuming the request body via `fetch(request)` in the try-branch, leaving `request.text()` in the catch-branch to read an empty string. Every offline mutation was queued with an empty body; replay POSTs returned `500 "SyntaxError: Unexpected end of JSON input"`; the SW's `replay()` left 5xx entries in the queue → entries piled up indefinitely. Only manifests on actual network failures, so it slipped past every prior §8 P1 PR — none exercised the queue path. Fix: clone + read body BEFORE the network attempt. Found via trace inspection on the first SW round-trip e2e attempt that failed.
- **SW queue → replay round-trip e2e** — closes the spec acceptance criterion (*"queue → throttle online → replay → exactly one row written, even when the original POST is artificially 'lost-after-commit'"*). `context.route().abort()` aborts the first POST, SW catches → enqueues with the now-correctly-captured body, replay POST goes through, server commits, queue drains, GET confirms exactly one row.
- **Idempotency-key cache reuse e2e** — same key + body twice → wrapper cache hit → identical row id (no fresh insert). HTTP-level proof of the spec dedup contract against a live Next.js server.
- **`LARIAT_E2E_PORT` env-aware Playwright config** — `code-assist-mcp` was holding port 3000 (5-day uptime) → Playwright was reusing the wrong process and all SW-dependent tests were timing out at `serviceWorker.ready`. Defaults to 3000 to preserve `npm run test:e2e`.
- **Pre-existing UI-copy test fix** — `/offline/i` → `/no connection/i` to match #115's kitchen-verb UI-copy sweep.

  6/6 tests pass. tsc clean. `test-idempotency-{wrapper,coverage}.mjs` — 11/11, no regression.

## Outstanding Issues

(none specific to §8 P1 — fully closed end-to-end including the spec acceptance criterion)

### Operational

- Local main reset to `origin/main` after a stray pull (worktree cwd drift). Verified.
- 8 worktrees + 9 merged feature branches pruned; 2 worktrees left with foreign uncommitted state (`claude-idempotency-retrofit-labor-stockout` — auto-regen markdown noise; `codex-specials-review` — another tool's WIP). Both safe to leave.
- Session board: my claims cleared. Stale gemini handoff from 2026-05-01 left untouched (not mine).

## Files touched (representative)

```
lib/idempotency.ts                           (existing — wrapper, unchanged this session)
app/api/<route>/route.{js,ts}                (35+ routes wrapped this session)
tests/js/test-idempotency-coverage.mjs       (TODO_RETROFIT drained to 0)
tests/e2e/offline-queue.spec.ts              (placeholder → working cache-reuse test, #136)
playwright.config.ts                         (LARIAT_E2E_PORT env-aware, #136)
AGENTS.md / CLAUDE.md                        (gitnexus stat regen, #128)
```

## References

- Plan: `docs/superpowers/plans/2026-05-02-sw-replay-idempotency-plan.md` — Tasks 1–4 + bulk retrofit
- Spec: `docs/superpowers/specs/2026-05-02-sw-replay-idempotency-design.md` — wrapper contract + acceptance criteria
- Finding: `docs/agentic/findings/2026-05-02-sw-replay-no-idempotency.md` — original §8 P1 capture
