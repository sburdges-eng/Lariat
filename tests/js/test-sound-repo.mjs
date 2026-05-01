#!/usr/bin/env node
// Tests for lib/soundRepo.ts — Phase 2 sound scenes repo.
//
// Run: node --experimental-strip-types --test tests/js/test-sound-repo.mjs

import { describe, it, after, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Sandbox the file-audit JSONL — sound writes via lib/auditLog.mjs which
// captures cwd at module load (same pattern as test-stage-repo).
const prevCwd = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-sound-'));
process.chdir(tmpRoot);

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
const sound = await import('../../lib/soundRepo.ts');

setDbPathForTest(':memory:');
const db = getDb();
after(() => {
  setDbPathForTest(null);
  process.chdir(prevCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

before(() => {
  db.prepare(
    `INSERT INTO ingest_runs (id, kind, started_at, status)
     VALUES (1, 'test', datetime('now'), 'ok')`,
  ).run();
  db.prepare(
    `INSERT INTO shows (id, location_id, band_name, show_date, source_row, ingested_at, ingest_run_id)
     VALUES (1, 'default', 'Test Band', '2026-05-01', 1, datetime('now'), 1)`,
  ).run();
  db.prepare(
    `INSERT INTO shows (id, location_id, band_name, show_date, source_row, ingested_at, ingest_run_id)
     VALUES (2, 'satellite', 'Test Band 2', '2026-05-02', 2, datetime('now'), 1)`,
  ).run();
});

beforeEach(() => {
  db.exec(`DELETE FROM sound_scenes;`);
  const auditFile = path.join(tmpRoot, 'data', 'audit', 'management-actions.jsonl');
  if (fs.existsSync(auditFile)) fs.rmSync(auditFile);
});

function readAuditEntries() {
  const auditFile = path.join(tmpRoot, 'data', 'audit', 'management-actions.jsonl');
  if (!fs.existsSync(auditFile)) return [];
  return fs.readFileSync(auditFile, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const samplePlot = () => ({
  channels: [
    { id: 'kick', label: 'Kick', source_type: 'mic' },
    { id: 'vox-ld', label: 'Lead vocal', source_type: 'mic' },
  ],
  monitors: [
    { id: 'M1', type: 'wedge', channels: ['kick', 'vox-ld'] },
  ],
});

describe('listSoundScenesForShow', () => {
  it('returns empty when no scenes exist', () => {
    assert.deepEqual(sound.listSoundScenesForShow(db, 1, 'default'), []);
  });

  it('lists scenes newest-first with proper plot round-trip', () => {
    sound.createSoundScene(db, {
      show_id: 1, location_id: 'default', scene_name: 'soundcheck', plot: samplePlot(),
    });
    sound.createSoundScene(db, {
      show_id: 1, location_id: 'default', scene_name: 'set 1', plot: samplePlot(),
    });
    const list = sound.listSoundScenesForShow(db, 1, 'default');
    assert.equal(list.length, 2);
    assert.equal(list[0].scene_name, 'set 1');
    assert.equal(list[0].plot.channels.length, 2);
    assert.equal(list[1].scene_name, 'soundcheck');
  });

  it('respects location_id scoping', () => {
    sound.createSoundScene(db, {
      show_id: 1, location_id: 'default', scene_name: 'main', plot: samplePlot(),
    });
    sound.createSoundScene(db, {
      show_id: 2, location_id: 'satellite', scene_name: 'sat', plot: samplePlot(),
    });
    assert.equal(sound.listSoundScenesForShow(db, 1, 'default').length, 1);
    assert.equal(sound.listSoundScenesForShow(db, 2, 'satellite').length, 1);
    assert.equal(sound.listSoundScenesForShow(db, 1, 'satellite').length, 0);
  });
});

describe('getLatestSoundScene', () => {
  it('returns null when no scenes exist', () => {
    assert.equal(sound.getLatestSoundScene(db, 1, 'default'), null);
  });

  it('returns the most recently saved scene', () => {
    sound.createSoundScene(db, {
      show_id: 1, location_id: 'default', scene_name: 'soundcheck', plot: samplePlot(),
    });
    sound.createSoundScene(db, {
      show_id: 1, location_id: 'default', scene_name: 'set 1', plot: samplePlot(),
    });
    const latest = sound.getLatestSoundScene(db, 1, 'default');
    assert.equal(latest?.scene_name, 'set 1');
  });

  it('respects location_id scoping (no cross-location bleed)', () => {
    // Same show ids exist at default + satellite per the `before` hook.
    // The latest scene at one location must not be reachable from the other,
    // even when the satellite scene is newer than the default one.
    sound.createSoundScene(db, {
      show_id: 1, location_id: 'default', scene_name: 'default-only', plot: samplePlot(),
    });
    sound.createSoundScene(db, {
      show_id: 2, location_id: 'satellite', scene_name: 'satellite-only', plot: samplePlot(),
    });
    assert.equal(sound.getLatestSoundScene(db, 1, 'default')?.scene_name, 'default-only');
    assert.equal(sound.getLatestSoundScene(db, 2, 'satellite')?.scene_name, 'satellite-only');
    assert.equal(sound.getLatestSoundScene(db, 1, 'satellite'), null);
    assert.equal(sound.getLatestSoundScene(db, 2, 'default'), null);
  });

  it('falls back to an empty plot when plot_json is corrupt', () => {
    // safeJson() in soundRepo is graceful-degraded — a partial-write or
    // hand-edited DB row should not crash the dashboard. Pin the contract:
    // the row is still returned, plot collapses to {channels:[],monitors:[]}.
    db.prepare(
      `INSERT INTO sound_scenes
         (show_id, location_id, scene_name, plot_json, saved_at)
       VALUES (1, 'default', 'corrupt', '{not valid json', datetime('now'))`,
    ).run();
    const latest = sound.getLatestSoundScene(db, 1, 'default');
    assert.ok(latest);
    assert.equal(latest.scene_name, 'corrupt');
    assert.deepEqual(latest.plot.channels, []);
    assert.deepEqual(latest.plot.monitors, []);
  });
});

describe('createSoundScene', () => {
  it('writes a row + audit entry', () => {
    const scene = sound.createSoundScene(db, {
      show_id: 1,
      location_id: 'default',
      scene_name: 'set 1',
      plot: samplePlot(),
      saved_by_cook_id: 'engineer_dan',
      spl_limit_db: 95,
    });
    assert.equal(scene.scene_name, 'set 1');
    assert.equal(scene.spl_limit_db, 95);
    const entries = readAuditEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].action, 'sound_scene_created');
    assert.equal(entries[0].saved_by_cook_id, 'engineer_dan');
  });

  it('rejects empty scene_name', () => {
    assert.throws(
      () => sound.createSoundScene(db, {
        show_id: 1, location_id: 'default', scene_name: '', plot: samplePlot(),
      }),
      /scene_name/,
    );
  });

  it('rejects non-positive show_id', () => {
    assert.throws(
      () => sound.createSoundScene(db, {
        show_id: 0, location_id: 'default', scene_name: 'x', plot: samplePlot(),
      }),
      /show_id/,
    );
  });
});

describe('updateSoundScene', () => {
  it('patches scene_name + plot + writes audit', () => {
    const created = sound.createSoundScene(db, {
      show_id: 1, location_id: 'default', scene_name: 'draft', plot: samplePlot(),
    });
    const updated = sound.updateSoundScene(db, created.id, 'default', {
      scene_name: 'final',
      plot: { channels: [{ id: 'kick', label: 'Kick', source_type: 'mic' }], monitors: [] },
      spl_limit_db: 100,
    });
    assert.equal(updated.scene_name, 'final');
    assert.equal(updated.plot.channels.length, 1);
    assert.equal(updated.spl_limit_db, 100);
    const entries = readAuditEntries();
    assert.equal(entries.length, 2);
    assert.equal(entries[1].action, 'sound_scene_updated');
    assert.equal(entries[1].scene_id, created.id);
  });

  it('throws NotFound when id does not exist', () => {
    assert.throws(
      () => sound.updateSoundScene(db, 9999, 'default', { scene_name: 'x' }),
      /NotFound/,
    );
  });

  it('throws NotFound on location mismatch', () => {
    const s = sound.createSoundScene(db, {
      show_id: 1, location_id: 'default', scene_name: 'main', plot: samplePlot(),
    });
    assert.throws(
      () => sound.updateSoundScene(db, s.id, 'satellite', { scene_name: 'hijack' }),
      /NotFound/,
    );
  });

  it('rejects empty scene_name in patch', () => {
    const s = sound.createSoundScene(db, {
      show_id: 1, location_id: 'default', scene_name: 'main', plot: samplePlot(),
    });
    assert.throws(
      () => sound.updateSoundScene(db, s.id, 'default', { scene_name: '   ' }),
      /scene_name/,
    );
  });

  it('preserves unchanged fields when patch is partial', () => {
    const s = sound.createSoundScene(db, {
      show_id: 1, location_id: 'default', scene_name: 'main', plot: samplePlot(),
      spl_limit_db: 95, notes: 'keep me',
    });
    const upd = sound.updateSoundScene(db, s.id, 'default', { spl_limit_db: 100 });
    assert.equal(upd.scene_name, 'main');
    assert.equal(upd.notes, 'keep me');
    assert.equal(upd.spl_limit_db, 100);
  });
});

describe('deleteSoundScene', () => {
  it('removes the row + writes audit', () => {
    const s = sound.createSoundScene(db, {
      show_id: 1, location_id: 'default', scene_name: 'oops', plot: samplePlot(),
    });
    assert.equal(sound.deleteSoundScene(db, s.id, 'default'), true);
    assert.equal(sound.listSoundScenesForShow(db, 1, 'default').length, 0);
    const entries = readAuditEntries();
    assert.equal(entries.length, 2);
    assert.equal(entries[1].action, 'sound_scene_deleted');
    assert.equal(entries[1].scene_id, s.id);
  });

  it('throws NotFound on location mismatch', () => {
    const s = sound.createSoundScene(db, {
      show_id: 1, location_id: 'default', scene_name: 'main', plot: samplePlot(),
    });
    assert.throws(
      () => sound.deleteSoundScene(db, s.id, 'satellite'),
      /NotFound/,
    );
  });
});

describe('soundCompleteness', () => {
  it('scores 0 for empty list', () => {
    assert.equal(sound.soundCompleteness([]).score, 0);
  });

  it('scores ~0.33 with one scene + no SPL', () => {
    sound.createSoundScene(db, {
      show_id: 1, location_id: 'default', scene_name: 'a', plot: samplePlot(),
    });
    const c = sound.soundCompleteness(sound.listSoundScenesForShow(db, 1, 'default'));
    assert.equal(c.has_any_scene, true);
    assert.equal(c.scene_count, 1);
    assert.equal(c.has_spl_limit, false);
    assert.ok(Math.abs(c.score - 1 / 3) < 1e-9);
  });

  it('scores 1.0 with ≥2 scenes + SPL limit set', () => {
    sound.createSoundScene(db, {
      show_id: 1, location_id: 'default', scene_name: 'a', plot: samplePlot(),
      spl_limit_db: 95,
    });
    sound.createSoundScene(db, {
      show_id: 1, location_id: 'default', scene_name: 'b', plot: samplePlot(),
    });
    const c = sound.soundCompleteness(sound.listSoundScenesForShow(db, 1, 'default'));
    assert.equal(c.score, 1);
  });
});
