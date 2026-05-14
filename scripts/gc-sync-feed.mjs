#!/usr/bin/env node
// scripts/gc-sync-feed.mjs
//
// Audit M9 (2026-05-14): periodic GC for the sync_feed table.
// sync_feed is append-only; without cleanup it grows unbounded. A
// row is safe to delete once every known peer has checkpointed past
// it — at that point no peer can ever request it again. We also
// honor a minimum age (default 7 days) so a late-joining peer or one
// recovering from extended downtime gets time to catch up.
//
// Safe-delete floor:
//   MIN(replay_checkpoints.last_op_rowid) across all rows
//   AND id < sync_feed rows older than `--min-age-days`
//   AND there is at least one replay_checkpoint row (otherwise GC
//       would wipe the whole feed before any peer has ever
//       checkpointed — never the right action).
//
// Usage:
//   node --experimental-strip-types scripts/gc-sync-feed.mjs           (default: --dry-run)
//   node --experimental-strip-types scripts/gc-sync-feed.mjs --apply   actually DELETE
//   node --experimental-strip-types scripts/gc-sync-feed.mjs --min-age-days=14
//   node --experimental-strip-types scripts/gc-sync-feed.mjs --help
//
// Exit codes: 0 ok | 1 failed | 64 usage.
//
// Suggested cron (in data/scheduled-jobs.json):
//   { "command": ["npm", "run", "gc:sync-feed"],
//     "cron": "0 3 * * 0",            // Sundays at 3am
//     "timeout_sec": 300 }

import process from 'node:process';
import { register } from 'node:module';

register(new URL('../tests/js/resolver.mjs', import.meta.url));

const HELP = `gc-sync-feed — delete sync_feed rows acknowledged by every peer.

  --apply              Actually DELETE. Default is a dry-run preview.
  --min-age-days=N     Skip rows newer than N days regardless of
                       checkpoints (default 7). Gives late peers time
                       to catch up.
  --json               Machine-readable summary.
  -h, --help           This message.

Exit codes: 0 ok | 1 failed | 64 usage.
`;

function parseArgs(argv) {
  const args = {
    apply: false,
    minAgeDays: 7,
    json: false,
    help: false,
  };
  for (const a of argv) {
    if (a === '-h' || a === '--help') args.help = true;
    else if (a === '--apply') args.apply = true;
    else if (a === '--dry-run') args.apply = false;
    else if (a === '--json') args.json = true;
    else if (a.startsWith('--min-age-days=')) {
      const n = Number(a.slice('--min-age-days='.length));
      if (!Number.isFinite(n) || n < 0) throw new Error(`bad --min-age-days: ${a}`);
      args.minAgeDays = n;
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }
  return args;
}

export function computeGcFloor(db, minAgeDays) {
  // Floor 1: every peer's checkpoint. Take the MIN — rows below that
  // are acknowledged by everyone.
  const cp = db
    .prepare(
      `SELECT COUNT(*) AS n, MIN(last_op_rowid) AS lo
       FROM replay_checkpoints`,
    )
    .get();
  if (!cp || cp.n === 0) {
    // No checkpoints recorded — refuse to delete (GC could wipe the
    // whole feed before any peer has ever checkpointed).
    return { eligibleFloor: null, peerCheckpointCount: 0 };
  }
  // Floor 2: minimum age. Resolve the highest sync_feed.id older
  // than the cutoff timestamp.
  const ageBoundary = db
    .prepare(
      `SELECT MAX(id) AS hi
       FROM sync_feed
       WHERE created_at < datetime('now', ?)`,
    )
    .get(`-${minAgeDays} days`);
  const ageHi = ageBoundary?.hi ?? 0;
  return {
    eligibleFloor: Math.min(cp.lo, ageHi),
    peerCheckpointCount: cp.n,
    minPeerCheckpoint: cp.lo,
    maxAgedRow: ageHi,
  };
}

export async function runGc(args, deps) {
  const { getDb } = deps;
  const db = getDb();
  const totalBefore = db.prepare(`SELECT COUNT(*) AS n FROM sync_feed`).get().n;
  const floor = computeGcFloor(db, args.minAgeDays);
  if (floor.eligibleFloor === null) {
    return {
      apply: args.apply,
      totalBefore,
      deleted: 0,
      eligibleFloor: null,
      reason: 'no peer checkpoints recorded — refusing to GC',
      ...floor,
    };
  }
  const candidates = db
    .prepare(`SELECT COUNT(*) AS n FROM sync_feed WHERE id <= ?`)
    .get(floor.eligibleFloor).n;

  if (!args.apply) {
    return {
      apply: false,
      totalBefore,
      deleted: 0,
      candidatesIfApplied: candidates,
      eligibleFloor: floor.eligibleFloor,
      ...floor,
    };
  }
  const result = db
    .prepare(`DELETE FROM sync_feed WHERE id <= ?`)
    .run(floor.eligibleFloor);
  return {
    apply: true,
    totalBefore,
    deleted: result.changes,
    eligibleFloor: floor.eligibleFloor,
    ...floor,
  };
}

function renderHuman(r) {
  const lines = [];
  lines.push(`# sync_feed GC — ${r.apply ? 'APPLY' : 'dry-run'}`);
  lines.push('');
  lines.push(`  total rows:                ${r.totalBefore}`);
  lines.push(`  peer checkpoints recorded: ${r.peerCheckpointCount}`);
  if (r.eligibleFloor === null) {
    lines.push(`  eligible floor:            (none — ${r.reason})`);
    lines.push('');
    lines.push('  no-op.');
    return lines.join('\n');
  }
  lines.push(`  min peer checkpoint:       ${r.minPeerCheckpoint}`);
  lines.push(`  max aged row (id):         ${r.maxAgedRow}`);
  lines.push(`  eligible-delete floor:     ${r.eligibleFloor}`);
  if (r.apply) {
    lines.push(`  rows deleted:              ${r.deleted}`);
  } else {
    lines.push(`  would delete:              ${r.candidatesIfApplied}`);
    lines.push('');
    lines.push('  pass --apply to actually DELETE.');
  }
  return lines.join('\n');
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(String(e.message ?? e));
    console.error(HELP);
    process.exit(64);
  }
  if (args.help) { console.log(HELP); return; }
  const { getDb } = await import('../lib/db.ts');
  const result = await runGc(args, { getDb });
  console.log(args.json ? JSON.stringify(result, null, 2) : renderHuman(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('gc-sync-feed failed:', err);
    process.exit(1);
  });
}
