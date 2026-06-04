# Lariat Runtime UX Audit - June 4, 2026

Runtime navigation audit of the packaged macOS app. This pass looked for bugs, dead paths, confusing flows, and user-facing failure states in the Electron-served Lariat Cockpit.

**Scope.** `dist/mac-arm64/Lariat.app`, served at `http://127.0.0.1:3000`, version `v0.1.00.001` from `/api/discover`. The app was a test release with Toast, 7shifts, Prism, and data-pack integrations disabled or unavailable. Manager-gated pages were checked only to the PIN boundary; I did not brute-force PINs or inspect private `.env` values.

**Method.** Headed Playwright navigation, route sweep, targeted form submissions, local health/discovery probes, browser console capture, and source spot-checks for findings that looked structural. Primary runtime artifact: `output/playwright/lariat-route-sweep-2026-06-04.json`. Supporting Playwright console/snapshot artifacts are under `.playwright-cli/`.

**Change declaration.**

| Item | Impact |
|---|---|
| Affected subsystem | Documentation only. Findings cover station checks, Gold Stars, Specials, data-pack lookup, station navigation, PIN-gated routing, and local discovery. |
| Freeze-readiness impact | Blocks a clean freeze until the HIGH findings are triaged. MEDIUM findings can be staged but should not be ignored for a staff-facing release. |
| Determinism impact | Report only: none. Findings include nondeterministic or misleading UI states that should be fixed in code. |
| Security impact | Report only: none. Findings include open destructive Gold Stars deletion and weak PIN-gate disclosure/context. |

## Severity Legend

- **HIGH** - Can corrupt or lose operational records, hides a failed regulated write, or exposes destructive actions without adequate guardrails.
- **MEDIUM** - Breaks a visible workflow, returns raw/internal errors to staff, or creates a dead path in primary navigation.
- **LOW** - Polish, accessibility, or setup/discovery issue that can wait behind the higher-risk items.

## Findings

### F1. Station pass/fail can post `status: null`, 500 the API, and leave the UI lying - HIGH

**What happened.** On a station checklist, tapping an already-selected Pass button toggled the row locally to empty, sent `status: null` to `/api/checks`, and produced `HTTP 500`. The browser showed an alert, but the local checklist stayed changed until reload. Reload restored the persisted pass state, proving the UI and database diverged after the failed write.

**Evidence.**

- Browser console: `.playwright-cli/console-2026-06-04T07-11-28-315Z.log` captured `500 (Internal Server Error)` for `POST /api/checks`.
- UI code: `app/stations/[id]/StationChecklist.tsx` computes `const toggled = rowFor(item).status === status ? null : status` and posts that value.
- API code: `app/api/checks/route.js` preserves `body.status === null ? null : ...` and inserts it.
- Schema: `lib/db.ts` defines `line_check_entries.status TEXT NOT NULL CHECK(status IN ('pass','fail','na'))`.

**Why it matters.** `line_check_entries` feeds HACCP/audit/signoff behavior. A staff tap can produce a failed regulated write and a stale local UI. The failure mode is especially bad because the visible checklist briefly implies the row was cleared, while the persisted record remains unchanged.

**Related actor gap.** A fresh Pass tap succeeded even when no cook was selected. `persist()` blocks with "Pick your name in the sidebar first", but `setStatus()` uses `cookRef.current || null` and posts anyway. That permits anonymous pass/fail records in a regulated checklist.

**Fix sketch.**

1. Decide the correction model explicitly: no deselect, an `na` state, or a real correction/delete endpoint. Do not insert `null` into `line_check_entries.status`.
2. Require cook selection for Pass/Fail the same way note/par/have/need persistence does, unless anonymous HACCP rows are an intentional product decision.
3. On non-2xx, roll back the optimistic local state or immediately refresh from the server.
4. Add focused tests for pass, fail, repeated pass tap, repeated fail tap, and no-cook behavior.

### F2. Gold Stars allows open hard-delete with no confirmation, PIN, or delete audit - HIGH

**What happened.** `/gold-stars` is reachable without a manager PIN and shows `Remove` buttons beside existing recognitions. I did not click Remove because it is destructive. Source confirms the client optimistically deletes the row and calls `DELETE /api/gold-stars/:id`; the API performs a hard delete from `gold_stars`.

**Evidence.**

