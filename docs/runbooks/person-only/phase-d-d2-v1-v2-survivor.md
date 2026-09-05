# Phase D D2: pick the surviving behavior for each /v2 vs v1 duplicate

**Why this is yours:** Endgame §6 item 4 is an open owner decision and the D2 checklist row defers to a "`v2-freeze-closeout` outcome" that was never recorded as a v1-vs-v2 survivor call — the close-out only left `v2.0.0` tag-pending and fixed the rollout shape as "cookie-gated side-by-side `/v2`, v1 default". Choosing which tree's behavior survives also overrides the live P5 pilot and the cutover plan's "no v1 deletion until 30 clean days" rule, which only the named rollback owner (you) can keep or waive.
**Unblocks:** D3 delete waves (which tree goes first); the native parity target (native tracks the *surviving* behavior, not both); whether P5 Stage 1 still matters.
**Where:** chat (read-only checks on this laptop)  **Time:** 1h
**Status:** open — per `docs/superpowers/plans/2026-08-05-phase-d-edge-reduction.md:17` (`[ ] D2`); still listed as open decision at `docs/superpowers/specs/2026-07-02-lariat-native-endgame.md:130-132`

## Before you start
- [ ] D1 (freeze edge scope) is recorded — check: `grep -n "D1 Freeze" docs/superpowers/plans/2026-08-05-phase-d-edge-reduction.md` → must show `[x]`. Today it shows `[ ]` (line 16). You may *draft* D2 in the same sitting as D1, but do not tick D2 before D1.
- [ ] The duplicate inventory is still 9 v2 pages — check: `find app/v2 -name 'page.jsx' | sort | wc -l` → expect `9`. If not, the table in step 4 is stale; re-derive it with step 2 before deciding.
- [ ] Know whether the Stage 1 pilot has started — check: `grep -n "^status:" docs/superpowers/plans/2026-08-05-v2-stage1-pilot.md` → expect `planned — code complete; in-person enablement`. Anything else means the 30-day clock (`docs/V2_CUTOVER_PLAN.md:128`) may be running; read "If something goes wrong" first.

## Steps
1. **Read the two authorities that pull in opposite directions.** Open `docs/V2_CUTOVER_PLAN.md` lines 27-39 and 126-140, then `docs/superpowers/specs/2026-07-02-lariat-native-phase-d-e-checklists.md` lines 14-30 → expect: the cutover plan forbids deleting v1 until v2 has 30 clean default-on days; Phase D D3 deletes *all* operator pages (v1 and v2) so only edge-blocker surfaces survive. D2 is therefore "which behavior native tracks and which tree D3 removes first", not "which tree the web keeps". If that framing is wrong for you, say so in step 5 — it is the product call.
2. **Inspect what each `/v2` page actually is.** From the repo root:
   `find app/v2 -name 'page.jsx' | sort | while read -r f; do printf '%s -> %s\n' "$f" "$(grep -o "from '[^']*page\.jsx'" "$f" | head -1)"; done`
   → expect: 7 pages print a `from '../..(/..)/<v1>/page.jsx'` import (they wrap the v1 component and add only a hero/shell); `app/v2/today/page.jsx` and `app/v2/page.jsx` print nothing (own implementation / hub with no v1 twin). If a wrapper now prints nothing, it has forked — treat it like the Today row.
