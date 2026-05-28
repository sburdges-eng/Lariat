# Upstream issues + tactics for human/API-blocked work

**Generated 2026-05-14** after closing the 28 of 29 audit findings
documented in `docs/audit/2026-05-14-phase-3.5-and-4-audit.md`.

This doc catalogs:
- **Fixed in this pass** — non-breaking quick wins shipped alongside.
- **Upstream issues** — third-party bugs we ran into; proposed
  tactics + suggested filings.
- **Blocked on human authorization** — work the agent can plan but
  needs an operator (or product) decision before starting.
- **Blocked on external APIs / agreements** — work that depends on
  a signed Toast / Shamrock / Sysco / cloud-peer relationship.

---

## ✅ Fixed in this pass

- **`lib/pin.ts` TODOs (audit-DiD)** — the two `TODO(audit-DiD)`
  markers in `requirePin` + `requirePinOrScope` are closed. Both
  deny paths now emit `Vary: Cookie` + `Cache-Control: no-store`
  so an intermediate cache can't serve a 401 to a request whose
  cookie state would now satisfy the gate. Scope-mismatch logging
  is intentionally not added inline (deferred to whichever PR
  introduces the structured-log surface — see below).

---

## Upstream third-party issues

### U1 — `gitnexus@1.6.4` npm package crashes on Node 24

**Symptom.** `npx gitnexus analyze` fails immediately with
`Cannot destructure property 'package' of 'node.target' as it is null.`
The package installs but the entry script throws on startup.

**Repro.**
```bash
cd <repo-root> && npx gitnexus@1.6.4 analyze
```

**Workaround in use.** The GitNexus MCP server still runs and the
index DOES refresh somewhere on its own (per `mcp__gitnexus__list_repos`,
the Lariat index has been keeping up with `main`). Only the CLI is
broken — the MCP query tools all work.

**Tactic.** File a GitHub issue against the GitNexus repo with the
exact error + Node version + reproduction. Likely a destructure of
`node.target` that worked under Node 20 but became `null` under
Node 24's stricter module-resolver. Until that ships, document
"use the MCP, not the CLI" in the project README. Workaround
documented inline in this commit message; no Lariat code change
needed.

**Effort.** Filing the issue: trivial. Waiting on a release: out of
our hands.

---

## Blocked on human authorization

### D1 — TypeScript migration off `@ts-nocheck` (GH#250)

**Scope.** 256 files in `lib/` and `app/` carry
`// @ts-nocheck — pre-#250 baseline. Remove once this file is
migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md`.
The pragma was added in a baseline pass so the build could enable
`checkJs` without a wholesale rewrite.

**Why blocked.** Two valid migration strategies, each with a
different operator preference:
1. **JSDoc typedefs in `.js`** — least churn, no rename, types
   live in comments. Per-file effort is small but tedious.
2. **Rename `.js` → `.ts`** — uniform with the rest of the codebase,
   forcing function signatures. Bigger diff per file; some files
   genuinely benefit from `@ts-nocheck` removal because they import
   browser-only globals or polymorphic helpers.

**Tactic.** Pick the migration strategy once (operator call), then
fan out per-route by directory. Each PR closes 5–15 files; total
6–8 PRs. Recommend starting with `app/api/` (smaller surface, type
benefits highest) and leaving `app/_components/` and large `.jsx`
files for last. Add a `lint:no-new-ts-nocheck` script that fails CI
if `@ts-nocheck` appears in a NEW file (forward-prevention without
forcing a backfill).

**Effort.** L (operator decides direction; then mechanical PR-by-PR
fan-out).

### D2 — `/management/sync` UI surface (audit L3)

