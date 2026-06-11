// First-run setup detection (roadmap 3.4).
//
// The /setup wizard does NOT track its own progress in a table — each
// step is detected from the live state it produces. That makes the
// flow re-entrant (refresh, switch devices, resume next week) and
// means steps complete automatically when the data shows up via any
// path (UI, CLI ingest, Data Pack drop).
//
// Detection rules:
//   pin            — process.env.LARIAT_PIN is set (middleware redirects
//                    to /login-pin?setup=1 until it is)
//   location       — a locations row exists beyond the automatic seed:
//                    either a non-'default' id, or the 'default' row
//                    renamed away from the seed name 'The Lariat'
//   vendor_prices  — at least one vendor_prices row for the location
//                    (arrives via `npm run ingest:costing`)
//   recipes        — getRecipes() (data/cache/recipes.json) is non-empty
//                    (arrives via `npm run ingest` / Data Pack)
//   toast          — OPTIONAL. Complete when toast_sales_daily has rows
//                    for the location; requires Toast credentials, so
//                    the wizard offers skip, never an inline action.

import { getDb } from './db.ts';
import { getRecipes } from './data.ts';
import { DEFAULT_LOCATION_ID } from './location.ts';
import { managerPinGateConfigured } from './managerPins.ts';

/** Seed name written by lib/db.ts seedDefaultLocation(). */
const DEFAULT_SEED_NAME = 'The Lariat';

export type SetupStepId =
  | 'pin'
  | 'location'
  | 'vendor_prices'
  | 'recipes'
  | 'toast';

export interface SetupStep {
  id: SetupStepId;
  label: string;
  complete: boolean;
  optional: boolean;
  /** Step-specific detail (counts, configured name) for the wizard UI. */
  detail: Record<string, unknown>;
}

export interface SetupStatus {
  location_id: string;
  steps: SetupStep[];
  /** True when every non-optional step is complete. */
  ready: boolean;
}

export function pinConfigured(): boolean {
  return managerPinGateConfigured(DEFAULT_LOCATION_ID);
}

interface LocationRow {
  id: string;
  name: string;
}

function locationSeeded(): { complete: boolean; detail: Record<string, unknown> } {
  const db = getDb();
  const rows = db
    .prepare(`SELECT id, name FROM locations ORDER BY id`)
    .all() as LocationRow[];
  const nonDefault = rows.filter((r) => r.id !== DEFAULT_LOCATION_ID);
  const defaultRow = rows.find((r) => r.id === DEFAULT_LOCATION_ID) || null;
  const renamedDefault = Boolean(defaultRow && defaultRow.name !== DEFAULT_SEED_NAME);
  const complete = nonDefault.length > 0 || renamedDefault;
  const configured = renamedDefault ? defaultRow : nonDefault[0] || null;
  return {
    complete,
    detail: {
      venue_name: configured ? configured.name : null,
      venue_id: configured ? configured.id : null,
    },
  };
}

function vendorPriceCount(locationId: string): number {
  const db = getDb();
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM vendor_prices WHERE location_id = ?`)
    .get(locationId) as { c: number };
  return row.c;
}

function toastRowCount(locationId: string): number {
  const db = getDb();
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM toast_sales_daily WHERE location_id = ?`)
    .get(locationId) as { c: number };
  return row.c;
}

export function getSetupStatus(locationId: string = DEFAULT_LOCATION_ID): SetupStatus {
  const loc = locationSeeded();
  const vendorCount = vendorPriceCount(locationId);
  const recipeCount = getRecipes().length;
  const toastCount = toastRowCount(locationId);

  const steps: SetupStep[] = [
    {
      id: 'pin',
      label: 'Manager PIN',
      complete: pinConfigured(),
      optional: false,
      detail: {},
    },
    {
      id: 'location',
      label: 'Name your venue',
      complete: loc.complete,
      optional: false,
      detail: loc.detail,
    },
    {
      id: 'vendor_prices',
      label: 'Import vendor prices',
      complete: vendorCount > 0,
      optional: false,
      detail: { count: vendorCount },
    },
    {
      id: 'recipes',
      label: 'Import recipes',
      complete: recipeCount > 0,
      optional: false,
      detail: { count: recipeCount },
    },
    {
      id: 'toast',
      label: 'Connect Toast POS',
      complete: toastCount > 0,
      optional: true,
      detail: { count: toastCount, requires_credentials: true },
    },
  ];

  const ready = steps.filter((s) => !s.optional).every((s) => s.complete);
  return { location_id: locationId, steps, ready };
}