3. **See which behavior native already ports.** `grep -rn "app/v2/today\|/v2/today" LariatNative/Sources --include='*.swift'` → expect exactly two hits: `LariatNative/Sources/LariatModel/Compute/StationProgress.swift:84` (mirrors `stationTone()` from `app/v2/today/page.jsx`) and `LariatNative/Sources/LariatApp/UI/Boards/TodayView.swift:137` (`/v2/today` → `/v2/kds/punch` link parity). Native's default board is `cook.today` (`LariatNative/Sources/LariatModel/FeatureCatalog.swift:43,150`). If the grep returns nothing, native has been re-targeted since this runbook was written — ask which agent did it and why before deciding.
4. **Fill the table — one survivor per row.** Only the first row is a real behavior fork; the seven wrapper rows share the v1 component by construction, so their survivor is "v1 component; v2 shell dropped" unless you want the v2 shell kept for its Spanish cook chrome (the EN/ES picker and translated cook shells live only in the v2 tree — `docs/PROJECT_ROADMAP.md:233`; Spanish copy is still machine-draft pending your review).

   | Web pair | Same code? | Native today | Your call |
   |---|---|---|---|
   | `/` (`app/page.jsx` `TodayPage`, `rushColor()` :18) vs `/v2/today` (`stationTone()` :17, 330 lines) | **No — real fork** | `cook.today` mirrors `/v2/today` | v2 / v1 |
   | `/kds/punch` vs `/v2/kds/punch` (`app/v2/kds/punch/page.jsx:3`) | wrapper | — | v1 component |
   | `/eighty-six` vs `/v2/eighty-six` (`:3`) | wrapper | — | v1 component |
   | `/stations` vs `/v2/stations` (`:3`) | wrapper | — | v1 component |
   | `/stations/[id]` vs `/v2/stations/[id]` (`:3`) | wrapper | — | v1 component |
   | `/command` vs `/v2/command` (`:3`) | wrapper | — | v1 component |
   | `/management` vs `/v2/management` (`:3`) | wrapper | — | v1 component |
   | `/analytics` vs `/v2/analytics` (`:3`) | wrapper | — | v1 component |
   | `/v2` hub + `/v2/enable` + `/v2/disable` | no v1 twin | — | goes with the losing tree |

   Then pick the package:
   - **Option A — v2 behavior survives** (what the endgame already leans to, `endgame.md:130-131`): native Today keeps targeting `/v2/today`; P5 Stage 1 stays meaningful only as web-edge continuity (`2026-08-05-v2-stage1-pilot.md:29`); D3 removes v1 operator routes first. You must also say whether the cutover plan's 30-day rule (`V2_CUTOVER_PLAN.md:39,128`) is **kept** (D3 waits for 30 clean days) or **waived** (native is the daily driver after the G0 shutoff test, so web operator pages are already dead — `endgame.md:40-47`).
   - **Option B — v1 survives, `/v2` is the frozen variant and is deleted**: native Today must be re-targeted to `app/page.jsx` semantics (`rushColor()` vs `stationTone()` differ in token names and ordering); P5 is waived; `V2_CUTOVER_PLAN.md` and `OPERATIONS_HANDOFF.md` §2 are retired; Spanish cook chrome is dropped or re-homed. Blast radius for the D3 agent: `app/v2/**` (13 files), `middleware.js:29-31,137-139`, `app/_components/navRegistry.js:94-96,139-168`, 9 `tests/js/test-v2-*.mjs`, `tests/e2e/v2-smoke.spec.ts`, `app/v2/__tests__/V2ManagerRoutes.searchParams.test.jsx`, `tests/js/test-nav-shortcuts.mjs:37-39`, `tests/js/test-middleware-pin-fail-closed.mjs:50`, `tests/js/test-service-date-symmetry.mjs:180`, `scripts/profile-ipad-cook-surfaces.mjs:340-341`, `package.json:31,35` (test lists). Ignore `/v2/` hits in `scripts/sevenshifts_api/`, `scripts/toast_api/`, `scripts/toast-weekly-pull.mjs` — those are vendor API paths.
5. **Say the decision in chat, in this shape.** Manual action, no command:
   `D2 decided <YYYY-MM-DD>: Option <A|B>. Today survivor = </v2/today | />. Wrapper rows = v1 component. 30-day rule = <kept | waived because …>. Native Today target = <unchanged | re-target to app/page.jsx>. P5 = <continues | waived>.`
   → expect: the agent echoes it back verbatim and makes no code change. Anything still "both" or "TBD" means D2 is not done — leave the checkbox open.
