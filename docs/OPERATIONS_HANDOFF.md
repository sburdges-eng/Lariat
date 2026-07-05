# Operations handoff — items only a human can close

Last updated: 2026-06-12. This is the canonical list of remaining work that
code cannot finish: hardware runs, real-shift pilots, credentials, product
decisions, and copy review. Each item carries its exact command or procedure.
When an item closes, update the matching roadmap row in
`docs/PROJECT_ROADMAP.md` and strike it here.

## 1. ~~Gen-7 iPad profiling run~~ — WAIVED (2026-06-12); optional device run

**Closed by operator waiver.** Cutover criterion 4 is satisfied by the
WebKit software acceptance (`docs/audit/2026-06-12-ipad-profile-software-v2.json`,
all flows within threshold). Residual risk to watch during Stage 1: under
a 4× CPU handicap the 86-add tap exceeded 100 ms — if cooks report a
sluggish 86 board on real iPads, that's the Stage-1 rollback trigger.

Optional device run (any time, non-blocking):

```
npm run profile:ipad -- --route-prefix /v2 --browser webkit --out docs/audit/ipad-gen7-v2-profile.json
```

per `docs/audit/2026-06-09-ipad-gen7-hardware-runbook.md`.

## 2. v2 cutover rollout (Stages 0–3, 30-day clock, v1 deletion)

Owner-driven per `docs/V2_CUTOVER_PLAN.md`:

- ~~**Stage 0**~~ **EXECUTED 2026-06-12, all flows pass** — production
  build, 22/22 codified e2e plus a real KDS ticket send and a station
  line-check persisted server-side; full record in
  `docs/audit/2026-06-11-v2-stage0-readiness-evidence.md`.
- **Stage 1 (ready to start)**: rollback owner named 2026-07-04 — Sean
  Burdges (<sburdges@gmail.com>), see
  `docs/audit/2026-06-11-v2-stage0-readiness-evidence.md` § Rollback
  owner. The only remaining step is in-person, on each pilot device:
  visit `/v2/enable` once (sets `lariat_v2=1`, lands on `/v2/today`) —
  no devtools needed. To pull a device back to v1 mid-shift (a rollback
  signal per the cutover plan), visit `/v2/disable`.
- **Stage 2**: manager-tier pilot after a clean cook window.
- **Stage 3**: default-on; start the 30-day clean-operation clock.
- After 30 clean days: delete v1 routes in a separate reviewable change and
  rerun the gates.

## 3. Tier-0 human items (roadmap 0.3 / 0.4)

- **0.3 LaRi manual smoke**: with Ollama running, ask cook-tier "any cooling
  cycles in progress?" and manager-tier "what did we sell today?", then
  confirm fresh `db_query` rows in `audit_events`.
- **0.4 product decision**: slim `GROUNDED_SYSTEM` for `/api/specials`, or
  accept that it sees rule #11 (open question from the 2026-05-16 handoff).

## 4. Optional integrations (health endpoint shows exactly what's missing)

`GET /api/health` reports `degraded` until these are configured in
`.env.local` (names in `.env.example`):

| Integration | What's needed |
|---|---|
| Ollama / LaRi | Ollama service running at `LARIAT_OLLAMA_URL` with the configured model pulled |
| Toast POS | `LARIAT_TOAST_CLIENT_ID` / `_CLIENT_SECRET` / `_RESTAURANT_GUID` |
| 7shifts | `LARIAT_7SHIFTS_API_KEY` |
| Prism | `LARIAT_PRISM_USERNAME` / `_PASSWORD` |
| Data pack | `data/lariat-data` symlink (or `LARIAT_DATA_ROOT`) populated via `scripts/datapack/download_all.py` then `extract_and_normalize.py` |

## 5. Spanish copy review (i18n, roadmap 3.8 — once W4 lands)

Every `lib/i18n/messages/es.ts` ships as machine-draft with a review banner.
An operator fluent in kitchen Spanish must redline the en/es tables in the
i18n PRs before the locale picker is exposed beyond the v2 preview cookie.

## 6. Local Whisper enablement (roadmap 2.6 — once W3 lands)

Voice transcription is off by default. To enable: set `LARIAT_WHISPER=1` in
`.env.local` and restart; the first use downloads ~75 MB (whisper-tiny) from
the Hugging Face hub — do this once on a network-connected maintenance
window, after which inference is fully local. Without the flag the composer
falls back to the on-device Web Speech API exactly as today.
