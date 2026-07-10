import { getDb } from './db.ts';
import { DEFAULT_LOCATION_ID } from './location.ts';
import { validatePinFormat } from './tempPin.ts';
import { hashPinSecure, verifyPin, isLegacyHash } from './pinHash.ts';

export const MANAGER_PIN_ROLES = ['manager', 'owner'] as const;
export type ManagerPinRole = (typeof MANAGER_PIN_ROLES)[number];

export interface ManagerPinUser {
  id: number;
  location_id: string;
  name: string;
  role: ManagerPinRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  disabled_at: string | null;
}

interface ManagerPinRow {
  id: number;
  location_id: string;
  name: string;
  role: ManagerPinRole;
  is_active: number;
  created_at: string;
  updated_at: string;
  disabled_at: string | null;
}

function normalizeLocation(locationId?: string | null): string {
  const value = String(locationId || '').trim();
  return value || DEFAULT_LOCATION_ID;
}

function normalizeName(name: unknown): string {
  const value = typeof name === 'string' ? name.trim() : '';
  if (!value) throw new Error('name required');
  if (value.length > 80) throw new Error('name too long');
  return value;
}

function normalizeRole(role: unknown): ManagerPinRole {
  const value = typeof role === 'string' ? role.trim() : '';
  if (!value) return 'manager';
  if ((MANAGER_PIN_ROLES as readonly string[]).includes(value)) return value as ManagerPinRole;
  throw new Error('role must be manager or owner');
}

/** Active rows for a location, carrying pin_hash for scan-verify. Salted
 *  hashes can't be matched by SQL equality, so login and the duplicate-code
 *  guard both scan these and call verifyPin. Restaurant scale (a handful of
 *  active managers) makes the linear scan trivially cheap. */
function activeRowsWithHash(location: string): (ManagerPinRow & { pin_hash: string })[] {
  return getDb()
    .prepare(
      `SELECT id, location_id, name, role, is_active, created_at, updated_at, disabled_at, pin_hash
         FROM manager_pin_users
        WHERE location_id = ?
          AND is_active = 1`,
    )
    .all(location) as (ManagerPinRow & { pin_hash: string })[];
}

/** Keep login unambiguous: reject a PIN already held by another ACTIVE manager
 *  in this location. The DB UNIQUE(location_id, pin_hash) index can no longer
 *  enforce this (every salted hash is distinct), so we enforce it in code. */
function assertPinCodeFree(location: string, pin: string, exceptId: number | null = null): void {
  for (const row of activeRowsWithHash(location)) {
    if (exceptId !== null && row.id === exceptId) continue;
    if (verifyPin(pin, row.pin_hash)) {
      throw new Error('PIN already in use by an active manager');
    }
  }
}

function publicUser(row: ManagerPinRow): ManagerPinUser {
  return {
    id: row.id,
    location_id: row.location_id,
    name: row.name,
    role: row.role,
    is_active: row.is_active === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    disabled_at: row.disabled_at,
  };
}

export function listManagerPinUsers({
  locationId = DEFAULT_LOCATION_ID,
  includeDisabled = false,
}: {
  locationId?: string;
  includeDisabled?: boolean;
} = {}): ManagerPinUser[] {
  const location = normalizeLocation(locationId);
  const rows = getDb()
    .prepare(
      `SELECT id, location_id, name, role, is_active, created_at, updated_at, disabled_at
         FROM manager_pin_users
        WHERE location_id = ?
          ${includeDisabled ? '' : 'AND is_active = 1'}
        ORDER BY is_active DESC, updated_at DESC, id DESC`,
    )
    .all(location) as ManagerPinRow[];
  return rows.map(publicUser);
}

