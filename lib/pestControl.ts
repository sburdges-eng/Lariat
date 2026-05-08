// Pest-control rule module (F8 / FDA §6-501.111).
//
// FDA §6-501.111 requires the operator to control pests by routinely
// inspecting incoming shipments, the premises, and using methods that
// minimize pest presence. We log three entry kinds — vendor service
// visits, line-cook sightings, and trap-check sweeps — so the inspector
// has a contemporaneous record on the door.
//
// Citations are FDA 2022 Food Code (Colorado incorporates by reference
// at 6 CCR 1010-2 §3-101). The §-cite lives as a named constant here
// so the UI / inspector tooltip / audit row never hand-types it.
//
// Pure module: no I/O, no DB, no clock read.

import type { PestControlEntry } from './db';

// ── Citations (single source of truth) ────────────────────────────

/** Controlling FDA Food Code section for pest presence on the premises. */
export const PEST_CITATION =
  'FDA §6-501.111 — controlling pests; minimizing presence of pests on the premises';

// ── Enums ─────────────────────────────────────────────────────────

const ENTRY_TYPES = new Set(['service_visit', 'sighting', 'trap_check']);
const PESTS = new Set(['roach', 'mouse', 'fly', 'ant', 'other']);
const SEVERITIES = new Set(['low', 'medium', 'high']);

export function validatePestControl(
  input: Partial<PestControlEntry> | null | undefined,
): {ok: boolean; reason?: string} {
  if (!input || typeof input !== 'object') {
    return { ok: false, reason: 'body must be an object' };
  }
  if (!input.entry_type || !ENTRY_TYPES.has(input.entry_type)) {
    return { ok: false, reason: 'invalid entry_type' };
  }
  if (input.entry_type === 'sighting' && !input.pest) {
    return { ok: false, reason: 'pest must be specified for a sighting' };
  }
  if (input.pest && !PESTS.has(input.pest)) {
    return { ok: false, reason: 'invalid pest type' };
  }
  if (input.severity && !SEVERITIES.has(input.severity)) {
    return { ok: false, reason: 'invalid severity' };
  }
  return { ok: true };
}
