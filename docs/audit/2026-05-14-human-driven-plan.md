# Plan: completing the human-driven blocks (no 3rd-party admin auth needed)

**Generated** 2026-05-14, filtered from
`docs/audit/2026-05-14-upstream-and-deferred.md` and
`docs/audit/2026-05-14-hof-equipment-shortcomings.md`.

**Scope filter.** Items here need a human decision (operator or
product call) but do **not** require:
- signing or upgrading a 3rd-party agreement (Toast Partner API,
  Shamrock catalog API, Toast Inventory subscription, cloud-peer
  team cutover);
- a vendor support phone call to pull records (Auto-Chlor lease,
  Hobart fryer history, TECH hood-cleaning service log, fire-
  suppression certifier);
- any work that's blocked on another upstream/external thing
  shipping first.

Everything below can be started **today** with the resources we
already have.

---

## Sequence (recommended order)

| # | Item | First move | Effort | Why this order |
|---|---|---|---|---|
| 1 | **HOF kitchen re-photograph pass** | 30-min walk-through; ~16 data plates listed in shortcomings doc §B | S (~30 min) | Unblocks brand/serial gaps in `data/inventory/hof-equipment.csv` immediately. Operator can do it alone. |
| 2 | **HOF bar photo pass** | Capture under-bar coolers, glycol unit, beer-line, glass coolers, bar dishwasher; one overhead overview shot | S (~15 min) | Same trip as #1; produces the bar sister doc to `docs/floor-plans/hof-dining-room.md`. |
| 3 | **`compliance_rules.jsonl` drift policy** (T2) | One-line decision: commit-on-regenerate **or** gitignore + add `data/normalized/compliance_rules.jsonl` to `.gitignore` | S (5 min) | Settles the only persistently-dirty working-tree file; clears noise from every future `git status`. |
| 4 | **Lint config cleanup** (T1) | Inspect `eslint.config.js` for missing `globals.React` / `no-console` allowlist; one config diff | S (30 min) | Halves the 1458-error / 589-warning noise. Doesn't require operator preference call; just code hygiene. |
| 5 | **Periodic mDNS scheduler refresh** (D5) | Operator picks a tick cadence (recommend `LARIAT_SYNC_MDNS_REFRESH_MS=60000`) | S | Code is ready (`discoveredToPeers()` + `scheduler.setPeers()`); just need the cadence number + ~30-line lifecycle wire-in. |
| 6 | **Structured deny-side logging** (D6) | Design pass: pick retention shape (rotating JSONL vs SQLite append-only) | M | Unblocks any future surface that wants observable deny events (auth failures, sync apply skips, etc.). Build `lib/logEvent.ts` once, fan-out call sites later. |
| 7 | **TypeScript migration off `@ts-nocheck`** (D1) | Operator picks JSDoc-typedef path **or** `.js → .ts` rename | L | 256 files; pick the strategy once, then 6–8 PRs by directory. Add `lint:no-new-ts-nocheck` to CI before backfill to prevent regressions. |
| 8 | **`/management/cloud-bridge` settings UI** (D7) | Design pass: form layout + IPC contract for `settings:set` + dead-letter triage tile | M-L | T8b plumbing already shipped; this is the operator-facing surface. Can ship as two PRs after design. |
| 9 | **`/management/sync` UI** (D2) | Design pass: peer list + per-peer checkpoint + per-table apply counters; HTML-escape attacker-controlled column names | M | Builds on `npm run sync:status` CLI shape. The L3 HTML-escape requirement is documented in `applyWindow.reasons` docstring already. |
| 10 | **True PDF export** (E3) — *optional* | Decide whether HTML-save-as-PDF friction justifies a `pdfkit` parallel renderer | M | Skip if save-as-PDF isn't chafing operators. |

---

## Per-item one-paragraph plan

### 1. HOF kitchen re-photograph pass

