#!/usr/bin/env node
// Bundle-H API route regression pins.
//
// Covers the four write routes that went in with PR #3 on top of the
// PR #18 schema:
//
//   POST /api/cleaning          (cleaning_log)
//   POST /api/pest              (pest_control_log)
//   POST /api/sds               (sds_registry)
//   POST /api/preshift-notes    (preshift_notes — UPSERT)
//
// Plus the GET-only data endpoint:
//
//   GET  /api/stations          (stations.json projection, with per-
//                                station line-check progress joined
//                                from line_check_entries / station_signoffs)
//
// Contracts pinned:
//   - Happy path writes BOTH the source table AND audit_events in one
//     transaction (per PR #17 atomicity contract).
//   - Validator rejection: 400 with no DB writes and no audit row.
//   - Preshift upsert: action='insert' first time, action='update' on
//     repeat; `updated_at` strictly advances on update, stays >=
//     `created_at`; body/author change persist.
//   - Preshift GET round-trips and honors ?service= and location.
//   - Audit rollback: if audit_events is unavailable mid-transaction,
//     the source-table write is rolled back (shared rollback helper).
//   - Stations GET returns one row per station with a prog summary
//     reflecting line_check_entries rows and station_signoffs.
//
// Run: node --experimental-strip-types --test tests/js/test-bundle-h-apis.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-bundle-h-apis-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const auditEvents = await import('../../lib/auditEvents.ts');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { todayISO } = db;
const { postAuditEvent } = auditEvents;

// Routes — import lazily after setDbPathForTest so their getDb()
// handles resolve to the scratch DB.
const cleaning = await import('../../app/api/cleaning/route.ts');
const pest = await import('../../app/api/pest/route.ts');
const sds = await import('../../app/api/sds/route.ts');
const preshift = await import('../../app/api/preshift-notes/route.ts');
const stations = await import('../../app/api/stations/route.js');

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec(`
    DELETE FROM audit_events;
    DELETE FROM cleaning_log;
    DELETE FROM pest_control_log;
    DELETE FROM sds_registry;
    DELETE FROM preshift_notes;
    DELETE FROM service_hours;
    DELETE FROM line_check_entries;
    DELETE FROM station_signoffs;
  `);
});

// ── Helpers ───────────────────────────────────────────────────────

function postReq(url, body) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getReq(url) {
  return new Request(url, { method: 'GET' });
}

function countRows(table, where = '') {
  return testDb.prepare(`SELECT COUNT(*) AS c FROM ${table} ${where}`).get().c;
}

function countAudit(entity, action = null) {
  if (action) {
    return testDb
      .prepare('SELECT COUNT(*) AS c FROM audit_events WHERE entity = ? AND action = ?')
      .get(entity, action).c;
  }
  return testDb
    .prepare('SELECT COUNT(*) AS c FROM audit_events WHERE entity = ?')
    .get(entity).c;
}

async function captureWarnsAsync(fn) {
  const captured = [];
  const original = console.warn;
  console.warn = (...args) => { captured.push(args.map(String).join(' ')); };
  try {
    const out = await fn();
    return { captured, out };
  } finally {
    console.warn = original;
  }
}

// ── /api/cleaning ─────────────────────────────────────────────────

