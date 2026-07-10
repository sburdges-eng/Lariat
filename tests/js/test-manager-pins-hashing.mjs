#!/usr/bin/env node
// Manager PIN storage hardening (audit 2026-07-10 P0-3): PINs are stored with
// per-user salted PBKDF2, not unsalted SHA-256. Legacy rows still authenticate
// and are rehashed on first successful login. Two ACTIVE managers may not share
// a PIN code (scan-verify keeps login unambiguous once DB UNIQUE can't).
//
// Run: node --experimental-strip-types --test tests/js/test-manager-pins-hashing.mjs

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '4242';
delete process.env.LARIAT_PIN_SECRET;

const db = await import('../../lib/db.ts');
db.setDbPathForTest(':memory:');
const conn = db.getDb();

const managerPins = await import('../../lib/managerPins.ts');
const { verifyPin, isLegacyHash } = await import('../../lib/pinHash.ts');

const legacySha256 = (pin) => createHash('sha256').update(pin).digest('hex');

after(() => {
  db.setDbPathForTest(null);
  if (ORIGINAL_PIN === undefined) delete process.env.LARIAT_PIN;
  else process.env.LARIAT_PIN = ORIGINAL_PIN;
  if (ORIGINAL_SECRET === undefined) delete process.env.LARIAT_PIN_SECRET;
  else process.env.LARIAT_PIN_SECRET = ORIGINAL_SECRET;
});

beforeEach(() => {
  conn.exec('DELETE FROM manager_pin_users; DELETE FROM audit_events;');
});

describe('manager PIN storage uses salted PBKDF2', () => {
  it('stores a salted PBKDF2 hash, not the raw PIN or an unsalted SHA-256', () => {
    const created = managerPins.createManagerPinUser({ name: 'Sean', pin: '1357', role: 'owner' });
    const row = conn.prepare('SELECT pin_hash FROM manager_pin_users WHERE id = ?').get(created.id);
    assert.notEqual(row.pin_hash, '1357');
    assert.notEqual(row.pin_hash, legacySha256('1357'), 'must not be unsalted SHA-256');
    assert.equal(isLegacyHash(row.pin_hash), false);
    assert.equal(verifyPin('1357', row.pin_hash), true);
  });

  it('gives two managers with the same PIN distinct salted hashes (no reuse signal)', () => {
    const a = managerPins.createManagerPinUser({ name: 'A', pin: '2468' });
    // second active user with the same code is rejected (see below); use a
    // disabled first user so both rows coexist and we can compare hashes.
    managerPins.disableManagerPinUser(a.id);
    const b = managerPins.createManagerPinUser({ name: 'B', pin: '2468' });
    const rowA = conn.prepare('SELECT pin_hash FROM manager_pin_users WHERE id = ?').get(a.id);
    const rowB = conn.prepare('SELECT pin_hash FROM manager_pin_users WHERE id = ?').get(b.id);
    assert.notEqual(rowA.pin_hash, rowB.pin_hash);
  });
});

describe('migrate-on-auth', () => {
  it('authenticates a legacy SHA-256 row and rehashes it to PBKDF2 on success', () => {
    const info = conn
      .prepare(
        `INSERT INTO manager_pin_users (location_id, name, pin_hash, role) VALUES ('default', 'Legacy', ?, 'manager')`,
      )
      .run(legacySha256('9753'));
    const id = Number(info.lastInsertRowid);
    assert.equal(isLegacyHash(conn.prepare('SELECT pin_hash FROM manager_pin_users WHERE id=?').get(id).pin_hash), true);

    const match = managerPins.findActiveManagerByPin('9753', 'default');
    assert.equal(match.id, id);

    const after = conn.prepare('SELECT pin_hash FROM manager_pin_users WHERE id=?').get(id).pin_hash;
    assert.equal(isLegacyHash(after), false, 'legacy hash should be upgraded to PBKDF2');
    assert.equal(verifyPin('9753', after), true);
  });

  it('does not rehash when the PIN is wrong', () => {
    const info = conn
      .prepare(
        `INSERT INTO manager_pin_users (location_id, name, pin_hash, role) VALUES ('default', 'Legacy', ?, 'manager')`,
      )
      .run(legacySha256('1111'));
    const id = Number(info.lastInsertRowid);
    assert.equal(managerPins.findActiveManagerByPin('2222', 'default'), null);
    assert.equal(isLegacyHash(conn.prepare('SELECT pin_hash FROM manager_pin_users WHERE id=?').get(id).pin_hash), true);
  });
});

describe('duplicate active PIN codes are rejected', () => {
  it('refuses to create a second active manager with the same PIN code', () => {
    managerPins.createManagerPinUser({ name: 'First', pin: '1212' });
    assert.throws(
      () => managerPins.createManagerPinUser({ name: 'Second', pin: '1212' }),
      /in use|duplicate|already/i,
    );
  });

  it('refuses to update a manager onto another active manager\'s PIN code', () => {
    managerPins.createManagerPinUser({ name: 'First', pin: '3434' });
    const second = managerPins.createManagerPinUser({ name: 'Second', pin: '5656' });
    assert.throws(
      () => managerPins.updateManagerPinUser({ id: second.id, pin: '3434' }),
      /in use|duplicate|already/i,
    );
  });

  it('allows reusing a disabled user\'s PIN code for a new active user', () => {
    const first = managerPins.createManagerPinUser({ name: 'First', pin: '7878' });
    managerPins.disableManagerPinUser(first.id);
    const second = managerPins.createManagerPinUser({ name: 'Second', pin: '7878' });
    assert.ok(second.id > 0);
    assert.equal(managerPins.findActiveManagerByPin('7878', 'default').id, second.id);
  });
});
