// Dataset v2 entry point.
//   npm run training:generate-v2
//   (== LARIAT_DATA_DIR=training/gcp/snapshot node --experimental-strip-types training/datasetv2/generate.mjs)
// Pipeline: generate slices -> drop eval-contaminated + invalid-action rows ->
// PII scrub -> deterministic shuffle -> 90/10 split -> JSONL + stats.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRng, shuffle, buildScrubber, shingles, contaminated, emitJsonl } from './core.mjs';
import { loadSources } from './sources.mjs';
import { generateAll } from './slices.mjs';
const { extractAction } = await import('../../lib/extractAction.ts');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUT = join(HERE, 'out');

const SEED = 20260709;
const rng = makeRng(SEED);
const sources = loadSources();

// contamination set: user + context shingles of all 10 eval scenarios
const scenarios = JSON.parse(readFileSync(join(REPO, 'training', 'eval', 'scenarios.json'), 'utf8'));
const scenShingles = new Set();
for (const sc of scenarios) for (const sh of shingles(`${sc.user} ${sc.context}`)) scenShingles.add(sh);

console.error('generating slices (real contexts — takes a few minutes)…');
let rows = await generateAll(sources, rng, {});
const dropped = { contaminated: 0, invalidAction: 0 };
rows = rows.filter((r) => {
  if (contaminated(r, scenShingles)) { dropped.contaminated++; return false; }
  if (['action_json', 'db_query'].includes(r.meta.slice)) {
    const { payload } = extractAction(r.messages[2].content);
    if (!payload || typeof payload.action !== 'string') { dropped.invalidAction++; return false; }
  }
  return true;
});

const scrub = buildScrubber(sources.clientNames);
for (const r of rows) for (const m of r.messages) m.content = scrub(m.content);

const mixed = shuffle(rng, rows);
const valN = Math.floor(mixed.length * 0.1);
const val = mixed.slice(0, valN);
const train = mixed.slice(valN);
const perSlice = {};
for (const r of mixed) perSlice[r.meta.slice] = (perSlice[r.meta.slice] || 0) + 1;

emitJsonl(join(OUT, 'train.jsonl'), train);
emitJsonl(join(OUT, 'val.jsonl'), val);
const stats = {
  seed: SEED,
  totals: { train: train.length, val: val.length },
  perSlice,
  dropped,
  scrubbedClients: sources.clientNames.length,
};
writeFileSync(join(OUT, 'stats.json'), JSON.stringify(stats, null, 2) + '\n');
console.log(JSON.stringify(stats, null, 2));