export function activeManagerPinUserCount(locationId = DEFAULT_LOCATION_ID): number {
  const location = normalizeLocation(locationId);
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n
         FROM manager_pin_users
        WHERE location_id = ?
          AND is_active = 1`,
    )
    .get(location) as { n: number } | undefined;
  return row?.n ?? 0;
}

export function hasActiveManagerPinUsers(locationId = DEFAULT_LOCATION_ID): boolean {
  return activeManagerPinUserCount(locationId) > 0;
}

export function managerPinGateConfigured(locationId = DEFAULT_LOCATION_ID): boolean {
  if ((process.env.LARIAT_PIN || '').trim()) return true;
  try {
    return hasActiveManagerPinUsers(locationId);
  } catch {
    return true;
  }
}

export function findActiveManagerByPin(
  pin: string,
  locationId = DEFAULT_LOCATION_ID,
): ManagerPinUser | null {
  const location = normalizeLocation(locationId);
  const value = typeof pin === 'string' ? pin : '';
  if (!validatePinFormat(value).ok) return null;

  // Scan-verify: salted hashes can't be looked up by equality. On a match
  // against a legacy unsalted SHA-256 row, transparently rehash with PBKDF2 so
  // the weak hash is retired the first time the manager logs in.
  for (const row of activeRowsWithHash(location)) {
    if (!verifyPin(value, row.pin_hash)) continue;
    if (isLegacyHash(row.pin_hash)) {
      getDb()
        .prepare(
          `UPDATE manager_pin_users
              SET pin_hash = ?, updated_at = datetime('now')
            WHERE id = ? AND location_id = ?`,
        )
        .run(hashPinSecure(value), row.id, location);
    }
    return publicUser(row);
  }
  return null;
}

export function createManagerPinUser({
  name,
  pin,
  role = 'manager',
  locationId = DEFAULT_LOCATION_ID,
}: {
  name: unknown;
  pin: unknown;
  role?: unknown;
  locationId?: string;
}): ManagerPinUser {
  const location = normalizeLocation(locationId);
  const cleanName = normalizeName(name);
  const cleanRole = normalizeRole(role);
  const pinValue = typeof pin === 'string' ? pin : '';
  const fmt = validatePinFormat(pinValue);
  if (!fmt.ok) throw new Error(fmt.error);
  assertPinCodeFree(location, pinValue);
  const pinHash = hashPinSecure(pinValue);
  const info = getDb()
    .prepare(
      `INSERT INTO manager_pin_users (location_id, name, pin_hash, role)
       VALUES (?, ?, ?, ?)`,
    )
    .run(location, cleanName, pinHash, cleanRole);
  return getManagerPinUser(Number(info.lastInsertRowid), location);
}

export function updateManagerPinUser({
  id,
  name,
  pin,
  role,
  isActive,
  locationId = DEFAULT_LOCATION_ID,
}: {
  id: unknown;
  name?: unknown;
  pin?: unknown;
  role?: unknown;
  isActive?: unknown;
  locationId?: string;
}): ManagerPinUser {
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId <= 0) throw new Error('id required');
  const location = normalizeLocation(locationId);
  const existing = getDb()
    .prepare(
      `SELECT id, location_id, name, role, is_active, created_at, updated_at, disabled_at
         FROM manager_pin_users
        WHERE id = ?
          AND location_id = ?`,
    )
    .get(userId, location) as ManagerPinRow | undefined;
  if (!existing) throw new Error('manager PIN user not found');

  const cleanName = name === undefined ? existing.name : normalizeName(name);
  const cleanRole = role === undefined ? existing.role : normalizeRole(role);
  let pinHash: string | null = null;
  if (pin !== undefined) {
    const pinValue = typeof pin === 'string' ? pin : '';
    const fmt = validatePinFormat(pinValue);
    if (!fmt.ok) throw new Error(fmt.error);
    assertPinCodeFree(location, pinValue, userId);
    pinHash = hashPinSecure(pinValue);
  }
  const nextActive = isActive === undefined ? existing.is_active === 1 : Boolean(isActive);

  if (pinHash) {
    getDb()
      .prepare(
        `UPDATE manager_pin_users
            SET name = ?,
                pin_hash = ?,
                role = ?,
                is_active = ?,
                updated_at = datetime('now'),
                disabled_at = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(disabled_at, datetime('now')) END
          WHERE id = ?
            AND location_id = ?`,
      )
      .run(cleanName, pinHash, cleanRole, nextActive ? 1 : 0, nextActive ? 1 : 0, userId, location);
  } else {
    getDb()
      .prepare(
        `UPDATE manager_pin_users
            SET name = ?,
                role = ?,
                is_active = ?,
                updated_at = datetime('now'),
                disabled_at = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(disabled_at, datetime('now')) END
          WHERE id = ?
            AND location_id = ?`,
      )
      .run(cleanName, cleanRole, nextActive ? 1 : 0, nextActive ? 1 : 0, userId, location);
  }

  return getManagerPinUser(userId, location);
}

export function disableManagerPinUser(
  id: unknown,
  locationId = DEFAULT_LOCATION_ID,
): ManagerPinUser {
  return updateManagerPinUser({ id, isActive: false, locationId });
}

function getManagerPinUser(id: number, locationId: string): ManagerPinUser {
  const row = getDb()
    .prepare(
      `SELECT id, location_id, name, role, is_active, created_at, updated_at, disabled_at
         FROM manager_pin_users
        WHERE id = ?
          AND location_id = ?`,
    )
    .get(id, locationId) as ManagerPinRow | undefined;
  if (!row) throw new Error('manager PIN user not found');
  return publicUser(row);
}
