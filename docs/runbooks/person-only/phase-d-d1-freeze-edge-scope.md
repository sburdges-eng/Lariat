# Phase D D1: freeze the permanent web edge scope

**Why this is yours:** The edge-blocker log still says "TBD" for which PWA/remote read surfaces survive (edge-blockers:38-39), and whether `/login-pin` survives is a keep-list conditional (checklists:22). Both are product calls on the permanent web surface; irreversible Phase D decisions are owner/Max-tier only (agent guide:86, :93). Agents do the doc edit and, later, the deletions.
**Unblocks:** D2 `/v2` collapse, D3 deletion waves, D4 keep list, D5 route-count CI guard, Phase E.
**Where:** chat (this laptop, repo root)  **Time:** 1h
**Status:** open — per `docs/superpowers/plans/2026-08-05-phase-d-edge-reduction.md:4` (`status: planned — gated on C5`) and `:16` (`[ ] D1`)

## Before you start
- [ ] C5 write-route cutover complete — check: `sed -n 4p docs/superpowers/plans/2026-08-05-c5-write-cutover.md` → must no longer read `status: planned — gated on C4`. On 2026-09-01 it still does (C5 ← C4 `c4-reconcile.md:4` "gated on G0 PASS" ← G0 `g0-gui-smoke-and-shutoff.md:4` "ready-for-owner"). The call itself is paper-only; the plan gates the whole front on C5 (`phase-d:4`, `tasks.yaml:19`). If you take it early, D3 deletions stay gated regardless.
- [ ] A5.4 still ratified as option B — check: `grep -n "RATIFIED" docs/superpowers/specs/lariat-native-edge-blockers.md` → expect line 55.
- [ ] Tree state known — check: `git -c core.fsmonitor=false status --short` → `CLAUDE.md`/`AGENTS.md` may be dirty from another session; leave them alone.

## Steps
All steps run on this laptop from the repo root, with an agent in chat.

1. **Pull the live web route inventory.** `find app -name 'page.jsx' -o -name 'page.tsx' -o -name 'page.js' | grep -v __tests__ | sort` then `find app/api -name 'route.js' -o -name 'route.ts' | sort` → expect ~102 page routes and ~132 API route files (2026-09-01 counts). This is the list you are shrinking to the log. If counts differ wildly, someone already started D3 — stop and ask.
2. **Read the three inputs.** `sed -n 33,39p docs/superpowers/specs/lariat-native-edge-blockers.md` (the TBD); `sed -n 14,23p docs/superpowers/specs/2026-07-02-lariat-native-phase-d-e-checklists.md` (D1 + D4 keep list); `sed -n 168,176p docs/superpowers/specs/2026-07-03-lariat-native-a4-cost-variance-and-a54.md` (A5.4 ratified) → expect exactly one open TBD (PWA/remote read surfaces) and one conditional (`/login-pin`). Anything else is already decided.
3. **Decide PWA / remote browser access (the TBD).** Facts: PWA = `app/install/`, `public/manifest.json`, `public/sw.js`, registered by `app/_components/PWASetup.jsx:8` from `app/layout.jsx:37`. All six manifest shortcuts (`manifest.json:21-26`) point at operator pages (`/`, `/eighty-six`, `/stations`, `/kitchen-assistant`, `/specials`, `/beo`) that D3 deletes. `/boh` offline line book depends on `sw.js` caching (`lib/boh/helpers.ts:11`). `/install` reads the `/api/health` mDNS probe (`app/install/page.jsx:41-46`). Say one of these in chat:
   - **(A) Drop PWA.** No remote read surface. `/install`, manifest, `sw.js`, `PWASetup` go in D3.
   - **(B) Keep PWA for a NAMED list of remote read-only pages.** Write every route. Each joins the edge set; manifest shortcuts get pruned to that list.
   Default if unsure, per edge-blockers:39 ("narrow to the minimum actually used remotely"): **(A)**, unless you can name a phone/iPad that reads a web page off the Mac today.
4. **Decide `/login-pin`.** Facts: `/beo/share/*` and `/api/beo/share/*` are public carve-outs (`middleware.js:71-73`) — the guest surface needs no PIN. `/management/peers` and `/management/cloud-bridge` are kept per A5.4 (edge-blockers:68-69) and sit under the `/management` sensitive prefix (`middleware.js:14`), which redirects to `/login-pin` (`middleware.js:112`). So `/login-pin`, `lib/pinCookie`, and `POST /api/auth/pin` (`app/api/auth/pin/route.ts:1`) **stay** as long as those admin pages stay; Phase C spec `:81` deferred the edge auth story to exactly this step. The only way to drop it is dropping the A5.4 admin pages — say that explicitly if that is the call. Confirm the other `/api/auth/*` routes (`manager-pins`, `temp-pin/{issue,list,login,revoke}`) are **not** edge unless (B) named a page that needs a temp PIN.
5. **Rule on every unlogged candidate.** Each is "edge" (agent appends a blocker entry in the format at edge-blockers:13-19) or "not edge" (one line in the frozen-scope section):
   - Electron desktop wrapper `desktop/` — "Electron supervisor + child Next.js server" (`desktop/README.md:3`). Absent from the blocker log and every Phase D doc. Wraps the edge server after D, or retires in favor of the native app?
   - `/api/discover` + mDNS — part of the ratified peers transport (edge-blockers:57-58). Confirm it stays.
   - `/api/health` — used by `/install` and the D6 edge runbook. Follows (A)/(B).
   - `/v2/*` — none are edge (endgame open decision 4, `endgame:129-131`). D2 picks the survivor; D1 states no `/v2` route is in the edge set.
   - C2 `schema_version` refusal handshake — keep, no decision (checklists:22-23; `c2-c3 spec:53-56`).
