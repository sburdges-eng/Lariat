/**
 * beoRates — single source of truth for BEO money rates.
 *
 * WHY THIS EXISTS
 * ---------------
 * The tax rate was written in four places: the `beo_events` DDL default, two
 * ALTER migrations, and a literal fallback in `app/api/beo/route.js`. A fifth
 * and sixth copy live outside the repo (the BEO skill and Studio 5) at a
 * DIFFERENT value (8.15% vs 6.75%). Nothing read `locations.tax_rate`, which
 * the migration at lib/db.ts:3920 explicitly added to be the per-event
 * fallback — it was dead config from the day it shipped.
 *
 * This module makes `locations` the one place the number lives.
 *
 * DELIBERATELY NOT A SCHEMA CHANGE
 * --------------------------------
 * `scripts/check-schema-version-bump.mjs` requires a SCHEMA_VERSION bump for
 * any DDL edit, because LariatNative trusts `schema_migrations.MAX(version)`
 * as its drift marker. Touching the DDL defaults would force a bump and put
 * the native app's guard in play for what is really an application-layer fix.
 * The DDL defaults are therefore left alone and simply stop being
 * load-bearing: nothing reads them once every write path resolves here.
 *
 * PRECEDENCE
 *   1. explicit per-event value  (operator typed it on this event)
 *   2. locations.tax_rate        (the house rate)
 *   3. throw                     — never a literal fallback
 *
 * Rule 3 is the point. A missing rate must fail loudly at the write path
 * rather than quietly billing whatever constant happened to be nearest.
 */

import type Database from 'better-sqlite3';

type DB = Database.Database;

export class BeoRateUnsetError extends Error {
  field: string;
  locationId: string;

  constructor(field: string, locationId: string) {
    super(
      `${field} is not set for location "${locationId}". ` +
        `Set the house rate once:\n` +
        `  UPDATE locations SET ${field} = <value> WHERE id = '${locationId}';\n` +
        `This is deliberately not defaulted — see lib/beoRates.ts.`,
    );
    this.name = 'BeoRateUnsetError';
    this.field = field;
    this.locationId = locationId;
  }
}

export interface HouseRates {
  taxRate: number | null;
  serviceFeePct: number | null;
}

export interface ResolvedRates {
  taxRate: number;
  serviceFeePct: number;
  taxSource: 'event' | 'location';
  feeSource: 'event' | 'location';
}

function finite(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read the house rates for a location. Returns nulls if unset — callers
 * decide whether that is fatal (writes) or tolerable (display).
 */
export function getLocationRates(db: DB, locationId: string): HouseRates {
  const row = db
    .prepare(`SELECT tax_rate, service_fee_pct FROM locations WHERE id = ?`)
    .get(locationId) as { tax_rate?: unknown; service_fee_pct?: unknown } | undefined;
  return {
    taxRate: finite(row?.tax_rate),
    serviceFeePct: finite(row?.service_fee_pct),
  };
}

/**
 * Resolve the rates an event should be billed at.
 *
 * `overrides` is the raw request body; only tax_rate / service_fee_pct are
 * read from it. `taxSource` / `feeSource` report which rung of the
 * precedence chain applied, so the caller can audit-log it.
 *
 * Throws BeoRateUnsetError when neither an override nor a house rate exists.
 */
export function resolveBeoRates(
  db: DB,
  locationId: string,
  overrides: { tax_rate?: unknown; service_fee_pct?: unknown } = {},
): ResolvedRates {
  const house = getLocationRates(db, locationId);

  const evTax = finite(overrides.tax_rate);
  const evFee = finite(overrides.service_fee_pct);

  const taxRate = evTax ?? house.taxRate;
  const serviceFeePct = evFee ?? house.serviceFeePct;

  if (taxRate === null) throw new BeoRateUnsetError('tax_rate', locationId);
  if (serviceFeePct === null) throw new BeoRateUnsetError('service_fee_pct', locationId);

  return {
    taxRate,
    serviceFeePct,
    taxSource: evTax !== null ? 'event' : 'location',
    feeSource: evFee !== null ? 'event' : 'location',
  };
}
