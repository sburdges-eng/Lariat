import type { PestControlEntry } from './db';

const ENTRY_TYPES = new Set(['service_visit', 'sighting', 'trap_check']);
const PESTS = new Set(['roach', 'mouse', 'fly', 'ant', 'other']);
const SEVERITIES = new Set(['low', 'medium', 'high']);

export function validatePestControl(input: Partial<PestControlEntry>): {ok: boolean; reason?: string} {
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