6. **Have the agent write the freeze into the log.** It edits `docs/superpowers/specs/lariat-native-edge-blockers.md`: replace the TBD at `:38-39` with the decided text; append `## Frozen edge scope — YYYY-MM-DD` listing every kept page route, API route, and static file (manifest/`sw.js` if kept), plus a "Ruled out" list with one-line reasons → expect `grep -n "TBD" docs/superpowers/specs/lariat-native-edge-blockers.md` prints nothing.
7. **Check the frozen list against the tree.** For each kept route run `ls -d app/<route>` (API routes: `ls app/api/<route>/route.*`) → expect the path. If one is missing, the log is wrong, not the tree — fix the log.
8. **Review the diff.** `git diff --stat` → expect only docs (the log, roadmap entry, plan/checklist checkboxes, PROJECT_STATUS row, this runbook). No code deletion rides on this PR — that is D3 and needs Opus/Max review (agent guide:93).

## Pass / fail
- **PASS** = checklist D1's own criterion (checklists:14-15): the log has no TBD and is the *whole* web surface — every surviving page route, API route, and static PWA file named (or "none"); A5.4 transport listed unchanged; `/login-pin` ruled with its reason; every step-5 candidate ruled; every kept route exists in `app/`. This feeds the Phase D gate "Route inventory == blocker log ∪ ratified transport" (`phase-d:26`).
- **FAIL** = any TBD / "if needed" / "maybe" left; a kept route not in the tree; a `/v2` or operator page in the edge set without a blocker entry saying why it cannot be native.

## Record the result
- Evidence: the edited `docs/superpowers/specs/lariat-native-edge-blockers.md` (TBD at `:38-39` replaced; new dated Frozen edge scope section; a new entry per candidate ruled edge). No decision-record template exists; the dated append-only decision log is `docs/PROJECT_ROADMAP.md` (`:3-5`) — add `## YYYY-MM-DD Phase D D1 — edge scope frozen` with the (A)/(B) call, the `/login-pin` ruling, and the desktop-wrapper ruling.
- Then update:
  - `docs/superpowers/plans/2026-08-05-phase-d-edge-reduction.md:16` → `1. [x] D1 …` (the operation card says :15; the checkbox is on :16). Leave `:4` as `gated on C5` unless C5 has exited; if D1 was taken early, make `:4` read `status: D1 frozen YYYY-MM-DD — D2–D7 gated on C5`.
  - `docs/superpowers/specs/2026-07-02-lariat-native-phase-d-e-checklists.md:14` → `- [x] D1.`
  - `docs/PROJECT_STATUS.md:48` row "Native 1.0 gap fronts": append to Evidence "Phase D D1 edge scope frozen YYYY-MM-DD — `lariat-native-edge-blockers.md`"; refresh the as-of SHA at `:10` per `:132`. No "Blocked on an owner decision" bullet (`:55-62`) mentions Phase D — nothing to remove.
  - `docs/OPERATIONS_HANDOFF.md`: no Phase D item exists in §1–§6 (`:9-78`) — nothing to strike.
  - This runbook's **Status** line and its row in `docs/runbooks/person-only/README.md` (directory absent on 2026-09-01; `/person-only` creates it).
  - Do **not** touch gap index `:27` or agent guide `:74` — those flip at D7 per the status-sync rule (gap index `:62-67`).

## Close out
```bash
scripts/worktree.sh new sean chore/phase-d-d1-freeze-edge-scope
```
Commit the evidence and doc updates on that branch and open a PR (the repo's /ship skill runs the verify gate). Never push to main. Exclude `CLAUDE.md` and `AGENTS.md` — dirty on `main` from another session.

## If something goes wrong
- Paper-only decision: rollback is `git revert` of the docs PR. Nothing runs differently until D3.
- An agent starts deleting routes off this PR → stop it. Deletions are D3, gated on C5 (`phase-d:4`) and Opus/Max review (agent guide:93).
- Cannot name (B)'s list → take (A). Adding a remote read surface later is an append to the living log (edge-blockers:3); resurrecting one after D3 deleted it is a rewrite.
- Keeping `/login-pin` feels wrong → the only path is dropping `/management/{peers,cloud-bridge}`, which reopens ratified A5.4 (edge-blockers:76-78). Say so in chat; do not do it inside D1.
- Tell: chat, or `.agent-sessions/handoff.md` (AGENTS.md:83).
