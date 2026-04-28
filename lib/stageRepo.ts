/**
 * Stage setup repo — Phase 2 event-ops.
 *
 * Per-show operator-mutable state for the stage manager:
 *   - room_config  : one of KNOWN_ROOM_CONFIGS (Listening Room, Cabaret, etc.)
 *   - run_of_show  : ordered list of {t, what, who} entries
 *   - hospitality_rider, tech_rider: structured JSON blobs
 *   - notes        : freeform manager notes
 *
 * One stage_setups row per (show_id, location_id) — UPSERTed. Edits are
 * audited via lib/auditLog.mjs (file stream — operational, not regulated).
 * The cash-custody / box-office side uses lib/auditEvents.ts (DB stream)
 * because it's regulated; stage config is a soft-state edit.
 *
 * Reference implementation for Phase 2 — soundRepo + boxOfficeRepo follow
 * the same shape.
 */

import type { Database } from 'better-sqlite3';
import { logAuditAction } from './auditLog.mjs';

// ── Catalog ────────────────────────────────────────────────────────

/**
 * House decision: the six room configurations the venue can be set up
 * as. Captured here (not the DB) so adding a new config is a
 * code-review event, not an ops event. Capacity is the marketing-board
 * cap, not the fire-marshal cap.
 */
export const KNOWN_ROOM_CONFIGS = {
  listening_room_220: {
    name: 'Listening Room · 220 std',
    description: 'Theater rows · all attention on stage',
    layout: '14 rows × 16 chairs · risers back third',
    capacity: 220,
    changeover: { staff: 5, minutes: 35 },
    best_for: 'Singer-songwriters · acoustic acts',
  },
  cabaret_160: {
    name: 'Cabaret · 160',
    description: 'Tops of 4 with food/drink service',
    layout: '40× 4-tops · 32 in main · 8 mezz',
    capacity: 160,
    changeover: { staff: 5, minutes: 40 },
    best_for: 'Jazz · soul · dinner shows',
  },
  half_house_180: {
    name: 'Half-house · 180 std',
    description: 'Half-tops · half open floor',
    layout: "20× 4-tops front · standing back",
    capacity: 180,
    changeover: { staff: 4, minutes: 22 },
    best_for: 'Folk-rock · 4-5 piece bands',
  },
  dance_floor_240: {
    name: 'Dance Floor · 240 std',
    description: 'All standing · open dance pit',
    layout: "no tops · barrier 6' from stage",
    capacity: 240,
    changeover: { staff: 5, minutes: 35 },
    best_for: 'DJ sets · honky-tonk · loud shows',
  },
  private_dining_60: {
    name: 'Private Dining · 60',
    description: 'Long tables · stage dressed for ambiance',
    layout: '2× banquet rows · 30 each',
    capacity: 60,
    changeover: { staff: 4, minutes: 30 },
    best_for: 'Rehearsal dinners · corp offsites',
  },
  open_jam_140: {
    name: 'Open Jam · 140 std',
    description: 'Sun nights · loose, mixed',
    layout: '12× tops floor · open bar zone',
    capacity: 140,
    changeover: { staff: 3, minutes: 18 },
    best_for: 'Free Sunday sessions',
  },
} as const;

export type RoomConfigKey = keyof typeof KNOWN_ROOM_CONFIGS;

export function isKnownRoomConfig(key: string): key is RoomConfigKey {
  return key in KNOWN_ROOM_CONFIGS;
}

// ── Types ──────────────────────────────────────────────────────────

export interface RunOfShowEntry {
  t: string;       // "5:30 PM"
  what: string;    // "Doors", "SET 1", "Curfew"
  who: string;     // "Door · Box · Bar"
}

export interface HospitalityRider {
  beverage?: string[];
  food?: string[];
  notes?: string;
  hospitality_cost_usd?: number;
}

export interface TechRider {
  house_provides?: string[];
  band_provides?: string[];
  vehicle?: string;
  parking?: string;
  contact?: { name: string; phone: string };
}

