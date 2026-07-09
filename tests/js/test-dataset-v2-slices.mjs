import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Slices import production .ts — run generation once via a strip-types child,
// dumping a small deterministic sample to stdout as JSON (extractAction pre-run).
function sample(n = 240) {
  const out = execFileSync(process.execPath,
    ['--experimental-strip-types', '--no-warnings', 'training/datasetv2/sample-for-tests.mjs', String(n)],
    { env: { ...process.env, LARIAT_DATA_DIR: 'training/gcp/snapshot' }, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return JSON.parse(out);
}
const rows = sample();

const KNOWN_ACTIONS = new Set(['eighty_six', 'update_inventory', 'line_check', 'maintenance', 'scale_recipe',
  'update_order_guide', 'beo_add_prep', 'give_gold_star', 'haccp_receive', 'generate_prep', 'db_query', 'semantic_search']);

test('sample covers every slice', () => {
  const slices = new Set(rows.map((r) => r.meta.slice));
  for (const s of ['action_json', 'db_query', 'grounded_qa', 'allergen', 'haccp', 'refusal']) {
    assert.ok(slices.has(s), `missing slice ${s}`);
  }
});

test('every action_json / db_query example round-trips extractAction with a known action', () => {
  const actionRows = rows.filter((r) => ['action_json', 'db_query'].includes(r.meta.slice));
  assert.ok(actionRows.length > 20, 'expected a meaningful number of action rows in the sample');
  for (const r of actionRows) {
    const payload = r.extracted?.payload;
    assert.ok(payload, `no payload extracted from: ${r.messages[2].content.slice(0, 120)}`);
    assert.ok(KNOWN_ACTIONS.has(payload.action), `unknown action ${payload.action}`);
  }
});

test('action JSON is fenced and comes before the prose confirmation', () => {
  for (const r of rows.filter((r) => r.meta.slice === 'action_json')) {
    const a = r.messages[2].content;
    assert.match(a, /^```json\n/, `assistant target must start with the fenced JSON: ${a.slice(0, 80)}`);
  }
});

test('db_query targets use real registry names only', () => {
  const names = new Set(rows.find((r) => r.meta.registryNames)?.meta.registryNames || []);
  assert.ok(names.size >= 20, 'registry names not exported in sample meta');
  for (const r of rows.filter((r) => r.meta.slice === 'db_query')) {
    const p = r.extracted.payload;
    if (p.action === 'db_query') assert.ok(names.has(p.query), `invented query name: ${p.query}`);
  }
});

test('line_check with reading_f never carries status', () => {
  const lcs = rows.filter((r) => r.extracted?.payload?.action === 'line_check');
  for (const r of lcs) {
    const p = r.extracted.payload;
    if (p.reading_f != null) assert.equal(p.status, undefined, 'reading_f + status must not co-occur');
  }
});

test('scale/prep confirmations never restate computed quantities', () => {
  for (const r of rows.filter((r) => ['scale_recipe', 'beo_add_prep', 'generate_prep']
    .includes(r.extracted?.payload?.action))) {
    const prose = r.messages[2].content.replace(/```json[\s\S]*?```/, '');
    assert.ok(!/\d+(\.\d+)?\s*(cups?|qt|quarts?|lbs?|oz|grams?|g\b|kg|gallons?)/i.test(prose),
      `computed quantity leaked into prose: ${prose.slice(0, 120)}`);
  }
});

test('allergen answers never claim safety and always escalate', () => {
  const als = rows.filter((r) => r.meta.slice === 'allergen');
  assert.ok(als.length > 0);
  for (const r of als) {
    const a = r.messages[2].content.toLowerCase();
    for (const banned of ['is safe', 'safe to serve', 'free of', 'does not contain', "doesn't contain"]) {
      assert.ok(!a.includes(banned), `banned phrase "${banned}" in: ${a.slice(0, 140)}`);
    }
    assert.match(a, /cross[- ]contact/);
    assert.match(a, /manager/);
  }
});

test('haccp answers cite correct FDA temps (never 145F for poultry)', () => {
  for (const r of rows.filter((r) => r.meta.slice === 'haccp')) {
    const a = r.messages[2].content;
    // judge against the cook's actual question, not the CONTEXT block
    // (context routinely mentions chicken/poultry regardless of topic)
    const cookMsg = r.messages[1].content.split('COOK MESSAGE:\n')[1] || '';
    if (/poultry|chicken|turkey/i.test(cookMsg.split('\n')[0]) && /\b1[456]5\s*°?F/i.test(a)) {
      assert.match(a, /165\s*°?F/i, `poultry answer must cite 165F: ${a.slice(0, 140)}`);
    }
  }
});

test('refusal answers point to a real source, never invent numbers', () => {
  const refs = rows.filter((r) => r.meta.slice === 'refusal');
  assert.ok(refs.length > 0);
  for (const r of refs) {
    const a = r.messages[2].content;
    assert.match(a, /today.s Cockpit data|outside the Cockpit data boundary|n.t available to me/i);
    assert.match(a, /manager|Toast|Recipe Hub|86 board|order guide|purchasing/i);
  }
});

test('system message is the live GROUNDED_SYSTEM on every row', () => {
  for (const r of rows) {
    assert.match(r.messages[0].content,
      /^You are a kitchen assistant for a restaurant using the Lariat Cockpit app\./);
  }
});

test('user messages carry the runtime CONTEXT template + catalog', () => {
  for (const r of rows) {
    assert.match(r.messages[1].content, /^CONTEXT \(authoritative — only use these facts for operational claims\):/);
    assert.match(r.messages[1].content, /AVAILABLE DB QUERIES/);
    assert.match(r.messages[1].content, /---\nCOOK MESSAGE:\n/);
  }
});

test('command rows carry the ACTION ENGINE DIRECTIVE; question rows the ANSWER FORMAT', () => {
  for (const r of rows) {
    const u = r.messages[1].content;
    if (r.meta.slice === 'action_json') assert.match(u, /ACTION ENGINE DIRECTIVE:/);
    if (['grounded_qa', 'allergen', 'refusal'].includes(r.meta.slice)) assert.match(u, /ANSWER FORMAT:/);
  }
});

test('every cook message routes like its directive under the REAL classifier', () => {
  for (const r of rows) {
    const u = r.messages[1].content;
    const hasActionDirective = /ACTION ENGINE DIRECTIVE:/.test(u);
    assert.equal(r.isCmd, hasActionDirective,
      `classifier/directive mismatch (${r.meta.slice}): "${r.cookMsg.slice(0, 80)}"`);
  }
});

test('action_json rows carry manager-tier catalog + hasPin context (serve-time invariant)', () => {
  for (const r of rows.filter((x) => x.meta.slice === 'action_json' && !x.meta.sub)) {
    assert.match(r.messages[1].content, /\[manager\]/,
      `action row missing manager catalog: "${r.cookMsg.slice(0, 60)}"`);
  }
});

test('read-imperative db_query rows are cook-tier commands', () => {
  const ri = rows.filter((x) => x.meta.sub === 'read_imperative');
  for (const r of ri) {
    assert.equal(r.isCmd, true);
    assert.ok(!/\[manager\]/.test(r.messages[1].content), 'read-imperative rows must use the cook catalog');
    assert.equal(r.extracted?.payload?.action, 'db_query');
  }
});

test('eighty_six reason is never fabricated: payload.reason must be worded in the message', () => {
  for (const r of rows.filter((x) => x.extracted?.payload?.action === 'eighty_six')) {
    const reason = r.extracted.payload.reason;
    if (!reason) continue;
    const msg = r.cookMsg.toLowerCase();
    const rl = reason.toLowerCase();
    assert.ok(msg.includes(rl) || (rl === 'ran out' && /we ran out/.test(msg)),
      `fabricated reason "${reason}" not in message: "${r.cookMsg}"`);
  }
});

test('give_gold_star uses exact full roster names', () => {
  for (const r of rows.filter((x) => x.extracted?.payload?.action === 'give_gold_star')) {
    assert.match(r.extracted.payload.cook_name, /\s/,
      `cook_name must be a full display name: ${r.extracted.payload.cook_name}`);
  }
});
