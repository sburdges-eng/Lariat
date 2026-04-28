/**
 * Sound scene repo — Phase 2 event-ops (SCAFFOLD).
 *
 * Multiple `sound_scenes` rows per show: a band can save several scenes
 * (soundcheck, set 1, encore). Plot is structured JSON: channels, monitor
 * mixes, stage positions. Stored as one JSON blob because edits are
 * atomic-by-scene and the schema is band-specific (vocal-heavy band has
 * different channel layout than DJ).
 *
 * Status: SKELETON. Follows the lib/stageRepo.ts pattern. Phase 2 fills in:
 *   - createSoundScene(db, input): writes a new scene
 *   - listSoundScenesForShow(db, show_id, location_id)
 *   - getLatestSoundScene(db, show_id, location_id)
 *   - SPL log + scene-recall integration
 *   - autosave-draft pattern (localStorage on the client + server-side draft row)
 *
 * See docs/PHASE2_PLAN.md task A2 for the full task list.
 */

import type { Database } from 'better-sqlite3';
import { logAuditAction } from './auditLog.mjs';

// ── Types ──────────────────────────────────────────────────────────

export interface ChannelEntry {
  id: string;          // 'kick', 'snare', 'oh-l', 'vox-ld', 'gtr-1'
  label: string;       // 'Kick', 'Snare top', 'OH L', 'Lead vocal'
  source_type: 'mic' | 'di' | 'submix';
  position?: { x: number; y: number };
  notes?: string;
}

export interface MonitorMix {
  id: string;          // 'M1', 'M2', 'IEM-1'
  type: 'wedge' | 'iem';
  channels: string[];  // referenced channel ids
  notes?: string;
}

export interface SoundPlot {
  channels: ChannelEntry[];
  monitors: MonitorMix[];
  spl_limit_db?: number;
  notes?: string;
}

export interface SoundScene {
  id: number;
  show_id: number;
  location_id: string;
  scene_name: string;
  plot: SoundPlot;
  spl_limit_db: number | null;
  notes: string | null;
  saved_by_cook_id: string | null;
  saved_at: string;
}

interface RawSceneRow {
  id: number;
  show_id: number;
  location_id: string;
  scene_name: string;
  plot_json: string;
  spl_limit_db: number | null;
  notes: string | null;
  saved_by_cook_id: string | null;
  saved_at: string;
}

function rowToScene(r: RawSceneRow): SoundScene {
  return {
    id: r.id,
    show_id: r.show_id,
    location_id: r.location_id,
    scene_name: r.scene_name,
    plot: safeJson(r.plot_json, { channels: [], monitors: [] }),
    spl_limit_db: r.spl_limit_db,
    notes: r.notes,
    saved_by_cook_id: r.saved_by_cook_id,
    saved_at: r.saved_at,
  };
}

function safeJson<T>(s: string | null, fallback: T): T {
  if (s == null || s === '') return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

// ── Reads ──────────────────────────────────────────────────────────

export function listSoundScenesForShow(
  db: Database,
  show_id: number,
  location_id: string,
): SoundScene[] {
  const rows = db
    .prepare(
      `SELECT * FROM sound_scenes
        WHERE show_id = ? AND location_id = ?
        ORDER BY saved_at DESC, id DESC`,
    )
    .all(show_id, location_id) as RawSceneRow[];
  return rows.map(rowToScene);
}

export function getLatestSoundScene(
  db: Database,
  show_id: number,
  location_id: string,
): SoundScene | null {
  const row = db
    .prepare(
      `SELECT * FROM sound_scenes
        WHERE show_id = ? AND location_id = ?
        ORDER BY saved_at DESC, id DESC
        LIMIT 1`,
    )
    .get(show_id, location_id) as RawSceneRow | undefined;
  return row ? rowToScene(row) : null;
}

// ── Writes ────────────────────────────────────────────────────────

export interface CreateSoundSceneInput {
  show_id: number;
  location_id: string;
  scene_name: string;
  plot: SoundPlot;
  spl_limit_db?: number | null;
  notes?: string | null;
  saved_by_cook_id?: string | null;
}

export function createSoundScene(
  db: Database,
  input: CreateSoundSceneInput,
): SoundScene {
  if (!Number.isInteger(input.show_id) || input.show_id <= 0) {
    throw new Error('show_id must be a positive integer');
  }
  if (!input.scene_name || !input.scene_name.trim()) {
    throw new Error('scene_name is required');
  }

  const tx = db.transaction((): SoundScene => {
    const info = db.prepare(
      `INSERT INTO sound_scenes
         (show_id, location_id, scene_name, plot_json, spl_limit_db, notes, saved_by_cook_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.show_id,
      input.location_id,
      input.scene_name.trim(),
      JSON.stringify(input.plot ?? { channels: [], monitors: [] }),
      input.spl_limit_db ?? null,
      input.notes ?? null,
      input.saved_by_cook_id ?? null,
    );
    const row = db
      .prepare(`SELECT * FROM sound_scenes WHERE id = ?`)
      .get(Number(info.lastInsertRowid)) as RawSceneRow;
    logAuditAction({
      action: 'sound_scene_created',
      show_id: input.show_id,
      location_id: input.location_id,
      scene_name: row.scene_name,
      saved_by_cook_id: input.saved_by_cook_id ?? null,
    });
    return rowToScene(row);
  });
  return tx();
}

// ── Completeness signal (parallel to stageCompleteness) ───────────

export interface SoundCompleteness {
  has_any_scene: boolean;
  scene_count: number;
  has_spl_limit: boolean;
  /** 0..1 fraction of three milestones (any scene, ≥2 scenes, SPL limit set). */
  score: number;
}

export function soundCompleteness(scenes: SoundScene[]): SoundCompleteness {
  const has_any_scene = scenes.length > 0;
  const has_spl_limit = scenes.some((s) => typeof s.spl_limit_db === 'number');
  const milestones = [has_any_scene, scenes.length >= 2, has_spl_limit].filter(Boolean).length;
  return {
    has_any_scene,
    scene_count: scenes.length,
    has_spl_limit,
    score: milestones / 3,
  };
}