export interface StageSetup {
  id: number;
  show_id: number;
  location_id: string;
  room_config: RoomConfigKey;
  run_of_show: RunOfShowEntry[];
  hospitality_rider: HospitalityRider;
  tech_rider: TechRider;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface RawStageRow {
  id: number;
  show_id: number;
  location_id: string;
  room_config: string;
  run_of_show_json: string;
  hospitality_rider_json: string;
  tech_rider_json: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToSetup(r: RawStageRow): StageSetup {
  return {
    id: r.id,
    show_id: r.show_id,
    location_id: r.location_id,
    room_config: r.room_config as RoomConfigKey,
    run_of_show: safeJson(r.run_of_show_json, []) as RunOfShowEntry[],
    hospitality_rider: safeJson(r.hospitality_rider_json, {}) as HospitalityRider,
    tech_rider: safeJson(r.tech_rider_json, {}) as TechRider,
    notes: r.notes,
    created_at: r.created_at,
    updated_at: r.updated_at,
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

export function getStageSetup(
  db: Database,
  show_id: number,
  location_id: string,
): StageSetup | null {
  const row = db
    .prepare(
      `SELECT * FROM stage_setups WHERE show_id = ? AND location_id = ?`,
    )
    .get(show_id, location_id) as RawStageRow | undefined;
  return row ? rowToSetup(row) : null;
}

export function listStageSetupsForLocation(
  db: Database,
  location_id: string,
  opts: { limit?: number } = {},
): StageSetup[] {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
  const rows = db
    .prepare(
      `SELECT s.* FROM stage_setups s
        WHERE s.location_id = ?
        ORDER BY s.updated_at DESC LIMIT ?`,
    )
    .all(location_id, limit) as RawStageRow[];
  return rows.map(rowToSetup);
}

// ── Writes ────────────────────────────────────────────────────────

export interface UpsertStageSetupInput {
  show_id: number;
  location_id: string;
  room_config: RoomConfigKey;
  run_of_show?: RunOfShowEntry[];
  hospitality_rider?: HospitalityRider;
  tech_rider?: TechRider;
  notes?: string | null;
  /** Optional caller-asserted actor — keeps shape consistent with audit_events. */
  actor_cook_id?: string | null;
}

export interface UpsertResult {
  setup: StageSetup;
  created: boolean;
}

/**
 * UPSERT stage_setups by (show_id, location_id). Writes a management-action
 * audit row inside the same tx. Validates room_config against
 * KNOWN_ROOM_CONFIGS — unknown values throw; the API route maps to 400.
 */
export function upsertStageSetup(
  db: Database,
  input: UpsertStageSetupInput,
): UpsertResult {
  if (!isKnownRoomConfig(input.room_config)) {
    throw new Error(`unknown room_config: ${input.room_config}`);
  }
  if (!Number.isInteger(input.show_id) || input.show_id <= 0) {
    throw new Error('show_id must be a positive integer');
  }

  const ros = JSON.stringify(input.run_of_show ?? []);
  const hr = JSON.stringify(input.hospitality_rider ?? {});
  const tr = JSON.stringify(input.tech_rider ?? {});
  const notes = input.notes ?? null;

  const tx = db.transaction((): UpsertResult => {
    const existing = db
      .prepare(
        `SELECT id FROM stage_setups WHERE show_id = ? AND location_id = ?`,
      )
      .get(input.show_id, input.location_id) as { id: number } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE stage_setups
            SET room_config = ?,
                run_of_show_json = ?,
                hospitality_rider_json = ?,
                tech_rider_json = ?,
                notes = ?,
                updated_at = datetime('now')
          WHERE id = ?`,
      ).run(input.room_config, ros, hr, tr, notes, existing.id);
      logAuditAction({
        action: 'stage_setup_updated',
        show_id: input.show_id,
        location_id: input.location_id,
        room_config: input.room_config,
        actor_cook_id: input.actor_cook_id ?? null,
      });
      const updated = db
        .prepare(`SELECT * FROM stage_setups WHERE id = ?`)
        .get(existing.id) as RawStageRow;
      return { setup: rowToSetup(updated), created: false };
    }

    const info = db
      .prepare(
        `INSERT INTO stage_setups
           (show_id, location_id, room_config,
            run_of_show_json, hospitality_rider_json, tech_rider_json, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.show_id, input.location_id, input.room_config, ros, hr, tr, notes);
    const inserted = db
      .prepare(`SELECT * FROM stage_setups WHERE id = ?`)
      .get(Number(info.lastInsertRowid)) as RawStageRow;
    logAuditAction({
      action: 'stage_setup_created',
      show_id: input.show_id,
      location_id: input.location_id,
      room_config: input.room_config,
      actor_cook_id: input.actor_cook_id ?? null,
    });
    return { setup: rowToSetup(inserted), created: true };
  });

  return tx();
}

// ── Completeness signal (for the debug CLI + dashboard tile) ──────

export interface StageCompleteness {
  has_setup: boolean;
  has_room_config: boolean;
  has_run_of_show: boolean;
  has_hospitality_rider: boolean;
  has_tech_rider: boolean;
  /** 0..1 fraction of the four "has_*" fields filled. */
  score: number;
}

export function stageCompleteness(setup: StageSetup | null): StageCompleteness {
  if (!setup) {
    return {
      has_setup: false,
      has_room_config: false,
      has_run_of_show: false,
      has_hospitality_rider: false,
      has_tech_rider: false,
      score: 0,
    };
  }
  const flags = {
    has_setup: true,
    has_room_config: isKnownRoomConfig(setup.room_config),
    has_run_of_show: setup.run_of_show.length > 0,
    has_hospitality_rider: Object.keys(setup.hospitality_rider).length > 0,
    has_tech_rider: Object.keys(setup.tech_rider).length > 0,
  };
  const filled = [
    flags.has_room_config,
    flags.has_run_of_show,
    flags.has_hospitality_rider,
    flags.has_tech_rider,
  ].filter(Boolean).length;
  return { ...flags, score: filled / 4 };
}
