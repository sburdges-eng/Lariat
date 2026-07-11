import test from 'node:test';
import assert from 'node:assert/strict';
import { tallyVerdicts } from '../../training/eval/tally.mjs';

test('tallies claude leg with mixed verdicts', () => {
  const entries = [
    { runners: { claude: { ok: true, verdict: 'PASS' } } },
    { runners: { claude: { ok: true, verdict: 'PARTIAL' } } },
    { runners: { claude: { ok: false, error: 'x' } } },
  ];
  assert.deepEqual(tallyVerdicts(entries, 'claude'),
    { pass: 1, partial: 1, fail: 0, error: 1, score: 1.5 });
});

test('tallies ollama leg; missing runner counts as error', () => {
  const entries = [
    { runners: { claude: { ok: true, verdict: 'PASS' }, ollama: { ok: true, verdict: 'FAIL' } } },
    { runners: { claude: { ok: true, verdict: 'PASS' } } }, // no ollama entry
  ];
  assert.deepEqual(tallyVerdicts(entries, 'ollama'),
    { pass: 0, partial: 0, fail: 1, error: 1, score: 0 });
});

test('UNKNOWN verdict counts as error', () => {
  const entries = [{ runners: { ollama: { ok: true, verdict: 'UNKNOWN' } } }];
  assert.equal(tallyVerdicts(entries, 'ollama').error, 1);
});