Walk the kitchen with the list in
`docs/audit/2026-05-14-hof-equipment-shortcomings.md §B`. 16 data
plates to photograph; each is just "find the plate, square-on shot."
Examples: Vulcan range plate (kickplate or rear apron), Vulcan fryer
plate (inside front door above tank), Beverage-Air worktop plate
(inside lid or back), walk-in evaporator plate. Drop photos in
`~/Desktop/Equipment photos round 2/`; running the same vision-pass +
CSV-update flow against them is mechanical from there.

**Done when:** `data/inventory/hof-equipment.csv` has serial_number +
make_model filled for the 16 units that currently have brand-only.

### 2. HOF bar photo pass

Capture (top-down + per-asset data plates):
- Under-bar coolers — plate inside lid
- Glycol chiller — usually in BOH near walk-in
- Beer tower + lines + tap labels
- Glass cooler (if separate)
- Bar dishwasher / hand-sink config
- One overhead overview of the bar L-shape

**Done when:** `docs/floor-plans/hof-bar.md` exists and rows in
`hof-equipment.csv` for bar-zone equipment carry data.

### 3. `compliance_rules.jsonl` drift policy

The file is checked in but flagged "Never hand-edit — regenerated
from sources" in `CLAUDE.md`. It's been showing modified across
every recent session. Options:
- **A**: commit each regeneration alongside the source change that
  caused it. Pro: history shows compliance-rule evolution. Con: many
  noise commits.
- **B**: move the build output to `data/cache/compliance_rules.jsonl`
  and gitignore the originals path. Pro: zero diff noise. Con: have
  to re-run `compliance:build` after a fresh clone.

Operator picks one. Either is a 5-minute change.

### 4. Lint config cleanup

Most of the 1458 errors look like:
- `no-undef` × 679: React + JSX globals not declared in the eslint
  config.
- `react/jsx-no-undef` × 512: same root cause.
- `no-console` × 232: intentional operator-visible signals
  (`console.log` boot lines like `[sync-scheduler] started`).

Three changes likely fix most of it:
```js
// eslint.config.js
{
  languageOptions: {
    globals: { ...globals.browser, ...globals.node, React: 'readonly' },
  },
  rules: {
    'no-console': ['warn', { allow: ['warn', 'error', 'info', 'log'] }],
  },
}
```
Then verify `npm run lint` drops to <100 messages. No 3rd-party
auth; just a config tweak with an immediate signal.

### 5. Periodic mDNS scheduler refresh

Code primitives already shipped (`scheduler.setPeers()` +
`discoveredToPeers()`). Wiring is ~30 lines in
`lib/syncSchedulerLifecycle.ts`:

```ts
const intervalMs = Number(process.env.LARIAT_SYNC_MDNS_REFRESH_MS);
if (intervalMs > 0) {
  setInterval(async () => {
    const { discover } = await import('./mdnsDiscovery.ts');
    const peers = discoveredToPeers(await discover());
    handle.setPeers(peers);
  }, intervalMs).unref();
}
```

Operator just picks a cadence (recommend 60_000). Then ship the
20-line wire-in + a test.

### 6. Structured deny-side logging

Design choices the operator needs to make:
- **Storage**: rotating JSONL file at
  `${resolveDataDir()}/logs/YYYY-MM-DD.jsonl` (operator-friendly,
  greppable) **vs** SQLite append-only table (queryable from
  `/management/*` surfaces but adds DB write per deny).
- **Retention**: how many days? 30 default?
- **What to log**: every 401? Every 401 from a trusted peer with bad
  params? Only revoked-peer attempts? `auth.deny` + `sync.apply.skip`
  + `cloud_bridge.dead_letter` makes a coherent set.

Once picked, build `lib/logEvent.ts` (one helper, ~40 lines) + call
sites + GC script (mirror of `gc-sync-feed.mjs`).

### 7. TypeScript migration off `@ts-nocheck`

The pragma is on 256 files. Two viable strategies:
- **JSDoc typedefs** — keeps the `.js`/`.jsx` extension; types live
  in `/** @type {...} */` comments. Lowest churn, no rename.
- **`.js → .ts` rename** — uniform with the rest of the codebase,
  forces function signatures, bigger per-file diff.

Operator picks once; mechanical fan-out follows. Before doing any
backfill, add a CI guard:

