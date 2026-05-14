/**
 * Per-peer Ed25519 identity keypair.
 *
 * Each Lariat instance carries one of these on disk and advertises a
 * truncated SHA-256 of its public key (the "fingerprint") in the mDNS
 * TXT record. Future cross-host sync uses signProof/verifyProof so a
 * peer can prove "I'm the same instance that advertised this pubkey
 * fingerprint" before either side accepts a sync feed.
 *
 * Storage: `data/peer-keypair.json`, chmod 600, gitignored.
 *   - The file holds DER-encoded SPKI (public) and PKCS8 (private) blobs
 *     as hex. Hex chosen over base64 to keep the file readable at a
 *     glance during incident response without leaking secrets to logs
 *     that strip non-printables.
 *   - `v: 1` lets a future rotation detect old shapes.
 *
 * Algo: Ed25519 — small (32B raw pub, 32B raw priv seed, 64B sig), fast,
 * deterministic, native to `node:crypto` since Node 12. No external dep.
 *
 * Rotation: delete the file. The next call to `loadOrCreateKeypair()`
 * generates a fresh pair; the new fingerprint appears in mDNS TXT and
 * peers that cached the old fingerprint will see this host as new. The
 * old key is unrecoverable, by design.
 *
 * Threat model: a leaked private key lets an attacker impersonate this
 * peer to others on the LAN. Mitigations are file-level only — chmod
 * 600 + gitignored. We deliberately do NOT encrypt the keypair at rest
 * — there is no other secret on the host robust enough to derive a key
 * from, and operators want zero-config reboot. Document this trade-off
 * in `docs/multi-instance-sync.md` once the sync layer ships.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveDataDir } from './dataDir.ts';

export interface Keypair {
  /** Raw 32-byte Ed25519 public key. Hash this for the fingerprint. */
  pubKey: Buffer;
  /** Raw 32-byte Ed25519 private seed. Never log this. */
  privKey: Buffer;
}

interface OnDiskKeypair {
  v: 1;
  pub_spki_hex: string;
  priv_pkcs8_hex: string;
  created_at: string;
}

// Resolve the data dir via the shared helper (lib/dataDir.ts) — honors
// LARIAT_DATA_DIR with a `<cwd>/data` fallback. A bare relative
// `'data/peer-keypair.json'` silently fails ENOENT inside packaged
// Electron because cwd is `Resources/app/`, where no `data/` exists.
export const DEFAULT_KEYPAIR_PATH = join(resolveDataDir(), 'peer-keypair.json');

// Ed25519 ASN.1 prefixes are fixed-length and well-known. Reconstructing
// SPKI/PKCS8 from a raw seed lets us hand a KeyObject to node:crypto's
// sign/verify without dragging in a JWK roundtrip.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_PKCS8_PREFIX = Buffer.from(
  '302e020100300506032b657004220420',
  'hex'
);

function rawPubFromSpki(spki: Buffer): Buffer {
  return spki.subarray(spki.length - 32);
}

function rawPrivFromPkcs8(pkcs8: Buffer): Buffer {
  return pkcs8.subarray(pkcs8.length - 32);
}

function spkiFromRawPub(rawPub: Buffer): Buffer {
  return Buffer.concat([ED25519_SPKI_PREFIX, rawPub]);
}

function pkcs8FromRawPriv(rawPriv: Buffer): Buffer {
  return Buffer.concat([ED25519_PKCS8_PREFIX, rawPriv]);
}

/**
 * Load the keypair from `path`, or generate-and-persist on first call.
 *
 * Idempotent across repeated invocations: subsequent calls re-read the
 * same file and yield byte-identical keys. Callers can safely invoke
 * this once per boot without reasoning about lifecycle.
 */
export function loadOrCreateKeypair(path: string = DEFAULT_KEYPAIR_PATH): Keypair {
  if (existsSync(path)) {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as OnDiskKeypair;
    if (parsed.v !== 1) {
      throw new Error(`peer-keypair: unsupported version ${String(parsed.v)}`);
    }
    return {
      pubKey: rawPubFromSpki(Buffer.from(parsed.pub_spki_hex, 'hex')),
      privKey: rawPrivFromPkcs8(Buffer.from(parsed.priv_pkcs8_hex, 'hex')),
    };
  }

  const dir = dirname(path);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub_spki = Buffer.from(
    publicKey.export({ type: 'spki', format: 'der' }) as Buffer
  );
  const priv_pkcs8 = Buffer.from(
    privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer
  );

  const onDisk: OnDiskKeypair = {
    v: 1,
    pub_spki_hex: pub_spki.toString('hex'),
    priv_pkcs8_hex: priv_pkcs8.toString('hex'),
    created_at: new Date().toISOString(),
  };
  writeFileSync(path, JSON.stringify(onDisk, null, 2), { mode: 0o600 });
  // Belt-and-suspenders chmod — Node's writeFileSync `mode` is masked by
  // umask on some platforms, so re-set explicitly. Best-effort on
  // platforms (Windows) where chmod is a no-op.
  try {
    chmodSync(path, 0o600);
  } catch {
    /* ignore */
  }

  return {
    pubKey: rawPubFromSpki(pub_spki),
    privKey: rawPrivFromPkcs8(priv_pkcs8),
  };
}

/**
 * Stable peer fingerprint: first 8 bytes (16 hex chars) of SHA-256(pubKey).
 *
 * 8 bytes ≈ 64 bits of collision space — vastly more than needed for the
 * tens-of-peers LAN scale Lariat targets, while still short enough to
 * fit comfortably inside a 255-byte mDNS TXT record (and into the
 * /management/peers UI column without wrapping).
 */
export function fingerprint(pubKey: Buffer): string {
  return createHash('sha256').update(pubKey).digest('hex').slice(0, 16);
}

/**
 * Sign `nonce` with the raw 32-byte Ed25519 seed. Returns hex.
 *
 * Used by the future cross-host sync handshake — peer sends a nonce,
 * this host signs it, peer verifies against the cached pubkey for the
 * advertised fingerprint. That proves the host has the private key
 * matching the fingerprint that mDNS broadcasts.
 */
export function signProof(privKey: Buffer, nonce: Buffer | string): string {
  const data = typeof nonce === 'string' ? Buffer.from(nonce, 'utf8') : nonce;
  const key = createPrivateKey({
    key: pkcs8FromRawPriv(privKey),
    format: 'der',
    type: 'pkcs8',
  });
  return cryptoSign(null, data, key).toString('hex');
}

/**
 * Verify `sigHex` against `nonce` for the raw 32-byte Ed25519 public key.
 *
 * Returns false on any failure (bad hex, length mismatch, sig mismatch)
 * rather than throwing — callers should treat false as "untrusted peer"
 * and never log the error path, because malformed inputs are exactly
 * what an attacker would feed.
 */
export function verifyProof(
  pubKey: Buffer,
  nonce: Buffer | string,
  sigHex: string
): boolean {
  const data = typeof nonce === 'string' ? Buffer.from(nonce, 'utf8') : nonce;
  let key;
  try {
    key = createPublicKey({
      key: spkiFromRawPub(pubKey),
      format: 'der',
      type: 'spki',
    });
  } catch {
    return false;
  }
  try {
    return cryptoVerify(null, data, key, Buffer.from(sigHex, 'hex'));
  } catch {
    return false;
  }
}
