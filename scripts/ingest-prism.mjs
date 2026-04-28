#!/usr/bin/env node
// scripts/ingest-prism.mjs
//
// Phase-5 ingest: pulls events from Prism.fm and lands them in
// prism_events (raw) + entities_events (canonical) via the resolver.
//
// Status: SCAFFOLD. The Prism API client throws a clear error on any
// live request until the API path/auth shape is confirmed by your
// Prism CSM (see scripts/prism_api/README.md). The ingest mapper and
// DB-write path below are fully implemented and unit-tested with mock
// data, so once the API path is filled in the only change is editing
// scripts/prism_api/client.mjs::REAL_ENDPOINT_PATH.
//
// Usage (once creds + API path are wired):
//   node --experimental-strip-types scripts/ingest-prism.mjs --since=2026-04-01 --until=2026-04-30
//   node --experimental-strip-types scripts/ingest-prism.mjs --apply --since=…
//
// Defaults: window = next 60 days from today (events are forward-looking).

import { getPrismEvents } from './prism_api/client.mjs';

function parseArgs(argv) {
  const args = {
    apply: false,
    since: null,
    until: null,
    location: 'default',
    fixture: null, // tests pass a JSON file path
  };
  for (const a of argv.slice(2)) {
    if (a === '--apply') args.apply = true;
    else if (a === '--dry-run') args.apply = false;
    else if (a.startsWith('--since=')) args.since = a.slice('--since='.length);
    else if (a.startsWith('--until=')) args.until = a.slice('--until='.length);
    else if (a.startsWith('--location=')) args.location = a.slice('--location='.length);
    else if (a.startsWith('--fixture=')) args.fixture = a.slice('--fixture='.length);
    else if (a === '-h' || a === '--help') args.help = true;
    else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function defaultWindow() {
  const now = new Date();
  const since = now.toISOString().slice(0, 10);
  const untilDate = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  const until = untilDate.toISOString().slice(0, 10);
  return { since, until };
}

function printHelp() {
  console.log(`ingest-prism — pull events from Prism.fm (SCAFFOLD)

Usage:
  node --experimental-strip-types scripts/ingest-prism.mjs [flags]

Flags:
  --apply               Write to DB (default: dry-run).
  --since=YYYY-MM-DD    Window start (default: today).
  --until=YYYY-MM-DD    Window end (default: today + 60d).
  --location=<id>       Default 'default'.
  --fixture=<path>      Read events from a local JSON file instead of
                        the Prism API. Used for ingest dry-runs and
                        tests until the API is wired up.
  -h, --help            Show this help.

Status: SCAFFOLD. See scripts/prism_api/README.md for the open
questions to ask your Prism CSM before this can run live.
`);
}

// ── Mapper (pure: API row → DB row) ─────────────────────────────────

/**
 * Map one Prism event JSON object onto a prism_events row. Field names
 * are guesses based on common SaaS patterns; once Prism docs are
 * confirmed, adjust to match the actual schema.
 *
 * Defensive: any field that isn't present comes through as null rather
 * than crashing the ingest. raw_json captures the original blob so we
 * never lose information that the mapper missed.
 */
export function eventToRow(e, location_id) {
  // Prism's id field could be `id`, `event_id`, `uuid` — try them all.
  const prismId = e.id ?? e.event_id ?? e.uuid ?? null;
  if (prismId == null) return null; // can't map an event without an id
  return {
    prism_id: String(prismId),
    location_id,
    display_name: e.name ?? e.title ?? e.event_name ?? null,
    event_date: e.event_date ?? e.date ?? null,
    doors_at: e.doors_at ?? e.doors ?? null,
    show_at: e.show_at ?? e.start ?? e.start_time ?? null,
    venue: e.venue ?? e.venue_name ?? null,
    headliner: e.headliner ?? e.primary_artist ?? null,
    supports_json: Array.isArray(e.supports)
      ? JSON.stringify(e.supports)
      : Array.isArray(e.support_artists)
        ? JSON.stringify(e.support_artists)
        : null,
    ticket_count: typeof e.ticket_count === 'number' ? e.ticket_count : null,
    capacity: typeof e.capacity === 'number' ? e.capacity : null,
    status: e.status ?? null,
    raw_json: JSON.stringify(e),
  };
}

/**
 * Translate prism_events.status (Prism vocabulary) into the
 * entities_events.status enum. Unknown values default to 'planned'.
 */
export function mapEventStatus(prismStatus) {
  if (typeof prismStatus !== 'string') return 'planned';
  const s = prismStatus.toLowerCase();
  if (s === 'confirmed' || s === 'on-sale' || s === 'on_sale') return 'confirmed';
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  if (s === 'completed' || s === 'past') return 'completed';
  return 'planned';
}

// ── DB writer (idempotent upsert + entity resolution) ───────────────

function upsertPrismEvent(db, row) {
  db.prepare(
    `INSERT INTO prism_events
       (prism_id, location_id, event_uuid, display_name, event_date,
        doors_at, show_at, venue, headliner, supports_json, ticket_count,
        capacity, status, raw_json, ingested_at)
     VALUES (@prism_id, @location_id, @event_uuid, @display_name, @event_date,
             @doors_at, @show_at, @venue, @headliner, @supports_json, @ticket_count,
             @capacity, @status, @raw_json, datetime('now'))
     ON CONFLICT(prism_id, location_id) DO UPDATE SET
       event_uuid = excluded.event_uuid,
       display_name = excluded.display_name, event_date = excluded.event_date,
       doors_at = excluded.doors_at, show_at = excluded.show_at,
       venue = excluded.venue, headliner = excluded.headliner,
       supports_json = excluded.supports_json,
       ticket_count = excluded.ticket_count, capacity = excluded.capacity,
       status = excluded.status, raw_json = excluded.raw_json,
       ingested_at = datetime('now')`,
  ).run(row);
}

/**
 * Map an array of Prism events through the resolver + writer. Pure
 * with respect to the event-source side: the events array is whatever
 * the API or fixture returned. Returns counts.
 *
 * Exported for tests so we can drive it with a fixture array directly.
 */
export function ingestPrismEvents(db, events, args, resolver) {
  let pulled = 0;
  let written = 0;
  let mapped = 0;
  let skipped = 0;
  for (const e of events) {
    pulled++;
    const row = eventToRow(e, args.location);
    if (!row) {
      skipped++;
      continue;
    }
    mapped++;
    if (args.apply) {
      const r = resolver({
        source_system: 'prism',
        external_id: row.prism_id,
        display_name: row.display_name ?? `prism event ${row.prism_id}`,
        event_date: row.event_date,
        event_time: row.show_at,
        venue: row.venue,
        headliner: row.headliner,
        location_id: args.location,
        status: mapEventStatus(row.status),
        metadata: { ticket_count: row.ticket_count, capacity: row.capacity },
      });
      row.event_uuid = r.uuid;
      upsertPrismEvent(db, row);
      written++;
    }
  }
  return { pulled, mapped, written, skipped };
}

// ── Orchestrator ────────────────────────────────────────────────────

async function readFixture(p) {
  const fs = await import('node:fs');
  const raw = fs.readFileSync(p, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`fixture ${p} must be a JSON array of events`);
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  const win = (args.since && args.until)
    ? { since: args.since, until: args.until }
    : defaultWindow();

  const { getDb } = await import('../lib/db.ts');
  const { resolveOrCreateEvent } = await import('../lib/entities.ts');
  const db = getDb();

  console.log(`ingest-prism (${args.apply ? 'APPLY' : 'DRY-RUN'})`);
  console.log(`  location=${args.location}`);
  console.log(`  window=${win.since}..${win.until}`);

  let events;
  if (args.fixture) {
    events = await readFixture(args.fixture);
    console.log(`  source=fixture(${args.fixture})`);
  } else {
    console.log(`  source=Prism API`);
    events = await getPrismEvents({ since: win.since, until: win.until });
  }

  const stats = ingestPrismEvents(db, events, args, (input) =>
    resolveOrCreateEvent(db, input),
  );
  console.log(
    `  events       … pulled=${stats.pulled} mapped=${stats.mapped} ` +
      `written=${stats.written} skipped=${stats.skipped}`,
  );

  if (!args.apply) {
    console.log('');
    console.log('(dry-run: no writes. Re-run with --apply to commit.)');
  }
}

const isDirectInvocation =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('ingest-prism.mjs');
if (isDirectInvocation) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
