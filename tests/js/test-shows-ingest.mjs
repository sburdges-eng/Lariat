import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { initSchema } from '../../lib/db.ts';
import { ingestShowsFromJson } from '../../scripts/ingest-shows.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE = path.join(ROOT, 'tests', 'python', 'fixtures', 'shows_minimal.xlsx');

before(() => {
  // Make sure the fixture exists.
  execSync(`python3 ${path.join(ROOT, 'tests/python/fixtures/build_shows_fixture.py')}`, {
    stdio: 'pipe',
  });
});

function freshDb() {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

function runFromFixture(db) {
  const json = execSync(
    `python3 ${path.join(ROOT, 'scripts/ingest_shows_xlsx.py')} ${FIXTURE}`,
    { encoding: 'utf8' },
  );
  return ingestShowsFromJson(db, JSON.parse(json), 'default');
}

test('ingestShowsFromJson: writes all three tables', () => {
  const db = freshDb();
  const summary = runFromFixture(db);
  assert.equal(summary.shows, 5);
  assert.equal(summary.shows_archive, 5);
  assert.equal(summary.tiktok_ideas, 4);
});

test('ingestShowsFromJson: re-run is idempotent (DELETE+INSERT)', () => {
  const db = freshDb();
  runFromFixture(db);
  const before = db.prepare('SELECT COUNT(*) AS n FROM shows').get().n;
  runFromFixture(db);
  const after = db.prepare('SELECT COUNT(*) AS n FROM shows').get().n;
  assert.equal(after, before, 'row count must not grow on re-ingest');
});

test('ingestShowsFromJson: writes one ingest_runs row with status', () => {
  const db = freshDb();
  runFromFixture(db);
  const runs = db.prepare(
    "SELECT * FROM ingest_runs WHERE kind='shows' ORDER BY id DESC",
  ).all();
  assert.equal(runs.length, 1);
  assert.ok(['ok', 'partial'].includes(runs[0].status), runs[0].status);
  assert.ok(runs[0].rows_in > 0);
  assert.ok(runs[0].rows_out > 0);
  assert.ok(runs[0].finished_at);
});

test('ingestShowsFromJson: dropped row → status="partial"', () => {
  const db = freshDb();
  runFromFixture(db);
  const run = db.prepare(
    "SELECT status FROM ingest_runs WHERE kind='shows' ORDER BY id DESC LIMIT 1",
  ).get();
  // Fixture has one malformed past row → exactly one drop.
  assert.equal(run.status, 'partial');
});

test('ingestShowsFromJson: empty payload yields status="ok" and zero counts', () => {
  const db = freshDb();
  const summary = ingestShowsFromJson(
    db,
    { shows: [], shows_archive: [], tiktok_ideas: [], dropped: [] },
    'default',
  );
  assert.equal(summary.shows, 0);
  const run = db.prepare(
    "SELECT status, rows_out FROM ingest_runs WHERE kind='shows' ORDER BY id DESC LIMIT 1",
  ).get();
  assert.equal(run.status, 'ok');
  assert.equal(run.rows_out, 0);
});

test('ingestShowsFromJson: failure aborts transaction (no partial rows)', () => {
  const db = freshDb();
  // Corrupt payload: missing required band_name on a row.
  const bad = {
    shows: [{ band_name: null, show_date: '2026-05-01', price: 0, door_tix: null, status: {}, source_row: 2 }],
    shows_archive: [],
    tiktok_ideas: [],
    dropped: [],
  };
  assert.throws(() => ingestShowsFromJson(db, bad, 'default'));
  const n = db.prepare('SELECT COUNT(*) AS n FROM shows').get().n;
  assert.equal(n, 0);
  const run = db.prepare(
    "SELECT status FROM ingest_runs WHERE kind='shows' ORDER BY id DESC LIMIT 1",
  ).get();
  assert.equal(run?.status, 'failed');
});

test('ingestShowsFromJson: status_json round-trips', () => {
  const db = freshDb();
  runFromFixture(db);
  const armchair = db.prepare(
    "SELECT status_json FROM shows WHERE band_name = 'armchair boogie'",
  ).get();
  const status = JSON.parse(armchair.status_json);
  assert.equal(status.listing_jambase_bit_songkick, 'jb, bit, sk');
  assert.equal(status.newsletter, 'w');
});
