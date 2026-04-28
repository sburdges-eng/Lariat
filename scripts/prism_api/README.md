# Prism.fm adapter (Phase 5 — SCAFFOLD)

Pulls events from Prism.fm into `prism_events` (raw landing) and resolves each event through `lib/entities.ts::resolveOrCreateEvent` so it lives on a canonical `entities_events` UUID. Lets the BEO board (`beo_events`) link to a Prism-managed booking by UUID instead of being the only event surface.

## Status

**This adapter is a scaffold.** Prism.fm does not publish a public developer portal. Before this adapter can be flipped on we need three pieces of information from your Prism CSM (account manager):

1. **API key** — the credential that authorizes API requests against your tenant.
2. **Base host** — the URL host (no scheme); confirm whether you're on `api.prism.fm` or a tenant-specific subdomain.
3. **Endpoint shape** — the actual path that lists events for a date range, plus the response envelope (`events: [...]`, `data: [...]`, or unwrapped array). Different Prism tenants have been observed using different shapes.

While these are pending, the `client.mjs::getPrismEvents` function throws a clear `Prism.fm adapter is a SCAFFOLD` error when called against a real host so a half-configured environment fails loud. The mapper (`scripts/ingest-prism.mjs::eventToRow`) and the resolver call shape are already in place and unit-tested with a mock `fetchImpl`, so once the three open questions above are answered:

- Set `REAL_ENDPOINT_PATH` in `scripts/prism_api/client.mjs` to the path Prism gave you.
- If Prism uses something other than `Authorization: Bearer`, edit the `headers` block in the same file (commonly `X-API-Key: <key>` or `?api_key=<key>` query string).
- Fix `eventToRow`'s field plucking if Prism's schema differs from the field names guessed in the scaffold (`headliner`, `doors_at`, etc.).

## Setup (once API access is granted)

1. Add to `.env.local` at the repo root:

   ```
   PRISM_API_KEY=<key>
   PRISM_API_HOST=<host without scheme>
   # Optional, if your tenant is venue-scoped:
   PRISM_VENUE_ID=<id>
   ```

2. Run the ingest:

   ```bash
   node --experimental-strip-types scripts/ingest-prism.mjs --since=2026-04-01 --until=2026-05-31
   node --experimental-strip-types scripts/ingest-prism.mjs --apply --since=…
   ```

## Why this isn't fully implemented yet

We deliberately don't ship a guess at Prism's auth header or endpoint shape. A wrong guess that happens to return a 200 from a similarly-named public endpoint would silently land bogus rows in `prism_events`. The scaffold throws on every real-host call until a human confirms the endpoint shape, then the unblocking change is a 5-line edit.

## What lands when this is wired up

| Source | Destination |
|---|---|
| Prism event id | `prism_events.prism_id` (raw) + `external_ids` row (source='prism') |
| Event date / doors / show / venue / headliner | `prism_events` flat columns |
| Resolved entity | `entities_events.uuid` via `resolveOrCreateEvent` |

After Prism is live, the BEO board can stop being the only place events exist: a Prism-sourced event resolves to an entity UUID, and BEO line items reference that UUID via a future column (Phase 6).
