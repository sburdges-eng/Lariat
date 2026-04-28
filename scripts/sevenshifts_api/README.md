# 7shifts adapter (Phase 4)

Pulls users, shifts, and time punches from the 7shifts v2 REST API and lands them in raw tables (`sevenshifts_users`, `sevenshifts_shifts`, `sevenshifts_time_punches`). The ingest then resolves each user through `lib/entities.ts::resolveOrCreateEmployee` so the same person seen by Toast (already backfilled in Phase 2) gets unified onto one entity UUID.

## Setup

1. Generate a **Personal Access Token** in 7shifts:
   - Log into 7shifts → Integrations → Personal Access Tokens → New token
   - Scope: read-only is sufficient for the ingest paths we use today
   - Copy the token (you won't see it again)

2. Find your **company ID**:
   - It's the numeric segment in the URL when you're logged into the 7shifts admin: `https://app.7shifts.com/companies/<COMPANY_ID>/...`

3. Add to `.env.local` at the repo root:

   ```
   SEVENSHIFTS_API_TOKEN=<token>
   SEVENSHIFTS_COMPANY_ID=<id>
   # SEVENSHIFTS_API_HOST=api.7shifts.com  # optional override
   ```

   `.env.local` is gitignored. **Never** commit the token.

## Run the ingest

```bash
# dry-run — pulls but does not write to the live DB
node --experimental-strip-types scripts/ingest-sevenshifts.mjs

# commit
node --experimental-strip-types scripts/ingest-sevenshifts.mjs --apply

# limit to one resource (users | shifts | time_punches)
node --experimental-strip-types scripts/ingest-sevenshifts.mjs --apply --only=users
```

The default time window for shifts/time-punches is **the last 35 days**. Override with `--since=YYYY-MM-DD` and `--until=YYYY-MM-DD`.

## Idempotency

Each raw-landing table has a `UNIQUE(seven_id, location_id)` constraint and the ingest uses `INSERT ... ON CONFLICT DO UPDATE`, so re-running with overlapping windows updates in place rather than duplicating.

## Entity resolution

Users → `entities_employees` via `resolveOrCreateEmployee` with `source_system='7shifts'`, `external_id=<seven_id>`. The same human seen earlier under `source_system='manual'` (cook_id) or `source_system='toast'` (Toast labor) does NOT auto-merge — that's an entity-resolution problem (Phase 6). Phase 4 just keeps the per-source mapping clean.

## Endpoints touched

| Resource | Endpoint |
|---|---|
| Users | `GET /v2/company/{company_id}/users` |
| Shifts | `GET /v2/company/{company_id}/shifts?start_date=&end_date=` |
| Time Punches | `GET /v2/company/{company_id}/time_punches?clocked_in_gte=&clocked_in_lte=` |

API docs: <https://developers.7shifts.com/>

## Replacing Toast labor

7shifts is now the SoR for labor (audit §3). The existing Toast labor ingest (`scripts/ingest_toast_labor.py`) is **kept** to populate `toast_sales_summary` figures (Toast's labor-cost-as-pct-of-net comes prebaked in their export). Once 7shifts gives us hourly truth, the compute engine should compute labor% itself rather than reading Toast's prebaked column. That switchover is a follow-up — Phase 4 just lands the data.
