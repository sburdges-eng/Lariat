# Breaker Audit Finding

**Subsystem:** HACCP / Kitchen Assistant LLM-action handler

**Invariant:** HACCP rule-module callers must surface the rule decision faithfully. An out-of-range or otherwise-invalid receiving reading must not be silently demoted to `status='na'` ("not applicable") — `na` bypasses the yellow/red distinction the 422 `needs_corrective_action` response was built to enforce. Source: AGENTS.md hard rule ("Never weaken validations or silently auto-correct records — surface errors. An out-of-range reading with a corrective note = yellow; without one = red").

**Break attempt:** Have the Kitchen Assistant emit:
```json
{ "action": "log_haccp_receiving",
  "item": "Tuna 6oz portions",
  "category": "RTE",
  "reading_f": 41.3,
  "package_ok": true }
```
then mutate `lib/receiving.ts::validateReceivingReading` to throw on any input shape it doesn't recognize (the regression that PR #95 introduced and then reverted — a future change could re-introduce it).

**Observed result:** `app/api/kitchen-assistant/route.js:474-487` catches the throw:
```js
try {
  const val = validateReceivingReading({ ... });
  status = dbStatusFor(val.status) === 'rejected' ? 'fail' : 'pass';
  ...
} catch (err) {
  status = 'na';
  note = `[Validation Error: ${err.message}] ${note || ''}`;
}
```
The route then writes the `line_check_entries` row with `status='na'` (lines 492–494) and posts an `audit_events` row recording that 'na' as the official status (line 498). The user sees `Logged HACCP receiving for Tuna 6oz portions (na).` (line 501) — no error, no 422 redirect, no corrective-action prompt.

**Expected result:** When `validateReceivingReading` throws, the LLM action must NOT write the row. Either:
(a) refuse the action and return an `actionMsg` saying the validator rejected the inputs, OR
(b) write `status='fail'` (not `'na'`) with the validator error in the note, so a manager can see the regulated red marker on the cook's board.

`status='na'` is reserved for items that genuinely don't apply at this station/shift. Using it as a fallback for "validation threw" hides a HACCP signal in the same bucket as "no fish today".

**Risk:** Regulated HACCP signal silently demoted under a degraded-validator path. The catch is dead code on current main (validateReceivingReading doesn't throw today), but it sits on the LLM-driven path — exactly where future failures will land first. Defense-in-depth concern, not a current data-loss bug.

**Repro command:**
```bash
# 1. Confirm the catch path exists:
sed -n '470,503p' app/api/kitchen-assistant/route.js | grep -E "catch|status = 'na'"
# 2. Confirm validateReceivingReading currently doesn't throw on unknown category:
sed -n '319,345p' lib/receiving.ts | grep -A3 "if (!rule)"
# 3. Confirm no test pins the contract (no test forces validateReceivingReading
#    to throw and asserts the route NOT writing 'na'):
grep -l "log_haccp_receiving.*throw\|validateReceivingReading.*throw" tests/js/*.mjs
```

**Likely files:**
- `app/api/kitchen-assistant/route.js:474-503` — the LLM-action catch + write path
- `lib/receiving.ts:319-345` — the rule module the catch is guarding
- New: `tests/js/test-kitchen-assistant-haccp-receiving-throw-path.mjs` — pin the new contract

**Fix class:** logic + test

**Priority:** **P2** — defense-in-depth on a degraded path; not currently triggered by any code on `main`.

---

## Optional notes

- This pairs with the #95 implementer's restoration of `accept_with_note` for unknown category — that fix preserves the contract via the rule module. The finding here is the BACKSTOP for the case where a future change to the rule module decides to throw for some new reason (e.g. a malformed reading_f that bypasses the route's pre-checks).
- Recommended fix: change the catch to `status = 'fail'` so the cook's board surfaces a red marker; keep the `[Validation Error: ...]` note prefix so the manager sees what the validator rejected. Add a test that calls validateReceivingReading via a thrown-spy and asserts the action writes `status='fail'`, not `'na'`.
- Adjacent thing noticed but NOT this finding: `actor_cook_id: null` on line 497 — the LLM-action audit path can't tell whose Kitchen Assistant session emitted the action. That's the known caller-asserted-actor gap (memory: `project_audit_actor_cook_id_caller_asserted.md`); resolves with future auth scaffolding.
