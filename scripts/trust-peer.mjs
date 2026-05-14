#!/usr/bin/env node
// scripts/trust-peer.mjs
//
// Operator CLI for the peer_trust allowlist that gates
// /api/peers/sync-since. Audit M8 (2026-05-14): pre-fix there was no
// CLI or UI path to populate peer_trust, so an operator who set
// LARIAT_SYNC_PEERS and started the scheduler would find every
// signed request returning 401 from the remote.
//
// Subcommands:
//   add <pubkey-hex> [--label=<label>]    add or update a trusted peer
//   revoke <pubkey-hex>                   mark peer revoked
//   unrevoke <pubkey-hex>                 lift a prior revocation
//   list [--json]                          list all peers
//   show <pubkey-or-fingerprint>          show one peer's details
//
// pubkey-hex is the remote's raw 32-byte Ed25519 pubkey in lowercase
// hex (64 chars). On the remote, read it from data/peer-keypair.json:
//   jq -r '.pub_spki_hex | .[24:]' data/peer-keypair.json
// (strip the 12-byte SPKI prefix; the trailing 32 bytes are the raw
// pubkey hex.)
//
// Exit codes: 0 ok | 1 failed | 64 usage error.
//
// Usage:
//   node --experimental-strip-types scripts/trust-peer.mjs add <hex>
//   node --experimental-strip-types scripts/trust-peer.mjs list
//   node --experimental-strip-types scripts/trust-peer.mjs --help

import process from 'node:process';
import { register } from 'node:module';

register(new URL('../tests/js/resolver.mjs', import.meta.url));

const HELP = `trust-peer — manage the cross-host sync peer_trust allowlist.

  add <pubkey-hex> [--label=<label>]
      Add or update a trusted peer. label is operator-set; pubkey-hex
      is the remote's raw 32-byte Ed25519 pubkey hex (64 chars).

  revoke <pubkey-hex>
      Mark peer revoked. Audit-trail preserved.

  unrevoke <pubkey-hex>
      Lift a prior revocation. Required for re-trusting a banned peer
      since addPeer no longer auto-clears revoked (audit M3).

  list [--json]
      List all peers. --json for machine-readable output.

  show <pubkey-or-fingerprint>
      Print one peer's row. Accepts either the full pubkey hex
      (64 chars) or the 16-hex-char fingerprint.

Exit codes: 0 ok | 1 failed | 64 usage error.
`;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(HELP);
    process.exit(argv.length === 0 ? 64 : 0);
  }
  const sub = argv[0];
  const rest = argv.slice(1);

  const { getDb } = await import('../lib/db.ts');
  const peerTrust = await import('../lib/peerTrust.ts');
  const db = getDb();

  switch (sub) {
    case 'add': {
      const pubkeyHex = rest[0];
      if (!pubkeyHex) {
        console.error('add: pubkey-hex required');
        process.exit(64);
      }
      let label = null;
      for (const a of rest.slice(1)) {
        if (a.startsWith('--label=')) label = a.slice(8);
      }
      try {
        const row = peerTrust.addPeer(db, pubkeyHex, label);
        console.log(`OK added/updated: ${row.fingerprint}  label=${row.label ?? ''}  revoked=${row.revoked}`);
      } catch (e) {
        console.error(`add failed: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
      break;
    }
    case 'revoke': {
      const pubkeyHex = rest[0];
      if (!pubkeyHex) { console.error('revoke: pubkey-hex required'); process.exit(64); }
      const ok = peerTrust.revokePeer(db, pubkeyHex);
      console.log(ok ? 'OK revoked' : 'no-op (peer unknown)');
      process.exit(ok ? 0 : 1);
      break;
    }
    case 'unrevoke': {
      const pubkeyHex = rest[0];
      if (!pubkeyHex) { console.error('unrevoke: pubkey-hex required'); process.exit(64); }
      const ok = peerTrust.unrevokePeer(db, pubkeyHex);
      console.log(ok ? 'OK unrevoked' : 'no-op (peer not revoked or unknown)');
      process.exit(ok ? 0 : 1);
      break;
    }
    case 'list': {
      const peers = peerTrust.listPeers(db);
      const json = rest.includes('--json');
      if (json) {
        console.log(JSON.stringify(peers, null, 2));
      } else if (peers.length === 0) {
        console.log('  (no trusted peers)');
      } else {
        console.log('# fingerprint        label                last_seen_at         revoked');
        for (const p of peers) {
          const label = (p.label ?? '').padEnd(20);
          const seen = (p.last_seen_at ?? 'never').padEnd(20);
          const rev = p.revoked ? 'REVOKED' : '';
          console.log(`  ${p.fingerprint}  ${label} ${seen} ${rev}`);
        }
      }
      break;
    }
    case 'show': {
      const id = rest[0];
      if (!id) { console.error('show: pubkey-or-fingerprint required'); process.exit(64); }
      const row =
        id.length === 64
          ? peerTrust.getPeerByPubkey(db, id)
          : peerTrust.getPeerByFingerprint(db, id);
      if (!row) {
        console.error('not found');
        process.exit(1);
      }
      console.log(JSON.stringify(row, null, 2));
      break;
    }
    default:
      console.error(`unknown subcommand: ${sub}`);
      console.error(HELP);
      process.exit(64);
  }
}

main().catch((err) => {
  console.error('trust-peer failed:', err);
  process.exit(1);
});
