#!/usr/bin/env node
// Tests for lib/peerKeypair.ts.
//
// Run: node --experimental-strip-types --test tests/js/test-peer-keypair.mjs
//
// Contract under test (per the Item 13 plan):
//   - loadOrCreateKeypair() creates the file on first call and reads it
//     unchanged thereafter (idempotent across loads).
//   - fingerprint() is stable across loads — the on-disk SPKI/PKCS8 form
//     round-trips back to the same raw 32-byte pubKey, which hashes to
//     the same 16-hex digest.
//   - signProof() / verifyProof() round-trip on the same keypair, and
//     verifyProof() returns false (never throws) on malformed sig hex
//     and on a sig that doesn't match the message.

import { register } from 'node:module';
register(new URL('./resolver.mjs', import.meta.url));

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const {
  loadOrCreateKeypair,
  fingerprint,
  signProof,
  verifyProof,
} = await import('../../lib/peerKeypair.ts');

let tmp;
let kpPath;

before(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'lariat-peer-keypair-'));
  kpPath = path.join(tmp, 'peer-keypair.json');
});

after(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('loadOrCreateKeypair', () => {
  it('creates the file on first call and the file persists', () => {
    assert.equal(existsSync(kpPath), false);
    const kp = loadOrCreateKeypair(kpPath);
    assert.equal(existsSync(kpPath), true);
    assert.equal(kp.pubKey.length, 32);
    assert.equal(kp.privKey.length, 32);
  });

  it('returns byte-identical keys on repeat calls (idempotent)', () => {
    const a = loadOrCreateKeypair(kpPath);
    const b = loadOrCreateKeypair(kpPath);
    assert.equal(a.pubKey.toString('hex'), b.pubKey.toString('hex'));
    assert.equal(a.privKey.toString('hex'), b.privKey.toString('hex'));
  });

  it('writes the file with chmod 600 (owner-readable only)', () => {
    // Skip on platforms where chmod is a no-op (chmodSync silently
    // succeeds on Windows without changing the mode); the helper is
    // best-effort there. POSIX mode bits live in the lower 9 of mode.
    const mode = statSync(kpPath).mode & 0o777;
    if (process.platform === 'win32') return;
    assert.equal(mode, 0o600, `expected mode 600, got 0o${mode.toString(8)}`);
  });

  it('rejects an unsupported on-disk version', () => {
    const badPath = path.join(tmp, 'bad.json');
    writeFileSync(
      badPath,
      JSON.stringify({ v: 99, pub_spki_hex: '', priv_pkcs8_hex: '' }),
      'utf8'
    );
    assert.throws(() => loadOrCreateKeypair(badPath), /unsupported version/);
  });
});

describe('fingerprint', () => {
  it('is 16 hex characters and stable across loads', () => {
    const a = loadOrCreateKeypair(kpPath);
    const b = loadOrCreateKeypair(kpPath);
    const fpA = fingerprint(a.pubKey);
    const fpB = fingerprint(b.pubKey);
    assert.equal(fpA.length, 16);
    assert.match(fpA, /^[0-9a-f]{16}$/);
    assert.equal(fpA, fpB);
  });

  it('is distinct for two different keypairs', () => {
    const otherPath = path.join(tmp, 'other.json');
    const a = loadOrCreateKeypair(kpPath);
    const b = loadOrCreateKeypair(otherPath);
    assert.notEqual(
      fingerprint(a.pubKey),
      fingerprint(b.pubKey),
      'two freshly generated keypairs must not collide'
    );
  });
});

describe('signProof / verifyProof', () => {
  it('round-trips on the matching keypair', () => {
    const kp = loadOrCreateKeypair(kpPath);
    const nonce = 'lariat-handshake-2026-05';
    const sig = signProof(kp.privKey, nonce);
    assert.match(sig, /^[0-9a-f]+$/);
    assert.equal(verifyProof(kp.pubKey, nonce, sig), true);
  });

  it('rejects a tampered nonce', () => {
    const kp = loadOrCreateKeypair(kpPath);
    const sig = signProof(kp.privKey, 'original');
    assert.equal(verifyProof(kp.pubKey, 'tampered', sig), false);
  });

  it('rejects a sig from a different keypair', () => {
    const kpA = loadOrCreateKeypair(kpPath);
    const otherPath = path.join(tmp, 'attacker.json');
    const kpB = loadOrCreateKeypair(otherPath);
    const sig = signProof(kpB.privKey, 'hello');
    assert.equal(verifyProof(kpA.pubKey, 'hello', sig), false);
  });

  it('returns false (never throws) on malformed sig hex', () => {
    const kp = loadOrCreateKeypair(kpPath);
    assert.equal(verifyProof(kp.pubKey, 'msg', 'not-hex'), false);
    assert.equal(verifyProof(kp.pubKey, 'msg', ''), false);
    assert.equal(verifyProof(kp.pubKey, 'msg', 'aa'), false);
  });

  it('round-trips on Buffer nonces too', () => {
    const kp = loadOrCreateKeypair(kpPath);
    const nonce = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x01]);
    const sig = signProof(kp.privKey, nonce);
    assert.equal(verifyProof(kp.pubKey, nonce, sig), true);
  });
});
