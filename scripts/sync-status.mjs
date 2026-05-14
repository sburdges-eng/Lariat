#!/usr/bin/env node
// scripts/sync-status.mjs
//
// Read-only operator diagnostic for the cross-host sync stack
// (lib/syncFeed.ts, lib/peerTrust.ts, lib/syncScheduler.ts). Prints:
//
//   - peer_trust rows: pubkey fingerprint, label, last_seen_at, revoked
//   - replay_checkpoints rows: peer_id, feed_scope, last_op_rowid, age
//   - sync_feed summary: total rows, oldest, newest, per-source counts
//
// Designed for `tail -F` and grep workflows. JSON output via --json for
// piping into other tooling. Exits 0 on success, 1 on unexpected error.
//
// Usage:
//   node --experimental-strip-types scripts/sync-status.mjs
//   node --experimental-strip-types scripts/sync-status.mjs --json
//   node --experimental-strip-types scripts/sync-status.mjs --help

import process from 'node:process';
import { register } from 'node:module';

register(new URL('../tests/js/resolver.mjs', import.meta.url));

const HELP = `sync-status — read-only diagnostic for the cross-host sync stack.

  --json       Print machine-readable JSON instead of human-readable text.
  -h, --help   Show this help.

Exit codes:
  0  ok (even when no peers / no rows — that's the steady state for a
     single-instance deploy)
  1  unexpected error
  64 usage error
`;

function parseArgs(argv) {
  const args = { json: false, help: false };
  for (const a of argv) {
    if (a === '-h' || a === '--help') args.help = true;
    else if (a === '--json') args.json = true;
    else throw new Error(`unknown arg: ${a}`);
  }
  return args;
}

export async function collectStatus(deps) {
  const { getDb } = deps;
  const db = getDb();

  const peers = db
    .prepare(
      `SELECT pubkey_hex, fingerprint, label, created_at, last_seen_at, revoked
       FROM peer_trust ORDER BY created_at ASC`,
    )
    .all();

  const checkpoints = db
    .prepare(
      `SELECT peer_id, feed_scope, last_op_rowid, updated_at
       FROM replay_checkpoints
       ORDER BY peer_id ASC, feed_scope ASC`,
    )
    .all();

  const feedSummaryRow = db
    .prepare(
      `SELECT COUNT(*) AS total,
              MIN(created_at) AS oldest,
              MAX(created_at) AS newest
       FROM sync_feed`,
    )
    .get();

  const perSource = db
    .prepare(
      `SELECT source_host, source_started_at, COUNT(*) AS cnt
       FROM sync_feed
       GROUP BY source_host, source_started_at
       ORDER BY cnt DESC, source_host ASC`,
    )
    .all();

  const perTable = db
    .prepare(
      `SELECT table_name, COUNT(*) AS cnt
       FROM sync_feed
       GROUP BY table_name
       ORDER BY cnt DESC, table_name ASC`,
    )
    .all();

  return {
    peers,
    checkpoints,
    feed: {
      total: Number(feedSummaryRow?.total ?? 0),
      oldest: feedSummaryRow?.oldest ?? null,
      newest: feedSummaryRow?.newest ?? null,
      bySource: perSource,
      byTable: perTable,
    },
  };
}

function renderHuman(status) {
  const lines = [];
  lines.push('# Lariat sync status');
  lines.push('');

  lines.push(`## peer_trust  (${status.peers.length} row${status.peers.length === 1 ? '' : 's'})`);
  if (status.peers.length === 0) {
    lines.push('  (none)');
  } else {
    for (const p of status.peers) {
      const flags = [];
      if (p.revoked) flags.push('REVOKED');
      const labelPart = p.label ? ` "${p.label}"` : '';
      const seen = p.last_seen_at ? `seen ${p.last_seen_at}` : 'never seen';
      lines.push(
        `  ${p.fingerprint}${labelPart} · ${seen}${flags.length ? ` · ${flags.join(',')}` : ''}`,
      );
    }
  }
  lines.push('');

  lines.push(`## replay_checkpoints  (${status.checkpoints.length} row${status.checkpoints.length === 1 ? '' : 's'})`);
  if (status.checkpoints.length === 0) {
    lines.push('  (none)');
  } else {
    for (const c of status.checkpoints) {
      lines.push(
        `  ${c.peer_id} [${c.feed_scope}] @ rowid ${c.last_op_rowid}  (updated ${c.updated_at})`,
      );
    }
  }
  lines.push('');

  lines.push(`## sync_feed  (${status.feed.total} row${status.feed.total === 1 ? '' : 's'})`);
  if (status.feed.total === 0) {
    lines.push('  (empty)');
  } else {
    lines.push(`  oldest:  ${status.feed.oldest}`);
    lines.push(`  newest:  ${status.feed.newest}`);
    lines.push('');
    lines.push('  by source:');
    for (const s of status.feed.bySource) {
      lines.push(`    ${s.source_host} @ ${s.source_started_at}  ×${s.cnt}`);
    }
    lines.push('');
    lines.push('  by table:');
    for (const t of status.feed.byTable) {
      lines.push(`    ${t.table_name.padEnd(28)} ×${t.cnt}`);
    }
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
  if (args.help) {
    console.log(HELP);
    return;
  }

  const { getDb } = await import('../lib/db.ts');
  const status = await collectStatus({ getDb });

  if (args.json) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    console.log(renderHuman(status));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('sync-status failed:', err);
    process.exit(1);
  });
}