**Scope.** When this UI is built, it will render
`applyWindow.reasons` strings which carry producer-supplied column
names (attacker-influenced via the producer's `rowJson`). The UI
must HTML-escape these.

**Why blocked.** The UI doesn't exist yet. Building it now is
premature — operators haven't decided what /management/sync needs
to show (peer list? checkpoint progress? per-table apply counters?).

**Tactic.** Add a comment in `lib/syncApply.ts::applyWindow`
docstring noting the requirement so the future UI author sees it.
Done in this commit.

**Effort.** S when the UI lands (1-2 lines per render site).

### D3 — Cloud-bridge HMAC → Ed25519 migration (audit Item 13)

**Scope.** `lib/cloudBridgePush.ts` signs with HMAC-SHA256 per the
v1 wire contract (`docs/cloud-bridge-backend-decision.md §4.2`). The
Ed25519 variant (§4.3) is designed but not built. Migration would
move per-location push-auth from a shared secret to a per-instance
keypair.

**Why blocked.** The receiver (cloud peer's Worker) must ship its
verifier in lockstep. We don't control the cloud peer.

**Tactic.** When the cloud-peer team is ready, both sides flip
together. Document the wire-contract version bump (`X-Lariat-Auth-Algo`
header to advertise + version-pin so a transitional period accepts
both signatures). Cloud-peer team owns the cutover schedule.

**Effort.** M on our side once the cloud peer is ready.

### D4 — Authoritative Toast bump round-trip (`docs/PHASE3_SCOPING.md §1`)

**Scope.** KDS bumps would propagate back to Toast via the Phase 2
outbound retry queue, making Lariat the authoritative source for
ticket state.

**Why blocked.** Operator decision (per the scoping doc, this is
"Decided + shipped (PR #140)" for the Lariat-local bump but Toast
round-trip remains "Phase 3.5 / Phase 4 follow-on"). Needs Toast
Partner API write paths, which the venue must sign up for.

**Tactic.** Operator signs the Toast Partner API agreement (or
re-confirms the existing one covers write scopes). Then a 2-3 day
implementation lands in the existing Phase 2 outbound retry queue.

**Effort.** M, gated on the agreement.

### D5 — Periodic mDNS-driven scheduler refresh (audit M10 follow-up)

**Scope.** Audit M10 shipped `discoveredToPeers()` + `setPeers()`
but didn't auto-wire a periodic mDNS poll loop in
`bootSyncScheduler`. An operator who wants dynamic discovery has to
write the `setInterval(() => discover().then(setPeers), 60_000)`
loop themselves.

**Why blocked.** Tick cadence is an operational decision — every
60s is fine for a stable LAN but might be wasteful for a 3-tablet
deployment that rarely changes. Letting the operator pick is more
honest than committing to one cadence.

**Tactic.** Add a single env knob `LARIAT_SYNC_MDNS_REFRESH_MS=60000`
that, when set, wires the periodic poll loop. Default unset = no
auto-discovery (matches today). 30-line addition to lifecycle when
operator sets the value.

**Effort.** S once the cadence is picked.

### D6 — Structured-log surface (deny-side logging from `lib/pin.ts`)

**Scope.** `requirePin` + `requirePinOrScope` (and various other
auth deny paths) could log structured `auth.deny` events for
observability. The pin.ts TODOs hinted at this.

**Why blocked.** Lariat has no central structured-log abstraction
today. Adding one alongside the audit `audit_events` table is a
real design decision: do we surface deny events through
`audit_events` (table grows), through `data/audit/management-actions.jsonl`
(file grows), or through console (no retention)?

**Tactic.** Build a small `lib/logEvent.ts` that takes
`(kind, fields, level?)` and writes to a per-day rotating JSONL
file under `${resolveDataDir()}/logs/`. Routes call
`logEvent('auth.deny', { route, reason })` on rejection. Tail with
`tail -f data/logs/YYYY-MM-DD.jsonl`. Operator picks retention
policy via a GC script (mirror of `gc-sync-feed.mjs`).

**Effort.** M (helper + 3-5 call sites + GC script + test).

### D7 — `/management/cloud-bridge` operator settings UI (T8b followup)

**Scope.** T8b shipped the `Settings.cloudBridgeUrl` +
`Settings.cloudBridgeSecret` plumbing. Operators still edit
`settings.json` by hand or pass env vars. The audit doc and the
T8b commit both note this as the remaining piece.

**Why blocked.** UI surface in `/management` overlaps with
authentication + PIN-gate flow + IPC integration with the Electron
main process. Three different layers that benefit from being
designed together rather than retrofitted piecemeal.

**Tactic.** Design pass first (form layout, IPC contract for
`settings:set`, dead-letter triage in the same surface per
cloud-bridge Item 9). Then implementation lands in two PRs:
1. IPC + settings persistence + form.
2. Dead-letter triage tiles.

**Effort.** M-L (UI work).

---

## Blocked on external APIs / agreements

### E1 — Shamrock read-only catalog sync

Documented in `docs/PHASE3_SCOPING.md §2`. Eliminates the
pack-change queue's input lag. Needs a Shamrock API access
agreement (weeks of lead time per the scoping doc).

**Tactic.** Operator engages Shamrock account rep. Once API key
materializes, the implementation pattern matches Toast — a
`scripts/ingest-shamrock-catalog.mjs` mirroring the existing
`scripts/ingest-toast-*.mjs` pattern. **Effort: M** once the
agreement closes.

### E2 — Toast Inventory mirror

Documented in `docs/PHASE3_SCOPING.md §2`. Needs Toast Inventory
module + signed write-back agreement.

**Tactic.** Operator decides whether the venue subscribes to Toast
Inventory (paid add-on). If yes, pull pattern mirrors existing
Toast sales ingest. **Effort: L** once the subscription + agreement
close.

### E3 — Scheduled-PDF reporting (extension of weekly digest)

The on-demand `/api/shows/[id]/settlement/pdf` + Monday-8am weekly
digest cron (`scripts/weekly-settlement-digest.mjs`) ship today.
Both produce HTML the operator saves-as-PDF. A true PDF export
(produces a `.pdf` file directly) would need either a headless
browser dep (Chromium ~150 MB) or a PDF library (`pdfkit` etc).

**Why deferred (not blocked).** Both options conflict with
Lariat's local-first / no-runtime-AI-coupling stance. Headless
browser pulls a significant binary; pdfkit doesn't render CSS so
the print-styled HTML would have to be rebuilt as raw drawing
commands.

**Tactic.** If the operator hits "save as PDF" friction often
enough to justify the dep, the cleanest path is **pdfkit + a
parallel renderer** in `lib/settlementPrint.ts` that builds the
same shape via drawing primitives instead of HTML. ~200 lines.
Skip headless browser — too heavy for the local-first install.

**Effort.** M if pursued.

---

## Tooling / repo-hygiene items (out of scope of audit but noted)

### T1 — Lint baseline is 1458 errors / 589 warnings

Most are `no-undef` (679) and `react/jsx-no-undef` (512) — these
look like eslint-config issues where the React/JSX globals aren't
in scope, not real undefined-identifier bugs. The 232 `no-console`
warnings are also mostly intentional (the `console.log`/`warn`
calls are used as operator-visible signals).

**Tactic.** A focused lint-config PR could halve the noise:
fix the React global resolution (probably needs the `@next/eslint`
preset or `globals: { React: 'readonly' }`), and toggle
`no-console: ['warn', { allow: ['warn', 'error', 'info'] }]` to
match the project's actual policy. Not breaking; ~30-minute
investigation followed by a 5-line config change. Defer until the
operator wants a quieter lint output.

### T2 — `data/normalized/compliance_rules.jsonl` shows as modified

Untouched throughout this session. Per `CLAUDE.md`: "Never
hand-edit — regenerated from sources." The file is checked in but
flagged not-for-editing. The current diff probably came from a
re-run of `npm run compliance:build`.

**Tactic.** Either (a) commit the regenerated file when its source
changes, or (b) move it to a build-output path that's gitignored.
Operator call.

---

## Summary table

| | Category | Item | Effort | Action |
|---|---|---|---|---|
| ✅ | Quick win | `lib/pin.ts` Vary:Cookie | S | Shipped this commit |
| 📝 | Upstream | gitnexus@1.6.4 CLI crash | trivial | File issue; workaround documented |
| 🚦 | Human | D1 TS migration off `@ts-nocheck` | L | Operator picks JSDoc vs .ts rename |
| 🚦 | Human | D2 /management/sync UI escape | S | When UI lands |
| 🚦 | Human | D3 Cloud-bridge Ed25519 | M | Awaits cloud-peer cutover |
| 🚦 | Human | D4 Toast bump round-trip | M | Awaits Toast Partner API agreement |
| 🚦 | Human | D5 Periodic mDNS scheduler refresh | S | Operator picks cadence |
| 🚦 | Human | D6 Structured deny-side logging | M | Design pass first |
| 🚦 | Human | D7 /management/cloud-bridge UI | M-L | Design pass first |
| 🌐 | External | E1 Shamrock catalog sync | M | Awaits Shamrock API agreement |
| 🌐 | External | E2 Toast Inventory mirror | L | Awaits Toast Inventory subscription |
| 🌐 | External | E3 True PDF export | M | Optional if HTML-save-as-PDF chafes |
| 🧹 | Hygiene | T1 Lint config noise | S | When quieter lint is wanted |
| 🧹 | Hygiene | T2 compliance_rules.jsonl drift | S | Operator: commit-on-change vs gitignore |

Legend: ✅ shipped now · 📝 documented · 🚦 needs operator decision ·
🌐 needs external agreement · 🧹 hygiene polish

**End of doc.** Updates land as resolutions come in.
