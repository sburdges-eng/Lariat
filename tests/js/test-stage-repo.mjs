#!/usr/bin/env node
// Tests for lib/stageRepo.ts — Phase 2 stage setup repo.
//
// Run: node --experimental-strip-types --test tests/js/test-stage-repo.mjs

import { describe, it, after, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Same chdir-before-import pattern as test-pack-changes-route — stage-repo
// writes file-audit rows via lib/auditLog.mjs, which captures cwd at
// module load. Sandbox the audit JSONL.
const prevCwd = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-stage-'));
process.chdir(tmpRoot);

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
const stage = await import('../../lib/stageRepo.ts');

setDbPathForTest(':memory:');
const db = getDb();
after(() => {
  setDbPathForTest(null);
  process.chdir(prevCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

before(() => {
  // Insert FK parent rows in dependency order: ingest_runs first
  // (shows.ingest_run_id → ingest_runs.id), then shows (stage_setups.show_id
  // → shows.id).
  db.prepare(
    `INSERT INTO ingest_runs (id, kind, started_at, status)
     VALUES (1, 'test', datetime('now'), 'ok')`,
  ).run();
  db.prepare(
    `INSERT INTO shows (id, location_id, band_name, show_date, source_row, ingested_at, ingest_run_id)
     VALUES (1, 'default', 'Test Band', '2026-05-01', 1, datetime('now'), 1)`,
  ).run();
});

beforeEach(() => {
  db.exec(`DELETE FROM stage_setups;`);
  const auditFile = path.join(tmpRoot, 'data', 'audit', 'management-actions.jsonl');
  if (fs.existsSync(auditFile)) fs.rmSync(auditFile);
});

function readAuditEntries() {
  const auditFile = path.join(tmpRoot, 'data', 'audit', 'management-actions.jsonl');
  if (!fs.existsSync(auditFile)) return [];
  return fs.readFileSync(auditFile, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

describe('KNOWN_ROOM_CONFIGS catalog', () => {
  it('has 6 entries with the expected shape', () => {
    const keys = Object.keys(stage.KNOWN_ROOM_CONFIGS);
    assert.equal(keys.length, 6);
    for (const k of keys) {
      const c = stage.KNOWN_ROOM_CONFIGS[k];
      assert.ok(c.name);
      assert.ok(c.description);
      assert.ok(c.layout);
      assert.ok(Number.isInteger(c.capacity));
      assert.ok(c.changeover && Number.isInteger(c.changeover.staff));
    }
  });

  it('isKnownRoomConfig recognizes catalog keys', () => {
    assert.equal(stage.isKnownRoomConfig('listening_room_220'), true);
    assert.equal(stage.isKnownRoomConfig('cabaret_160'), true);
    assert.equal(stage.isKnownRoomConfig('garbage'), false);
  });
});

describe('upsertStageSetup', () => {
  it('creates a new row when none exists for (show, location)', () => {
    const r = stage.upsertStageSetup(db, {
      show_id: 1,
      location_id: 'default',
      room_config: 'listening_room_220',
    });
    assert.equal(r.created, true);
    assert.equal(r.setup.show_id, 1);
    assert.equal(r.setup.room_config, 'listening_room_220');
    assert.deepEqual(r.setup.run_of_show, []);
    assert.deepEqual(r.setup.hospitality_rider, {});
  });

  it('updates an existing row instead of inserting a duplicate', () => {
    stage.upsertStageSetup(db, {
      show_id: 1,
      location_id: 'default',
      room_config: 'listening_room_220',
    });
    const r2 = stage.upsertStageSetup(db, {
      show_id: 1,
      location_id: 'default',
      room_config: 'cabaret_160',
      run_of_show: [{ t: '5:30 PM', what: 'Doors', who: 'Door' }],
    });
    assert.equal(r2.created, false);
    assert.equal(r2.setup.room_config, 'cabaret_160');
    assert.equal(r2.setup.run_of_show.length, 1);

    const count = db.prepare(`SELECT COUNT(*) AS c FROM stage_setups WHERE show_id = 1`).get().c;
    assert.equal(count, 1);
  });

  it('persists hospitality + tech rider JSON round-trip', () => {
    const r = stage.upsertStageSetup(db, {
      show_id: 1,
      location_id: 'default',
      room_config: 'half_house_180',
      hospitality_rider: { beverage: ['hot tea', 'still water'], hospitality_cost_usd: 42 },
      tech_rider: { house_provides: ['8 channel monitor mix'], vehicle: 'sprinter van' },
    });
    assert.deepEqual(r.setup.hospitality_rider.beverage, ['hot tea', 'still water']);
    assert.equal(r.setup.hospitality_rider.hospitality_cost_usd, 42);
    assert.deepEqual(r.setup.tech_rider.house_provides, ['8 channel monitor mix']);
  });

  it('writes a management-action audit row for create + update', () => {
    stage.upsertStageSetup(db, {
      show_id: 1,
      location_id: 'default',
      room_config: 'listening_room_220',
      actor_cook_id: 'cook_001',
    });
    stage.upsertStageSetup(db, {
      show_id: 1,
      location_id: 'default',
      room_config: 'cabaret_160',
      actor_cook_id: 'cook_001',
    });
    const entries = readAuditEntries();
    assert.equal(entries.length, 2);
    assert.equal(entries[0].action, 'stage_setup_created');
    assert.equal(entries[1].action, 'stage_setup_updated');
    for (const e of entries) {
      assert.equal(e.show_id, 1);
      assert.equal(e.actor_cook_id, 'cook_001');
    }
  });

  it('rejects unknown room_config', () => {
    assert.throws(
      () => stage.upsertStageSetup(db, {
        show_id: 1,
        location_id: 'default',
        room_config: 'garbage',
      }),
      /unknown room_config/,
    );
  });

  it('rejects non-positive show_id', () => {
    assert.throws(
      () => stage.upsertStageSetup(db, {
        show_id: 0,
        location_id: 'default',
        room_config: 'listening_room_220',
      }),
      /show_id/,
    );
  });

  it('respects location_id scoping (same show_id, two locations, two rows)', () => {
    db.prepare(
      `INSERT INTO shows (id, location_id, band_name, show_date, source_row, ingested_at, ingest_run_id)
       VALUES (2, 'satellite', 'Test Band 2', '2026-05-02', 2, datetime('now'), 1)`,
    ).run();
    stage.upsertStageSetup(db, {
      show_id: 1,
      location_id: 'default',
      room_config: 'listening_room_220',
    });
    stage.upsertStageSetup(db, {
      show_id: 2,
      location_id: 'satellite',
      room_config: 'cabaret_160',
    });
    const def = stage.getStageSetup(db, 1, 'default');
    const sat = stage.getStageSetup(db, 2, 'satellite');
    assert.equal(def?.room_config, 'listening_room_220');
    assert.equal(sat?.room_config, 'cabaret_160');
  });
});

describe('getStageSetup', () => {
  it('returns null when no row exists', () => {
    assert.equal(stage.getStageSetup(db, 1, 'default'), null);
  });

  it('round-trips JSON fields', () => {
    stage.upsertStageSetup(db, {
      show_id: 1,
      location_id: 'default',
      room_config: 'dance_floor_240',
      run_of_show: [
        { t: '5:00 PM', what: 'Load-in', who: 'Stage' },
        { t: '7:00 PM', what: 'Doors', who: 'Door' },
      ],
    });
    const got = stage.getStageSetup(db, 1, 'default');
    assert.ok(got);
    assert.equal(got.run_of_show.length, 2);
    assert.equal(got.run_of_show[1].what, 'Doors');
  });
});

describe('stageCompleteness', () => {
  it('returns score 0 for null setup', () => {
    const c = stage.stageCompleteness(null);
    assert.equal(c.has_setup, false);
    assert.equal(c.score, 0);
  });

  it('returns 0.25 for setup with only room_config', () => {
    stage.upsertStageSetup(db, {
      show_id: 1,
      location_id: 'default',
      room_config: 'listening_room_220',
    });
    const got = stage.getStageSetup(db, 1, 'default');
    const c = stage.stageCompleteness(got);
    assert.equal(c.has_room_config, true);
    assert.equal(c.has_run_of_show, false);
    assert.equal(c.score, 0.25);
  });

  it('returns 1.0 for fully populated setup', () => {
    stage.upsertStageSetup(db, {
      show_id: 1,
      location_id: 'default',
      room_config: 'listening_room_220',
      run_of_show: [{ t: '7:00 PM', what: 'Doors', who: 'Door' }],
      hospitality_rider: { beverage: ['water'] },
      tech_rider: { house_provides: ['mics'] },
    });
    const got = stage.getStageSetup(db, 1, 'default');
    const c = stage.stageCompleteness(got);
    assert.equal(c.score, 1);
  });
});

describe('listStageSetupsForLocation', () => {
  it('returns empty when no setups', () => {
    assert.deepEqual(stage.listStageSetupsForLocation(db, 'default'), []);
  });

  it('returns setups for the given location, newest first', () => {
    db.prepare(
      `INSERT INTO shows (id, location_id, band_name, show_date, source_row, ingested_at, ingest_run_id)
       VALUES (3, 'default', 'Older Band', '2026-04-30', 3, datetime('now'), 1)`,
    ).run();
    stage.upsertStageSetup(db, {
      show_id: 3,
      location_id: 'default',
      room_config: 'cabaret_160',
    });
    stage.upsertStageSetup(db, {
      show_id: 1,
      location_id: 'default',
      room_config: 'listening_room_220',
    });
    const list = stage.listStageSetupsForLocation(db, 'default');
    assert.equal(list.length, 2);
  });
});
