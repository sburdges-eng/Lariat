#!/usr/bin/env node
// Debug + diagnostics CLI for Phase 2 event ops.
//
// Prints, per upcoming show, the completeness scores for stage / sound /
// box-office. Useful for the GM walking the floor before doors open and
// for spotting events that haven't been set up.
//
// Usage:
//   node --experimental-strip-types scripts/debug-event-ops.mjs
//   node --experimental-strip-types scripts/debug-event-ops.mjs --location=satellite
//   node --experimental-strip-types scripts/debug-event-ops.mjs --weeks=2
//   node --experimental-strip-types scripts/debug-event-ops.mjs --json

import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

// Register the same extensionless resolver hook the test runner uses,
// so transitive imports inside lib/showsRepo.ts (which writes
// `import './showStatus'` without an extension, Next-bundler-style)
// resolve under raw `node --experimental-strip-types`. Without this
// the script fails with ERR_MODULE_NOT_FOUND.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
register(new URL(path.join(__dirname, '..', 'tests', 'js', 'resolver.mjs'), 'file://'));

const { getDb } = await import('../lib/db.ts');
const { upcomingShows } = await import('../lib/showsRepo.ts');
const { getStageSetup, stageCompleteness } = await import('../lib/stageRepo.ts');
const { listSoundScenesForShow, soundCompleteness } = await import('../lib/soundRepo.ts');
const { summarizeBoxOffice, boxOfficeCompleteness } = await import('../lib/boxOfficeRepo.ts');

function parseArg(args, flag, dflt) {
  const i = args.findIndex((a) => a === flag || a.startsWith(`${flag}=`));
  if (i < 0) return dflt;
  if (args[i] === flag && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
  return args[i].split('=', 2)[1];
}

function fmtPct(n) {
  return `${(n * 100).toFixed(0)}%`;
}

function bar(score) {
  const filled = Math.round(score * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function tone(score) {
  if (score >= 0.8) return 'GREEN';
  if (score >= 0.4) return 'AMBER';
  return 'RED';
}

async function main() {
  const args = process.argv.slice(2);
  const location = parseArg(args, '--location', 'default');
  const weeks = Number(parseArg(args, '--weeks', '4'));
  const asJson = args.includes('--json');

  const db = getDb();
  const shows = upcomingShows(db, location, { weeks: Number.isFinite(weeks) ? weeks : 4 });

  const rows = shows.map((s) => {
    const stage = getStageSetup(db, s.id, location);
    const sceneList = listSoundScenesForShow(db, s.id, location);
    const boxSummary = summarizeBoxOffice(db, s.id, location);
    const stageC = stageCompleteness(stage);
    const soundC = soundCompleteness(sceneList);
    const boxC = boxOfficeCompleteness(boxSummary);
    const overall = (stageC.score + soundC.score + boxC.score) / 3;
    return {
      id: s.id,
      band: s.band_name,
      date: s.show_date,
      stage: { score: stageC.score, has_setup: stageC.has_setup },
      sound: { score: soundC.score, scene_count: soundC.scene_count },
      box_office: { score: boxC.score, total_qty: boxSummary.total_qty },
      overall,
      tone: tone(overall),
    };
  });

  if (asJson) {
    process.stdout.write(JSON.stringify({ location, weeks, shows: rows }, null, 2) + '\n');
    return;
  }

  if (rows.length === 0) {
    console.log(`No upcoming shows in the next ${weeks} week(s) at location "${location}".`);
    return;
  }

  console.log(`\nLariat event-ops completeness — location=${location}, window=${weeks}wk\n`);
  console.log('  Date        Band                         Stage          Sound          Box Office     Overall');
  console.log('  ─────────── ──────────────────────────── ────────────── ────────────── ────────────── ───────');
  for (const r of rows) {
    const band = (r.band || '').padEnd(28).slice(0, 28);
    const sLine = `${bar(r.stage.score)} ${fmtPct(r.stage.score)}`.padEnd(14);
    const oLine = `${bar(r.sound.score)} ${fmtPct(r.sound.score)}`.padEnd(14);
    const bLine = `${bar(r.box_office.score)} ${fmtPct(r.box_office.score)}`.padEnd(14);
    const oneline = `  ${r.date.padEnd(11)} ${band} ${sLine} ${oLine} ${bLine} ${fmtPct(r.overall)} ${r.tone}`;
    console.log(oneline);
  }
  const flagged = rows.filter((r) => r.tone !== 'GREEN');
  if (flagged.length > 0) {
    console.log('');
    console.log(`  ${flagged.length} show(s) below GREEN threshold — see /booking and /shows/<id>/<surface> to fill in.`);
  } else {
    console.log('\n  All upcoming shows are fully prepped.');
  }
  console.log('');
}

function detectIsMain() {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return import.meta.url === new URL(`file://${path.resolve(arg)}`).href;
  } catch {
    return false;
  }
}

if (detectIsMain()) {
  await main();
}
