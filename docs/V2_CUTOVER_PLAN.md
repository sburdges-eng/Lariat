# V2 cutover plan

**Status:** Entry criteria 1–3, 5–6 satisfied as of 2026-06-11 — see
`docs/audit/2026-06-11-v2-stage0-readiness-evidence.md` (parity audit, Stage-0
smoke `tests/e2e/v2-smoke.spec.ts`, freeze-gate results). The sole remaining
entry blocker is criterion 4: gen-7 iPad hardware evidence
(`npm run profile:ipad -- --route-prefix /v2` per the 2026-06-09 hardware
runbook). This plan keeps v1 live as the safety rail and defines when to
advance, when to roll back, and when old routes can finally be deleted.

## Goal

Move operators from v1 to the `/v2` route tree without disrupting cooks, inventory truth, KDS flow, or manager reporting.

## Scope

This plan covers the v2 route tree introduced by roadmap rows 2.10–2.12:

- cook-tier: `/v2/today`, `/v2/kds/punch`, `/v2/eighty-six`, `/v2/stations/*`
- manager-tier: `/v2/command`, `/v2/management`, `/v2/analytics`
- rollout shape: cookie-gated side-by-side v2 tree while v1 remains available

It does **not** authorize deleting v1 routes on cutover day. v1 stays intact until v2 has 30 clean days in production.

## Entry criteria before any cutover

Do not start rollout until all of these are true:

1. The v2 shell is still side-by-side and opt-in only.
2. Cook-tier and manager-tier route migrations are complete enough for a full shift:
   - cooks can run `/today`, KDS punch, eighty-six, and station boards in v2
   - managers can run command, management, and analytics in v2
3. Freeze gates pass on the release candidate:
   - route and focused workflow tests
   - schema and idempotency checks
   - path-policy and cache-artifact checks
   - `typecheck`
   - production build
4. Hardware evidence is attached for the cook-tier iPad profiling lane before default-on rollout.
5. The venue is still operating in the current single-venue v2 shape; no multi-venue cutover is bundled into this move.
6. Staff-facing copy for the shifted screens is reviewed for line-cook language.

## Release evidence to capture

Before rollout, attach one release note or handoff entry with:

- commit SHA or tag for the candidate
- commands used for the final gates
- iPad profile result for cook-tier tap-to-feedback flows
- known limitations that are acceptable for the first 30 days
- named rollback owner for the shift window

## Rollout stages

### Stage 0 — internal preview only

- Keep v1 as the default experience.
- Use the existing preview cookie to limit v2 to internal verification.
- Run a full shift-style smoke check in v2:
  - cooks: today board, KDS punch, eighty-six, station board flow
  - managers: command, management, analytics
- If any critical flow fails, stop here and fix it before staff pilot.

### Stage 1 — cook-tier pilot

- Turn on v2 only for the smallest practical pilot group or shift.
- Keep v1 available for immediate fallback.
- Watch the cook-tier proof points closely:
  - tap-to-feedback speed stays acceptable on the target iPad
  - KDS punch updates land correctly
  - eighty-six actions update the same truth seen elsewhere
  - station boards stay readable and do not hide active work
- If cooks need to bounce back to v1 to finish service, treat that as a rollback signal.

### Stage 2 — manager-tier pilot

- After at least one clean cook-tier pilot window, extend pilot use to command, management, and analytics.
- Confirm the manager tier matches the same operational truth as cook-tier and inventory surfaces.
- Keep v1 manager pages available during the pilot.

### Stage 3 — default-on cutover

- Make v2 the default experience only after Stage 1 and Stage 2 both complete without rollback signals.
- Keep v1 routes reachable as the fallback path.
- Start the 30-day clean-operation clock on the first full day of default-on use.

## Rollback criteria

Roll back to v1 immediately if any of these happen:

1. A cook cannot complete a core shift flow in v2:
   - today board work
   - KDS punch
   - eighty-six action
   - station-board execution
2. Manager screens show incorrect, stale, or mismatched operational truth.
3. Any route bypasses the expected auth or preview gating.
4. Inventory, KDS, or eighty-six actions write incorrect data or fail to sync across the expected views.
5. Cook-tier responsiveness regresses enough that service work is materially slowed.
6. A production issue requires a hotfix that cannot be verified quickly enough to keep the shift safe.

## Rollback steps

1. Put operators back on v1 immediately.
2. Remove the v2 default-on state and return to preview-only access.
3. Record the trigger, affected route, shift impact, and rollback time in the handoff/release log.
4. Fix the issue in a normal reviewable slice before another rollout attempt.
5. Reset the 30-day clean-operation clock after the next successful default-on restart.

## 30-day clean-operation rule

- Do not delete v1 routes during the first 30 days of default-on v2 operation.
- "Clean" means no rollback event and no unresolved production issue that forces staff back to v1 for a core workflow.
- If a rollback happens on day 29, the clock restarts after the next successful default-on cutover.

## End-of-window cleanup

After 30 clean days:

1. confirm no rollback issues remain open
2. confirm staff no longer depend on v1 for any shift-critical flow
3. remove v1 routes in a separate, reviewable cleanup change
4. rerun the same route/auth/build gates after removal
5. update roadmap and handoff notes to mark v1 retirement complete

## Explicit non-goals

- no same-day deletion of v1 routes
- no multi-venue rollout bundled into v2 cutover
- no "auto-correct" of food-safety or inventory records to make rollout look clean
- no copy changes that make cook workflows more verbose during service