describe('POST /api/cleaning — happy path', () => {
  it('inserts cleaning_log + audit_events atomically', async () => {
    const res = await cleaning.POST(postReq('http://localhost/api/cleaning', {
      shift_date: '2026-04-21',
      area: 'Line',
      item: 'reach-in gasket wipe',
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    const j = await res.json();
    assert.strictEqual(j.ok, true);
    assert.ok(j.entry?.id, 'entry.id set');
    assert.strictEqual(j.entry.task, 'reach-in gasket wipe');
    assert.strictEqual(j.entry.area, 'Line');
    assert.strictEqual(j.entry.cook_id, 'alice');
    assert.strictEqual(countRows('cleaning_log'), 1);
    assert.strictEqual(countAudit('cleaning_log', 'insert'), 1);
  });

  it('falls back from body.task to body.item and vice versa', async () => {
    await cleaning.POST(postReq('http://localhost/api/cleaning', {
      task: 'mop floor',
      cook_id: 'bob',
    }));
    const row = testDb.prepare('SELECT * FROM cleaning_log').get();
    assert.strictEqual(row.task, 'mop floor');
  });

  it('defaults area to "General" when omitted', async () => {
    await cleaning.POST(postReq('http://localhost/api/cleaning', {
      item: 'walk-in shelves wipe',
      cook_id: 'alice',
    }));
    const row = testDb.prepare('SELECT * FROM cleaning_log').get();
    assert.strictEqual(row.area, 'General');
  });

  it('defaults shift_date to todayISO() when omitted', async () => {
    await cleaning.POST(postReq('http://localhost/api/cleaning', {
      item: 'hoods degrease',
      cook_id: 'alice',
    }));
    const row = testDb.prepare('SELECT shift_date FROM cleaning_log').get();
    assert.strictEqual(row.shift_date, todayISO());
  });

  it('emits NO audit-context warn (insert + audit in same transaction)', async () => {
    const { captured } = await captureWarnsAsync(() =>
      cleaning.POST(postReq('http://localhost/api/cleaning', {
        item: 'sanitizer bucket refill',
        cook_id: 'alice',
      })),
    );
    const auditWarns = captured.filter((m) => /postAuditEvent called outside/.test(m));
    assert.strictEqual(auditWarns.length, 0, `unexpected audit warns: ${auditWarns.join(' | ')}`);
  });
});

describe('POST /api/cleaning — validator rejection', () => {
  it('rejects an empty body with 400 and writes nothing', async () => {
    const res = await cleaning.POST(postReq('http://localhost/api/cleaning', {}));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countRows('cleaning_log'), 0);
    assert.strictEqual(countAudit('cleaning_log'), 0);
  });

  it('rejects non-string notes with 400', async () => {
    const res = await cleaning.POST(postReq('http://localhost/api/cleaning', {
      item: 'fridge wipe',
      notes: 123,
    }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countRows('cleaning_log'), 0);
  });
});

describe('GET /api/cleaning', () => {
  it('scopes by location_id and shift_date', async () => {
    await cleaning.POST(postReq('http://localhost/api/cleaning', {
      shift_date: '2026-04-21', item: 'task-a', cook_id: 'alice', location_id: 'downtown',
    }));
    await cleaning.POST(postReq('http://localhost/api/cleaning', {
      shift_date: '2026-04-21', item: 'task-b', cook_id: 'alice', location_id: 'airport',
    }));
    await cleaning.POST(postReq('http://localhost/api/cleaning', {
      shift_date: '2026-04-20', item: 'task-c', cook_id: 'alice', location_id: 'downtown',
    }));
    const res = await cleaning.GET(getReq('http://localhost/api/cleaning?location=downtown&date=2026-04-21'));
    const j = await res.json();
    assert.strictEqual(j.rows.length, 1);
    assert.strictEqual(j.rows[0].task, 'task-a');
  });
});

// ── /api/pest ──────────────────────────────────────────────────────

describe('POST /api/pest — happy path', () => {
  it('inserts pest_control_log + audit atomically (service_visit)', async () => {
    const res = await pest.POST(postReq('http://localhost/api/pest', {
      entry_type: 'service_visit',
      vendor: 'Ecolab',
      technician: 'Tom',
      findings: 'no issues',
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    const j = await res.json();
    assert.strictEqual(j.ok, true);
    assert.strictEqual(j.entry.entry_type, 'service_visit');
    assert.strictEqual(j.entry.vendor, 'Ecolab');
    assert.strictEqual(countRows('pest_control_log'), 1);
    assert.strictEqual(countAudit('pest_control_log', 'insert'), 1);
  });

  it('accepts a sighting with a pest code', async () => {
    const res = await pest.POST(postReq('http://localhost/api/pest', {
      entry_type: 'sighting',
      pest: 'roach',
      severity: 'low',
      corrective_action: 'trap set near dish pit',
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    const j = await res.json();
    assert.strictEqual(j.entry.pest, 'roach');
    assert.strictEqual(j.entry.severity, 'low');
  });

  it('accepts a trap_check entry', async () => {
    const res = await pest.POST(postReq('http://localhost/api/pest', {
      entry_type: 'trap_check',
      findings: 'one fly in trap',
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
  });
});

describe('POST /api/pest — validator rejection', () => {
  it('rejects unknown entry_type with 400', async () => {
    const res = await pest.POST(postReq('http://localhost/api/pest', {
      entry_type: 'bogus',
    }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countRows('pest_control_log'), 0);
    assert.strictEqual(countAudit('pest_control_log'), 0);
  });

  it('rejects sighting without pest', async () => {
    const res = await pest.POST(postReq('http://localhost/api/pest', {
      entry_type: 'sighting',
    }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countRows('pest_control_log'), 0);
  });

  it('rejects unknown pest code', async () => {
    const res = await pest.POST(postReq('http://localhost/api/pest', {
      entry_type: 'sighting', pest: 'dragon',
    }));
    assert.strictEqual(res.status, 400);
  });

  it('rejects unknown severity', async () => {
    const res = await pest.POST(postReq('http://localhost/api/pest', {
      entry_type: 'sighting', pest: 'roach', severity: 'catastrophic',
    }));
    assert.strictEqual(res.status, 400);
  });
});

// ── /api/sds ───────────────────────────────────────────────────────

describe('POST /api/sds — happy path', () => {
  it('inserts sds_registry + audit atomically', async () => {
    const res = await sds.POST(postReq('http://localhost/api/sds', {
      product_name: 'Quat Sanitizer Plus',
      manufacturer: 'Ecolab',
      hazard_class: 'irritant',
      storage_location: 'chem closet',
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    const j = await res.json();
    assert.strictEqual(j.ok, true);
    assert.strictEqual(j.entry.product_name, 'Quat Sanitizer Plus');
    assert.strictEqual(j.entry.active, 1);
    assert.strictEqual(countRows('sds_registry'), 1);
    assert.strictEqual(countAudit('sds_registry', 'insert'), 1);
  });

  it('defaults last_reviewed to today when omitted', async () => {
    await sds.POST(postReq('http://localhost/api/sds', {
      product_name: 'Degreaser 7',
      cook_id: 'alice',
    }));
    const row = testDb.prepare('SELECT * FROM sds_registry').get();
    assert.strictEqual(row.last_reviewed, todayISO());
  });

  it('honors active=false → 0', async () => {
    await sds.POST(postReq('http://localhost/api/sds', {
      product_name: 'Retired Product',
      active: false,
    }));
    const row = testDb.prepare('SELECT * FROM sds_registry').get();
    assert.strictEqual(row.active, 0);
  });
});

describe('POST /api/sds — validator rejection', () => {
  it('rejects missing product_name with 400', async () => {
    const res = await sds.POST(postReq('http://localhost/api/sds', {
      manufacturer: 'Ecolab',
    }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countRows('sds_registry'), 0);
    assert.strictEqual(countAudit('sds_registry'), 0);
  });

  it('rejects empty-string product_name with 400', async () => {
    const res = await sds.POST(postReq('http://localhost/api/sds', {
      product_name: '   ',
    }));
    assert.strictEqual(res.status, 400);
  });
});

describe('GET /api/sds', () => {
  it('returns only active rows', async () => {
    await sds.POST(postReq('http://localhost/api/sds', { product_name: 'Active One' }));
    await sds.POST(postReq('http://localhost/api/sds', { product_name: 'Retired', active: false }));
    const res = await sds.GET(getReq('http://localhost/api/sds'));
    const j = await res.json();
    assert.strictEqual(j.rows.length, 1);
    assert.strictEqual(j.rows[0].product_name, 'Active One');
  });
});

// ── /api/preshift-notes ────────────────────────────────────────────

describe('POST /api/preshift-notes — upsert semantics', () => {
  it('first POST inserts with action=insert', async () => {
    const res = await preshift.POST(postReq('http://localhost/api/preshift-notes', {
      shift_date: '2026-04-21',
      service_label: 'Dinner',
      body: '86 halibut',
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    const j = await res.json();
    assert.strictEqual(j.ok, true);
    assert.strictEqual(j.note.body, '86 halibut');
    assert.strictEqual(countRows('preshift_notes'), 1);
    assert.strictEqual(countAudit('preshift_notes', 'insert'), 1);
    assert.strictEqual(countAudit('preshift_notes', 'update'), 0);
  });

  it('second POST on same (loc, date, service) updates and emits action=update', async () => {
    await preshift.POST(postReq('http://localhost/api/preshift-notes', {
      shift_date: '2026-04-21', service_label: 'Dinner', body: 'first', cook_id: 'alice',
    }));
    const res = await preshift.POST(postReq('http://localhost/api/preshift-notes', {
      shift_date: '2026-04-21', service_label: 'Dinner', body: 'second', cook_id: 'bob',
    }));
    assert.strictEqual(res.status, 200);
    const j = await res.json();
    assert.strictEqual(j.note.body, 'second');
    assert.strictEqual(j.note.author_cook_id, 'bob');
    assert.strictEqual(countRows('preshift_notes'), 1, 'still one row (UPSERT)');
    assert.strictEqual(countAudit('preshift_notes', 'insert'), 1);
    assert.strictEqual(countAudit('preshift_notes', 'update'), 1);
  });

  it('PR #2 contract: updated_at advances past created_at on subsequent POST', async () => {
    await preshift.POST(postReq('http://localhost/api/preshift-notes', {
      shift_date: '2026-04-21', service_label: 'Dinner', body: 'first', cook_id: 'alice',
    }));
    // Force a measurable time delta — SQLite datetime('now') resolves
    // to whole-second precision, so wait long enough for the second
    // call to land in a later second.
    await new Promise((r) => setTimeout(r, 1100));
    await preshift.POST(postReq('http://localhost/api/preshift-notes', {
      shift_date: '2026-04-21', service_label: 'Dinner', body: 'second', cook_id: 'alice',
    }));
    const row = testDb.prepare('SELECT created_at, updated_at FROM preshift_notes').get();
    assert.ok(row.updated_at > row.created_at,
      `updated_at (${row.updated_at}) should be strictly newer than created_at (${row.created_at})`);
  });

  it('different service slots on the same date are independent rows', async () => {
    await preshift.POST(postReq('http://localhost/api/preshift-notes', {
      shift_date: '2026-04-21', service_label: 'Lunch', body: 'lunch heads-up',
    }));
    await preshift.POST(postReq('http://localhost/api/preshift-notes', {
      shift_date: '2026-04-21', service_label: 'Dinner', body: 'dinner heads-up',
    }));
    assert.strictEqual(countRows('preshift_notes'), 2);
    assert.strictEqual(countAudit('preshift_notes', 'insert'), 2);
  });

  it('different locations on the same (date, service) are independent rows', async () => {
    await preshift.POST(postReq('http://localhost/api/preshift-notes', {
      location_id: 'downtown', shift_date: '2026-04-21', service_label: 'Dinner', body: 'DT',
    }));
    await preshift.POST(postReq('http://localhost/api/preshift-notes', {
      location_id: 'airport', shift_date: '2026-04-21', service_label: 'Dinner', body: 'AP',
    }));
    assert.strictEqual(countRows('preshift_notes'), 2);
  });
});

describe('POST /api/preshift-notes — validator', () => {
  it('rejects empty body with 400 and no writes', async () => {
    const res = await preshift.POST(postReq('http://localhost/api/preshift-notes', {
      shift_date: '2026-04-21', service_label: 'Dinner', body: '',
    }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countRows('preshift_notes'), 0);
    assert.strictEqual(countAudit('preshift_notes'), 0);
  });

  it('rejects missing body with 400', async () => {
    const res = await preshift.POST(postReq('http://localhost/api/preshift-notes', {
      shift_date: '2026-04-21', service_label: 'Dinner',
    }));
    assert.strictEqual(res.status, 400);
  });

  it('rejects whitespace-only body with 400', async () => {
    const res = await preshift.POST(postReq('http://localhost/api/preshift-notes', {
      shift_date: '2026-04-21', service_label: 'Dinner', body: '     \n\t ',
    }));
    assert.strictEqual(res.status, 400);
  });
});

describe('GET /api/preshift-notes', () => {
  it('round-trips a just-posted note by ?date=&service=', async () => {
    await preshift.POST(postReq('http://localhost/api/preshift-notes', {
      shift_date: '2026-04-21', service_label: 'Dinner', body: 'hello', cook_id: 'alice',
    }));
    const res = await preshift.GET(
      getReq('http://localhost/api/preshift-notes?date=2026-04-21&service=Dinner'),
    );
    const j = await res.json();
    assert.strictEqual(j.service_label, 'Dinner');
    assert.strictEqual(j.note?.body, 'hello');
  });

  it('returns note=null when nothing matches', async () => {
    const res = await preshift.GET(
      getReq('http://localhost/api/preshift-notes?date=1999-01-01&service=Dinner'),
    );
    const j = await res.json();
    assert.strictEqual(j.note, null);
  });

  it('is location-scoped — downtown POST is not readable from airport', async () => {
    await preshift.POST(postReq('http://localhost/api/preshift-notes', {
      location_id: 'downtown', shift_date: '2026-04-21', service_label: 'Dinner', body: 'DT only',
    }));
    const res = await preshift.GET(
      getReq('http://localhost/api/preshift-notes?location=airport&date=2026-04-21&service=Dinner'),
    );
    const j = await res.json();
    assert.strictEqual(j.note, null);
  });
});

// ── /api/stations ──────────────────────────────────────────────────

describe('GET /api/stations', () => {
  it('returns one entry per station from the cache', async () => {
    const res = await stations.GET(getReq('http://localhost/api/stations'));
    assert.strictEqual(res.status, 200);
    const rows = await res.json();
    assert.ok(Array.isArray(rows), 'response is an array');
    assert.ok(rows.length >= 1, 'at least one station');
    for (const r of rows) {
      assert.ok(typeof r.id === 'string' && r.id.length, 'each row has string id');
      assert.ok(typeof r.name === 'string' && r.name.length, 'each row has string name');
      assert.ok('line' in r, 'line field present');
      assert.ok('prog' in r, 'prog field present (may be null)');
    }
  });

  it('prog is null for stations with no line_check_key, or shapes a progress summary', async () => {
    const res = await stations.GET(getReq('http://localhost/api/stations'));
    const rows = await res.json();
    for (const r of rows) {
      if (r.prog === null) continue;
      assert.ok(typeof r.prog.total === 'number');
      assert.ok(typeof r.prog.done === 'number');
      assert.ok(typeof r.prog.flagged === 'number');
      assert.strictEqual(typeof r.prog.signedOff, 'boolean');
      assert.ok(r.prog.done <= r.prog.total);
      assert.ok(r.prog.flagged <= r.prog.done);
    }
  });

  it('reflects a station_signoff as signedOff=true on the matching station', async () => {
    const all = await (await stations.GET(getReq('http://localhost/api/stations'))).json();
    const target = all.find((r) => r.prog && r.prog.total > 0);
    if (!target) {
      // No station has a populated line-check template in this dataset;
      // skip — a later data change shouldn't fail this test.
      return;
    }
    testDb
      .prepare(
        `INSERT INTO station_signoffs
           (shift_date, station_id, cook_id, signoff_type, location_id)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(todayISO(), target.id, 'alice', 'ready', 'default');

    const res2 = await stations.GET(getReq('http://localhost/api/stations'));
    const rows2 = await res2.json();
    const after = rows2.find((r) => r.id === target.id);
    assert.strictEqual(after.prog.signedOff, true);
  });
});

// ── Atomicity pin — shared rollback test for all four write routes ─

describe('Bundle-H write routes — rollback when audit_events fails', () => {
  // Rename audit_events mid-flight so the INSERT INTO audit_events
  // inside the route's transaction throws. The source-table row must
  // not survive.
  async function expectRollback({ route, url, body, sourceTable }) {
    testDb.exec('ALTER TABLE audit_events RENAME TO audit_events_stash');
    try {
      const before = countRows(sourceTable);
      const res = await route.POST(postReq(url, body));
      assert.strictEqual(res.status, 500, 'route must 500 when audit write fails');
      assert.strictEqual(
        countRows(sourceTable),
        before,
        `${sourceTable} must be rolled back`,
      );
    } finally {
      testDb.exec('ALTER TABLE audit_events_stash RENAME TO audit_events');
    }
  }

  it('rolls back cleaning_log insert when audit write fails', async () => {
    await expectRollback({
      route: cleaning,
      url: 'http://localhost/api/cleaning',
      body: { item: 'hoods degrease', cook_id: 'alice' },
      sourceTable: 'cleaning_log',
    });
  });

  it('rolls back pest_control_log insert when audit write fails', async () => {
    await expectRollback({
      route: pest,
      url: 'http://localhost/api/pest',
      body: { entry_type: 'service_visit', vendor: 'Ecolab', cook_id: 'alice' },
      sourceTable: 'pest_control_log',
    });
  });

  it('rolls back sds_registry insert when audit write fails', async () => {
    await expectRollback({
      route: sds,
      url: 'http://localhost/api/sds',
      body: { product_name: 'Degreaser 7', cook_id: 'alice' },
      sourceTable: 'sds_registry',
    });
  });

  it('rolls back preshift_notes upsert (insert path) when audit write fails', async () => {
    await expectRollback({
      route: preshift,
      url: 'http://localhost/api/preshift-notes',
      body: {
        shift_date: '2026-04-21',
        service_label: 'Dinner',
        body: 'something',
        cook_id: 'alice',
      },
      sourceTable: 'preshift_notes',
    });
  });

  it('rolls back preshift_notes upsert (update path) when audit write fails', async () => {
    // Seed a row first so the second POST takes the UPDATE branch.
    await preshift.POST(postReq('http://localhost/api/preshift-notes', {
      shift_date: '2026-04-21', service_label: 'Dinner', body: 'seed',
    }));
    const originalBody = testDb.prepare('SELECT body FROM preshift_notes').get().body;

    testDb.exec('ALTER TABLE audit_events RENAME TO audit_events_stash');
    try {
      const res = await preshift.POST(postReq('http://localhost/api/preshift-notes', {
        shift_date: '2026-04-21', service_label: 'Dinner', body: 'overwrite',
      }));
      assert.strictEqual(res.status, 500);
      const after = testDb.prepare('SELECT body FROM preshift_notes').get().body;
      assert.strictEqual(after, originalBody, 'update must roll back, body unchanged');
    } finally {
      testDb.exec('ALTER TABLE audit_events_stash RENAME TO audit_events');
    }
  });
});