- Snapshot: `.playwright-cli/page-2026-06-04T07-10-28-659Z.yml` shows Gold Stars rows with `Remove` buttons.
- Client: `app/gold-stars/GoldStarBoard.tsx` calls `handleDelete(record.id)` from each Remove button and then `fetch(..., { method: 'DELETE' })`.
- Delete route: `app/api/gold-stars/[id]/route.ts` runs `DELETE FROM gold_stars WHERE id = ? AND location_id = ?`.
- Insert route: `app/api/gold-stars/route.ts` audits inserts, but the delete route has no matching audit event.
- Accessibility/structure: the page renders its main title as `h2`, not `h1`.

**Why it matters.** Gold Stars are staff recognition and HR-adjacent data. An open LAN client can remove records without a manager gate, confirmation prompt, actor binding, or audit trail.

**Fix sketch.**

1. Add a confirmation affordance for Remove.
2. PIN-gate deletes, or restrict them to a signed cook/manager role if the project adds per-user auth.
3. Prefer soft delete (`deleted_at`, `deleted_by`) over hard delete.
4. Write a delete audit event in the same transaction as the mutation.
5. Promote the visible page title to `h1`.

### F3. Specials exposes raw Ollama failure instead of preflighting like Kitchen Assistant - MEDIUM

**What happened.** Kitchen Assistant detects Ollama reachability on load and shows a clear alert: "AI is down. Can't connect to Ollama on the office Mac. Ask a manager to start it." Specials does not do the same preflight. Entering a pantry/prompt and clicking Run it returned `502` and displayed raw text: `fetch failed`.

**Evidence.**

- Browser console: `.playwright-cli/console-2026-06-04T07-04-18-779Z.log` captured `502 (Bad Gateway)` for `POST /api/specials`.
- Specials UI: `app/specials/page.jsx` posts directly to `/api/specials` and displays `data.error` or caught exception text.
- Specials API: `app/api/specials/route.js` catches Ollama errors and returns `String(e.message || e)` with status `502`.
- Kitchen Assistant contrast: `app/kitchen-assistant/KitchenAssistantClient.jsx` calls `/api/kitchen-assistant?ping=1`, stores `ollamaReachable`, and renders a staff-readable down-state.

**Why it matters.** Specials is an operator-facing creative tool. When local AI is unavailable, staff see a developer-level transport error instead of the same actionable "start Ollama" message used elsewhere.

**Fix sketch.**

1. Add `GET /api/specials?ping=1` use on page load, mirroring Kitchen Assistant.
2. Disable Run it when Ollama is unavailable, or keep it enabled with a clear local-AI-down alert.
3. Map backend transport failures to staff-readable copy. Do not show raw `fetch failed`.

### F4. Data Pack and Allergen Lookup only reveal disabled state after submission - MEDIUM

**What happened.** The app health probe reported data-pack unavailable/disabled in this release. `/allergen-lookup` and `/datapack-search` still present normal search controls. A Nutella allergen search returned `503` and then showed `Data pack not available on this server - see scripts/datapack/README.md`.

**Evidence.**

- Browser console: `.playwright-cli/console-2026-06-04T07-05-04-108Z.log` captured `503 (Service Unavailable)` for `/api/datapack/search?op=search&source=off&q=nutella&limit=20`.
- Allergen UI: `app/allergen-lookup/AllergenLookupClient.jsx` only shows the unavailable state after `response.kind === 'unavailable'`, and the message includes `scripts/datapack/README.md`.
- Data Pack UI: `app/datapack-search/DatapackSearchClient.jsx` uses the same post-submit unavailable message.

**Why it matters.** Staff can waste time entering a lookup before discovering the feature is unavailable. The visible message also leaks a developer path into the line-cook UI, conflicting with the project's UI copy rules.

**Fix sketch.**

1. Preflight data-pack availability before enabling search controls.
2. Replace the developer-path message with operator copy, for example: "Reference data is not installed on this Mac. Ask a manager to finish setup."
3. Align `/api/health` detail and the user-facing disabled state so the same condition is explained consistently.

### F5. Runner is a primary station shortcut but the destination is a dead end - MEDIUM

**What happened.** The home screen and sidebar present six station shortcuts and include Runner. `/stations/runner` then renders only "No line check for this station."

**Evidence.**

- Route sweep: `output/playwright/lariat-route-sweep-2026-06-04.json` records `/stations/runner` with `h1: ["Runner"]` and problem text `No line check for this station.`
- Data: `data/cache/stations.json` defines Runner with `line_check_key: null` and `setup_key: null`.
- Station page: `app/stations/[id]/page.jsx` renders the empty state when `items.length === 0`.
- Navigation: `lib/lineSummary.ts` says `press 1-6`, and `app/_components/Sidebar.jsx` renders `stations.slice(0, 6)`.

