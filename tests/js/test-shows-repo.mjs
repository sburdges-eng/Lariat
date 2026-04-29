import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { register } from 'node:module';
import Database from 'better-sqlite3';
import { requirePythonDeps, VENV_PYTHON } from './_helpers/python-preflight.mjs';

register(new URL('./resolver.mjs', import.meta.url));

const { initSchema } = await import('../../lib/db.ts');
const { ingestShowsFromJson } = await import('../../scripts/ingest-shows.mjs');
const {
  upcomingShows, pipelineCounts, archiveSearch, getShowById, nextUpcoming,
} = await import('../../lib/showsRepo.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE = path.join(ROOT, 'tests', 'python', 'fixtures', 'shows_minimal.xlsx');

let db;

beforeEach(() => {
  requirePythonDeps();
  execSync(`"${VENV_PYTHON}" ${path.join(ROOT, 'tests/python/fixtures/build_shows_fixture.py')}`, {
    stdio: 'pipe',
  });
  db = new Database(':memory:');
  initSchema(db);
  const json = execSync(
    `"${VENV_PYTHON}" ${path.join(ROOT, 'scripts/ingest_shows_xlsx.py')} ${FIXTURE}`,
    { encoding: 'utf8' },
  );
  ingestShowsFromJson(db, JSON.parse(json), 'default');
});

test('upcomingShows: respects 35-day window from a fixed today', () => {
  // Fixture rows: 2026-05-01, 05-08, 05-15, 05-22, 06-01.
  const rows = upcomingShows(db, 'default', { today: '2026-04-25', weeks: 5 });
  // 5 weeks = 35 days → through 2026-05-30. Expect 4 rows (drops 06-01).
  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map((r) => r.show_date),
    ['2026-05-01', '2026-05-08', '2026-05-15', '2026-05-22'],
  );
});

test('upcomingShows: scoped by location_id', () => {
  const other = upcomingShows(db, 'other-location', { today: '2026-04-25', weeks: 5 });
  assert.equal(other.length, 0);
});

test('pipelineCounts: includes upcoming plus past active shows', () => {
  db.prepare(
    `INSERT INTO shows
      (location_id, band_name, show_date, price, door_tix, status_json,
       source_row, ingested_at, ingest_run_id)
     VALUES
      (?, ?, ?, ?, ?, ?, ?, datetime('now','subsec'), ?)`,
  ).run(
    'default',
    'the settled late show',
    '2026-04-01',
    10,
    'sold',
    JSON.stringify({ create_dice_tickets: 'y', dice_email: 'tix, dos' }),
    999,
    1,
  );
  const counts = pipelineCounts(db, 'default', { today: '2026-04-25', weeks: 52 });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const upcoming = upcomingShows(db, 'default', { today: '2026-04-25', weeks: 52 });
  assert.equal(total, upcoming.length + 1);
  assert.equal(counts.Settled, 1);
});

test('pipelineCounts: every key is a known stage', () => {
  const counts = pipelineCounts(db, 'default', { today: '2026-04-25', weeks: 52 });
  const expected = ['Inquiry', 'Hold', 'Offer Out', 'Confirmed', 'On Sale', 'Settled'];
  assert.deepEqual(Object.keys(counts).sort(), expected.sort());
});

test('archiveSearch: filters by band substring', () => {
  const rows = archiveSearch(db, 'default', { q: 'whiskey' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].band_name, 'the whiskey sweets brunch');
});

test('archiveSearch: filters by era_year', () => {
  const rows = archiveSearch(db, 'default', { era: 2024 });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.era_year === 2024));
});

test('getShowById: returns parsed status and null for missing id', () => {
  const all = upcomingShows(db, 'default', { today: '2026-04-25', weeks: 52 });
  const one = getShowById(db, 'default', all[0].id);
  assert.equal(one.id, all[0].id);
  assert.ok(one.status); // parsed object, not string
  assert.equal(typeof one.status, 'object');
  assert.equal(getShowById(db, 'default', 999999), null);
});

test('nextUpcoming: returns soonest future show or null', () => {
  const n = nextUpcoming(db, 'default', { today: '2026-04-25' });
  assert.equal(n.show_date, '2026-05-01');
  const none = nextUpcoming(db, 'default', { today: '2030-01-01' });
  assert.equal(none, null);
});
