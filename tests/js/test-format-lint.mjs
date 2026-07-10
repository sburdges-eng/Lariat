import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lintCommandResponse, lintQuestionResponse, KNOWN_ACTIONS,
} from '../../training/eval/format-lint.mjs';

// ── command-path linter (deterministic pre-gate — no LLM) ────────────────────

test('command: clean single action + confirmation passes', () => {
  const r = lintCommandResponse('```json\n{"action":"scale_recipe","recipe":"bacon_jam","multiplier":3}\n```\nScaled ×3.');
  assert.equal(r.ok, true, r.violations.join('; '));
  assert.equal(r.payload.action, 'scale_recipe');
});

test('command: DOUBLE-emitted action fails (the v2 leak)', () => {
  const r = lintCommandResponse(
    '```json\n{"action":"scale_recipe","recipe":"x","multiplier":3}\n```\nOk.\n' +
    '```json\n{"action":"scale_recipe","recipe":"x","multiplier":3}\n```');
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => /more than one|second|multiple/i.test(v)), r.violations.join('; '));
});

test('command: a leaked <think> block fails', () => {
  const r = lintCommandResponse('<think>let me reason</think>\n```json\n{"action":"eighty_six","item":"salmon"}\n```\n86d.');
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => /think/i.test(v)));
});

test('command: unknown action name fails', () => {
  const r = lintCommandResponse('```json\n{"action":"delete_everything","item":"x"}\n```\nDone.');
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => /unknown action/i.test(v)));
});

test('command: no action JSON at all fails', () => {
  const r = lintCommandResponse('Sure, I scaled the bacon jam by three.');
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => /no action/i.test(v)));
});

test('command: numeric quantity in the trailing prose fails (server owns the math)', () => {
  const r = lintCommandResponse('```json\n{"action":"scale_recipe","recipe":"x","multiplier":3}\n```\nThat makes 30 qt of bacon jam.');
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => /quantit|number/i.test(v)));
});

test('command: db_query with a real registry name passes', () => {
  const r = lintCommandResponse('```json\n{"action":"db_query","query":"recent_temp_log","params":{"hours":8}}\n```\nHere.',
    { validQueryNames: ['recent_temp_log'] });
  assert.equal(r.ok, true, r.violations.join('; '));
});

test('command: db_query with an invented name fails when a registry list is given', () => {
  const r = lintCommandResponse('```json\n{"action":"db_query","query":"made_up_query","params":{}}\n```',
    { validQueryNames: ['recent_temp_log'] });
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => /query name/i.test(v)));
});

// ── question-path linter ─────────────────────────────────────────────────────

test('question: grounded prose passes', () => {
  const r = lintQuestionResponse('- Nothing is 86 today.\n- Check the board with a manager.');
  assert.equal(r.ok, true, r.violations.join('; '));
});

test('question: a write action on the question path fails', () => {
  const r = lintQuestionResponse('```json\n{"action":"eighty_six","item":"salmon"}\n```');
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => /write action|not allowed/i.test(v)));
});

test('question: db_query / semantic_search ARE allowed on the question path', () => {
  assert.equal(lintQuestionResponse('```json\n{"action":"db_query","query":"sales_by_dish","params":{}}\n```').ok, true);
  assert.equal(lintQuestionResponse('```json\n{"action":"semantic_search","query":"cherry cake","limit":6}\n```').ok, true);
});

test('question: a leaked <think> block fails', () => {
  const r = lintQuestionResponse('<think>hmm</think>\nNothing is 86.');
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => /think/i.test(v)));
});

test('allergen intent: an answer that says "safe"/"free of" fails', () => {
  const r = lintQuestionResponse('The bacon jam is safe for a peanut allergy.', { intent: 'allergen' });
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => /safe|allergen/i.test(v)));
});

test('allergen intent: cross-contact + escalation passes', () => {
  const r = lintQuestionResponse('- Recipe shows peanut via the sauce.\n- Cross-contact is possible; escalate to a manager.', { intent: 'allergen' });
  assert.equal(r.ok, true, r.violations.join('; '));
});

test('allergen intent: a serve-decision that omits escalation still fails', () => {
  // T03-class question ("is X safe for an allergy?") must warn + escalate.
  const r = lintQuestionResponse('The recipe does not list peanut.', { intent: 'allergen' });
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => /cross[- ]contact|manager|escalat/i.test(v)));
});

test('allergen_identify intent: a terse ingredient-ID answer passes (no escalation required)', () => {
  // T04-class question ("what is the egg source?") is identification, not a
  // serve decision — the cross-contact/manager nudge is a soft quality nit here,
  // not a ship-blocker, so a correct terse answer must pass the hard gate.
  const r = lintQuestionResponse('- The egg in the aji verde comes from mayonnaise.', { intent: 'allergen_identify' });
  assert.equal(r.ok, true, r.violations.join('; '));
});

test('allergen_identify intent: STILL bans a "safe"/"free of" claim', () => {
  // The dangerous false-assurance is never permitted, on identification either.
  const r = lintQuestionResponse('The aji verde is free of egg.', { intent: 'allergen_identify' });
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => /safe|free of|allergen/i.test(v)));
});

test('haccp intent: poultry answer must cite 165F', () => {
  assert.equal(lintQuestionResponse('Poultry must hit 165°F for 15 seconds.', { intent: 'haccp', requireTemp: '165' }).ok, true);
  const bad = lintQuestionResponse('Poultry is fine at 145°F.', { intent: 'haccp', requireTemp: '165' });
  assert.equal(bad.ok, false);
  assert.ok(bad.violations.some((v) => /165/.test(v)));
});

test('KNOWN_ACTIONS covers the 10 write actions + db_query/semantic_search', () => {
  for (const a of ['eighty_six', 'update_inventory', 'line_check', 'maintenance', 'scale_recipe',
    'update_order_guide', 'beo_add_prep', 'give_gold_star', 'haccp_receive', 'generate_prep',
    'db_query', 'semantic_search']) {
    assert.ok(KNOWN_ACTIONS.has(a), `missing ${a}`);
  }
});