**Why it matters.** A main station shortcut should open a usable station workflow. If Runner is just a position marker, it should not occupy the same station-check shortcut lane as Grill, Fry, Garde Manger, Brunch, and Expo.

**Fix sketch.**

1. Either give Runner a real FOH/runner checklist or remove it from primary station shortcuts.
2. If it remains visible, make the destination useful: current runner tasks, Expo handoff, table-run notes, or a clear back action.
3. Update the line summary so "press 1-6" does not promise six active line-check workflows when only five exist.

### F6. Sensitive route links look ordinary until the user hits a generic PIN wall - LOW

**What happened.** Command-center cards and sidebar links to sensitive pages look like normal Open actions. Clicking them redirects to `/login-pin?next=...`. The PIN page explains "sales numbers, costs, and the rest of the back-office pages," but does not name the specific destination the user clicked.

**Evidence.**

- Middleware: `middleware.js` gates `/analytics`, `/costing`, `/purchasing`, `/menu-engineering`, `/beo`, `/management`, `/booking`, `/playbook`, `/shows`, `/specials/saved`, and `/host`.
- Login copy: `app/login-pin/page.jsx` uses generic "Sensitive pages" text.
- Login form: `app/login-pin/LoginPinForm.jsx` has a password field without a hidden username field; Chrome emitted the standard password-form accessibility/autocomplete warning during the failed PIN attempt.

**Why it matters.** The gate is doing its job, but the route disclosure is weak. A cook does not know before tapping whether a link needs a manager, and the PIN page does not explain the exact destination or why it is gated.

**Fix sketch.**

1. Mark manager-only links before click with a compact lock/PIN indicator.
2. Have `/login-pin` derive a safe human-readable destination from `next`, for example "Open Costing" or "Open Host Stand".
3. Add the optional hidden username field pattern Chrome expects for password forms, or intentionally configure autocomplete for the single-PIN model.

### F7. mDNS service-name conflict was only visible in logs - LOW

**What happened.** During packaged-app launch, the server log reported `Service name is already in use on the network` after advertising Lariat on port 3000. `/api/discover` still returned the local app identity, so the HTTP app was usable, but Bonjour discovery may be unreliable for iPads or peer devices.

**Evidence.**

- Runtime launch log observed in the packaged app's local server log.
- Discovery endpoint returned `name: "lariat"`, version `v0.1.00.001`, location `default`.

**Why it matters.** Discovery failures are setup failures, not kitchen workflow failures, but they are hard for staff to diagnose if the only signal is in a local log file.

**Fix sketch.**

1. Retry with a unique service instance name when Bonjour reports a collision.
2. Surface discovery status in `/api/health` and any install/connect screen.
3. Make the log action-oriented: "Another Lariat is advertising this name. Rename this Mac or stop the other instance."

## Additional UX Notes

- Existing Gold Stars sample data has inconsistent capitalization and typos. If this page is staff-visible, add a manager edit flow or normalize display copy at entry time.
- `/install` appears in the Electron app while also telling users to install the browser app "when you are not in the Mac app." That may be valid for iPad onboarding, but the copy should be Mac-aware.
- `/kds/punch` renders a disabled `x` button before any item has been added. Low severity, but it reads like a broken control.
- `/bar` is a primary nav item but shows "No cocktail recipes found." If bar recipes are intentionally absent in the test release, show setup/empty-state copy rather than a content failure.

## Recommended Fix Order

1. Fix F1 first. It is a regulated checklist write failure with UI/database divergence and actor ambiguity.
2. Fix F2 next. Open hard-delete without audit is a data-loss and accountability problem.
3. Fix F3 and F4 together. Both are unavailable-dependency UX failures and can share a health/preflight pattern.
4. Decide Runner's product role before freeze. It should either be a real station workflow or not appear as one.
5. Polish PIN-gate disclosure, install copy, and mDNS collision messaging after the blocking workflow issues are cleared.

## Verification Notes

- This report is documentation-only. No code, schema, or data mutations were made for the report.
- The packaged app did launch and route navigation worked for public pages.
- Gated pages were intentionally not audited behind the manager PIN boundary.
- Destructive Gold Stars Remove was not clicked; the finding is based on visible UI plus source/API verification.