```js
// .eslintrc — block NEW @ts-nocheck additions
'no-restricted-syntax': ['error', {
  selector: 'Program > BlockComment[value=/@ts-nocheck/]',
  message: 'No new @ts-nocheck; migrate to JSDoc / .ts',
}]
```

Then PR-by-PR (6–8 total) walks `app/api/`, `app/_components/`,
`lib/`, etc.

### 8. `/management/cloud-bridge` UI

T8b plumbing (`Settings.cloudBridgeUrl`,
`Settings.cloudBridgeSecret`, `settingsToChildEnv()`) already shipped
(commit `8104a2b`). What's needed:

- Form on `app/management/cloud-bridge/page.jsx`: URL field, masked
  secret field, save button.
- IPC contract: `settings:set` handler in `desktop/main.ts` that
  validates + persists.
- Dead-letter triage tile next to the form: count from
  `cloud_bridge_outbox` where `dead_letter=1`; per-row actions
  (replay, discard).

Design pass first (form layout + IPC contract), then implementation
in two PRs.

### 9. `/management/sync` UI

Operator-facing surface for the sync stack. Shows:
- **Peer list** — from `peer_trust` (fingerprint, label,
  last_seen_at, revoked).
- **Per-peer checkpoint** — from `replay_checkpoints` (peer_id,
  feed_scope, last_op_rowid).
- **Sync-feed depth** + per-source / per-table aggregates (same
  data the `npm run sync:status` CLI prints — render in the
  browser).
- **Recent apply outcomes** — pull from a future `sync_apply_runs`
  table (which we'd add) or from a rolling counter in memory.

L3 reminder: `applyWindow.reasons` strings include
attacker-controlled column names from `rowJson`. HTML-escape every
render site.

### 10. True PDF export (optional)

Today's flow: HTML route at `/api/shows/[id]/settlement/pdf` →
operator hits browser save-as-PDF. Works fine; minor UX friction.

If operators do this often enough to justify it, add **pdfkit** as a
runtime dep + a parallel renderer in `lib/settlementPrint.ts`:
- Same `SettlementSummary` input
- Builds page via `pdfkit` drawing primitives instead of HTML
- New route `/api/shows/[id]/settlement/pdf?format=pdf` returns
  application/pdf

~200 LOC. Skip if save-as-PDF isn't a real friction point.

---

## Out of scope (still need 3rd-party admin auth)

For reference — these stay parked until vendor-side action lands:

| item | blocker |
|---|---|
| D3 — Cloud-bridge HMAC → Ed25519 | cloud-peer team cutover |
| D4 — Toast bump round-trip | Toast Partner API write-path agreement |
| E1 — Shamrock catalog sync | Shamrock API access agreement |
| E2 — Toast Inventory mirror | Toast Inventory subscription + API agreement |
| Auto-Chlor lease history | call 719-299-0347 — operator-driven phone call |
| TECH Hood Cleaning service log | call 251-458-5594 |
| Hobart Vulcan fryer history | call 1-888-4-HOBART |
| Fire-suppression cert dates | photograph cylinder cert tag, then call certifier |

---

## Suggested commit cadence

When kicking each item off:

1. Start with whichever item the operator is in the mood for.
2. Items 1–5 are each a single commit. Items 6–9 are design-pass
   first (commit the design doc), then implementation as separate
   PRs.
3. Update this doc's status column as items close.

**Total estimated effort to clear items 1–7:**
- Item 1 (kitchen re-photos): 30 min operator + 30 min agent re-run
- Item 2 (bar photos): 15 min operator + 15 min agent
- Item 3 (compliance drift): 5 min
- Item 4 (lint config): 30 min
- Item 5 (mDNS cadence): 30 min after operator picks number
- Item 6 (structured logging): 1 day after design pass
- Item 7 (TS migration backfill): 2–4 weeks of part-time PRs after
  strategy pick

Items 8–10 are M/L UI work — sized appropriately.

---

*End of plan. Each item is self-contained — pick one, work it, ship
it, come back. No item blocks another except where called out
(items 8 + 9 want a design pass before code).*
