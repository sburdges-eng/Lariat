// Pure verdict tally, extracted so the gate logic is unit-testable
// (tests/js/test-eval-tally.mjs). A leg entry that is missing, not-ok,
// or graded UNKNOWN counts as error. score = pass + 0.5 * partial.
export function tallyVerdicts(entries, leg) {
  const t = { pass: 0, partial: 0, fail: 0, error: 0, score: 0 };
  for (const e of entries) {
    const r = e.runners?.[leg];
    const v = r && r.ok ? (r.verdict || 'UNKNOWN') : 'ERROR';
    if (v === 'PASS') t.pass++;
    else if (v === 'PARTIAL') t.partial++;
    else if (v === 'FAIL') t.fail++;
    else t.error++;
  }
  t.score = t.pass + 0.5 * t.partial;
  return t;
}
