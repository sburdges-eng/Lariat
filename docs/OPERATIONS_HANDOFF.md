# Operations handoff — items only a human can close

Last updated: 2026-06-12. This is the canonical list of remaining work that
code cannot finish: hardware runs, real-shift pilots, credentials, product
decisions, and copy review. Each item carries its exact command or procedure.
When an item closes, update the matching roadmap row in
`docs/PROJECT_ROADMAP.md` and strike it here.

## 1. Gen-7 iPad profiling run (roadmap 2.21 — blocks v2 cutover criterion 4)

The only remaining v2 cutover entry blocker. With the iPad on the kitchen
network and the server running:

```
npm run profile:ipad -- --route-prefix /v2 --out docs/audit/ipad-gen7-v2-profile.json
```

Procedure and acceptance: `docs/audit/2026-06-09-ipad-gen7-hardware-runbook.md`.
Record results in `docs/audit/2026-06-09-ipad-gen7-hardware-evidence-template.md`
and attach the JSON to `docs/audit/2026-06-11-v2-stage0-readiness-evidence.md`.
Gate: every flow p95 ≤ 100 ms.

## 2. v2 cutover rollout (Stages 0–3, 30-day clock, v1 deletion)

Owner-driven per `docs/V2_CUTOVER_PLAN.md`:

- **Stage 0**: internal full-shift smoke in v2 (preview cookie). The
  automated equivalent already passes (`tests/e2e/v2-smoke.spec.ts`).
- **Stage 1**: cook-tier pilot — name a rollback owner for the shift window
  first (placeholder lives in the Stage-0 evidence note).
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