6. **Let the agent do the paperwork, then confirm.** It edits the files listed under "Record the result" (in the `sean` worktree from Close out) → expect: `git diff --stat` shows only docs (+ `tasks.yaml` header comment if P5 changed) and no file under `app/`, `lib/`, `middleware.js`, or `LariatNative/`. If it touched code, stop — route deletion is D3, not D2.

## Pass / fail
From the plan's own wording: **"exactly one behavior survives"** per duplicate pair (`checklists.md:16-17`, `phase-d-edge-reduction.md:17`) and **native parity targets the surviving behavior, not both** (`endgame.md:131-132`).
- PASS: every row in the step-4 table names one survivor; the Today fork names its native target; the 30-day rule has an explicit kept/waived line from the rollback owner; P5 status is stated.
- FAIL / not done: any row "both"/"TBD", or the 30-day-rule interaction left unsaid. Do not tick D2.

## Record the result
- Evidence: no template exists for decisions — the evidence is the step-5 line plus the filled step-4 table, written into `docs/superpowers/specs/2026-07-02-lariat-native-endgame.md:130-132` (§6 item 4) as `**Decided YYYY-MM-DD:** …` under the existing text. Fill: option letter, the 9-row table, 30-day-rule kept/waived, native Today target, P5 fate.
- Then update:
  - `docs/superpowers/plans/2026-08-05-phase-d-edge-reduction.md:17` → `[x] D2 …` (note: the operation ticket says line 16; line 16 is D1 — D2 is line 17).
  - `docs/superpowers/specs/2026-07-02-lariat-native-phase-d-e-checklists.md:16-17` → `[x] D2.` + `(outcome: Option <A|B>, YYYY-MM-DD)`.
  - `docs/PROJECT_STATUS.md` row 39 "Web `/v2` Stage 1 cook pilot" and bullet 59 under "Blocked on an owner decision" (Option B: state `waived by D2`; Option A: unchanged), refresh the as-of SHA at line 10 per the rule at line 132.
  - `docs/superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md:27` (front 4 row) and `:33` (P5 row) per the status-sync rule at `:69-76`.
  - Option B only: `docs/superpowers/plans/2026-08-05-v2-stage1-pilot.md:4` status → `waived — D2 <date>`; `docs/V2_CUTOVER_PLAN.md:3-25` header → retired-by-D2 note; `docs/OPERATIONS_HANDOFF.md:25-44` §2 strike-through with the date; `tasks.yaml:23` header comment.
  - Option A only: add one line to `docs/V2_CUTOVER_PLAN.md` "30-day clean-operation rule" (`:126-130`) stating kept or waived for Phase D D3.
  - Leave `docs/LARIAT_NATIVE_FINAL_AGENT_GUIDE.md:74` as is — Phase D stays open until D7.

## Close out
```bash
scripts/worktree.sh new sean chore/phase-d-d2-v1-v2-survivor
```
Commit the evidence and doc updates on that branch and open a PR (the repo's /ship skill runs the verify gate). Never push to main.

## If something goes wrong
- Can't settle the Today fork: default to the endgame's own lean (v2 behavior, `endgame.md:130-131`) because native already mirrors it; record it as `provisional` in §6 item 4 and leave `phase-d-edge-reduction.md:17` unticked.
- Stage 1 already running when you get here and you pick Option B: that is a rollback event — visit `/v2/disable` on each pilot device first (`docs/OPERATIONS_HANDOFF.md:38-39`), then record trigger, route, shift impact and time per `docs/V2_CUTOVER_PLAN.md:118-124`, then decide.
- An agent starts deleting `app/v2/**` or v1 pages on the strength of this decision: stop it. Deletion is D3, gated on C5 (`phase-d-edge-reduction.md:4`; serial order `gap-execution-index.md:36`) and needs Opus/Max review before Phase D route deletion (`docs/LARIAT_NATIVE_FINAL_AGENT_GUIDE.md:93`).
- Nothing in this runbook touches HACCP, PIN, or money paths; if a doc edit drifts into `middleware.js` or `lib/`, revert it and re-scope to D3.
