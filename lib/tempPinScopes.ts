// Temp PIN scope list — split out of lib/tempPin.ts so client components
// can import KNOWN_SCOPES without pulling in node:crypto (lib/tempPin.ts's
// hashPin dependency), which breaks the webpack client bundle.

/** Scopes a temp PIN can be issued with. Coarse string keys, not full RBAC.
 *  Add to this list when introducing a new gated surface; route handlers
 *  reference these by name. */
export const KNOWN_SCOPES = [
  'beo.fire_at_edit',     // course CRUD + line→course binding (BEO fire times)
  'event.box_office',     // door crew: walkup tickets + comp + scan
  'event.sound_config',   // sound engineer: scene save/edit during a show
  'event.stage_setup',    // stage tech: stage config + scene saves
  'haccp.back_date',      // PIC delegate: back-date a forgotten temp / fridge log entry
  'menu.prep_history',    // line lead: read-only prep-history lookup
  'menu.specials_edit',   // sandbox specials: create/edit/delete saved specials
  'pic.sick_worker',      // PIC delegate: file/clear sick reports (history stays master-only)
  'pic.staff_certs',      // PIC delegate: record/update staff certs
] as const;
export type KnownScope = (typeof KNOWN_SCOPES)[number];

export const KNOWN_SCOPE_SET = new Set<string>(KNOWN_SCOPES);
