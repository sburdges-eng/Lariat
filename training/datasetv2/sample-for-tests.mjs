// Emits the first N generated examples as JSON (with extractAction pre-run
// and the live registry names in meta) so plain node:test files don't need
// --experimental-strip-types themselves.
import { makeRng } from './core.mjs';
import { loadSources, querySpecs } from './sources.mjs';
import { generateAll } from './slices.mjs';
const { extractAction } = await import('../../lib/extractAction.ts');

const n = parseInt(process.argv[2] || '240', 10);
const rows = (await generateAll(loadSources(), makeRng(20260709), { perSliceCap: Math.ceil(n / 6) })).slice(0, n);
for (const r of rows) r.extracted = extractAction(r.messages[2].content);
if (rows.length) {
  rows[0].meta.registryNames = querySpecs('manager').map((q) => q.name)
    .concat(querySpecs('cook').map((q) => q.name));
}
process.stdout.write(JSON.stringify(rows));
