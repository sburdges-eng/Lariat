import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { register } from 'node:module';
import Database from 'better-sqlite3';
import { requirePythonDeps, VENV_PYTHON } from './_helpers/python-preflight.mjs';

register(new URL('./resolver.mjs', import.meta.url));

const { initSchema, setDbPathForTest } = await import('../../lib/db.ts');
const { ingestShowsFromJson } = await import('../../scripts/ingest-shows.mjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE = path.join(ROOT, 'tests', 'python', 'fixtures', 'shows_minimal.xlsx');

const TMP_DB = path.join(ROOT, 'tests', 'js', `.tmp-shows-${process.pid}.db`);

beforeEach(() => {
  requirePythonDeps();
  execSync(`"${VENV_PYTHON}" ${path.join(ROOT, 'tests/python/fixtures/build_shows_fixture.py')}`, {
    stdio: 'pipe',
  });
  try { fs.rmSync(TMP_DB, { force: true }); } catch {}
  setDbPathForTest(TMP_DB);
  const db = new Database(TMP_DB);
  initSchema(db);
  const json = execSync(
    `"${VENV_PYTHON}" ${path.join(ROOT, 'scripts/ingest_shows_xlsx.py')} ${FIXTURE}`,
    { encoding: 'utf8' },
  );
  ingestShowsFromJson(db, JSON.parse(json), 'default');
  db.close();
});

async function fetchRoute(query = '') {
  const { GET } = await import('../../app/api/shows/route.js');
  const req = new Request(`http://localhost/api/shows${query ? '?' + query : ''}`);
  return GET(req);
}

test('op=upcoming returns rows with parsed status', async () => {
  const res = await fetchRoute('op=upcoming&today=2026-04-25&weeks=5');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.rows));
  assert.ok(body.rows.length >= 4);
  assert.equal(typeof body.rows[0].status, 'object');
});

test('op=playbook&show=<id> returns one row', async () => {
  const list = await (await fetchRoute('op=upcoming&today=2026-04-25')).json();
  const id = list.rows[0].id;
  const res = await fetchRoute(`op=playbook&show=${id}&today=2026-04-25`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.row.id, id);
});

test('op=playbook&show=<missing> → 404', async () => {
  const res = await fetchRoute('op=playbook&show=999999');
  assert.equal(res.status, 404);
});

test('op=archive&q= filters', async () => {
  const res = await fetchRoute('op=archive&q=whiskey');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.rows.length, 1);
});

test('op=archive&era= filters', async () => {
  const res = await fetchRoute('op=archive&era=2024');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.rows.every((r) => r.era_year === 2024));
});

test('invalid op → 400', async () => {
  const res = await fetchRoute('op=nope');
  assert.equal(res.status, 400);
});

test('missing op → 400', async () => {
  const res = await fetchRoute('');
  assert.equal(res.status, 400);
});
