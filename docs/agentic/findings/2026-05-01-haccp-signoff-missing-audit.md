# Breaker Audit Finding

**Subsystem:** HACCP / API audit atomicity

**Invariant:** Every regulated mutation must produce a corresponding `audit_events` row inside the same `db.transaction(...)` as the source INSERT. Source: `docs/PATTERNS.md §3` ("DB audit ... every regulated mutation"), `lib/auditEvents.ts:1-7` ("Every write to a regulated surface posts one row here").

`station_signoffs` is the manager attestation that CCP checks passed for a station-day-cook tuple. It is HACCP-critical: a health inspector or plaintiff's lawyer reconstructs signoff history from the audit trail, NOT from the source table.

**Break attempt:**
```
POST /api/signoff
  body: { shift_date: "2026-05-01", station_id: "saute", cook_id: "C001",
          signoff_type: "self", location_id: "default" }
```
followed by:
```
SELECT * FROM audit_events WHERE entity = 'station_signoffs' OR entity = 'station_signoff';
```

**Observed result:** The signoff row is INSERTed into `station_signoffs` inside `db.transaction(...)` (route line 48–59), but `postAuditEvent()` is **never called**. `audit_events` returns zero rows for the signoff. The route file does not import `auditEvents` at all (`grep -n postAuditEvent app/api/signoff/route.js` → empty).

**Expected result:** One `audit_events` row with `entity='station_signoffs'`, `action='insert'`, `entity_id=<lastInsertRowid>`, `actor_cook_id=<cook_id>`, `actor_source='cook_ui'` (or 'pic_ui'), `payload` carrying the signoff_type and shift/station/location, posted inside the same `db.transaction` so a rollback also rolls back the audit row.

**Risk:** Audit bypass on a regulated CCP attestation surface. A signoff happens on every shift, in every station — this is a continuously-firing audit gap. Reconstructing "who signed off station X on day Y" relies entirely on `station_signoffs.id` ordering; corrections (a manager re-signing after a corrected line-check fail) cannot be distinguished from the original.

**Repro command:**
```bash
# Run the existing API test bundle and grep for any signoff/audit assertion:
grep -E "(audit_events|postAuditEvent).*(signoff|station_signoffs)" \
  tests/js/test-bundle-h-apis.mjs tests/js/test-haccp-audit-atomicity.mjs \
  tests/js/test-toctou-race-regressions.mjs
# Returns nothing — the gap is uncovered by tests.
```

**Likely files:**
- `app/api/signoff/route.js:48-59` — the POST handler
- `lib/auditEvents.ts` — the helper to call
- New file: `tests/js/test-signoff-audit-atomicity.mjs` — pin the new contract

**Fix class:** logic + test

**Priority:** **P0** — data loss / audit bypass on a regulated HACCP surface.

---

## Optional notes

- The `failsMissingCorrectiveAction` gate (route line 17–31, 49) is correct and stays. The audit posting goes after the INSERT inside the same `db.transaction` closure (lines 53–58).
- `actor_cook_id` should come from `body.cook_id` since signoff is a self-attestation. `actor_source = 'cook_ui'` matches the existing pattern (`gold-stars/route.ts:43` uses `'api'` — this audit is closer to a cook UI write than an API-driven one).
- Existing tests (`test-bundle-h-apis.mjs`) treat `station_signoffs` as a read-only projection — they INSERT directly into the table for setup, never round-trip through the route. So adding the audit posting can't regress them.
- Fix shape mirrors `app/api/gold-stars/route.ts:36-47` exactly — same db.transaction + postAuditEvent shape.
- Adjacent thing noticed but NOT this finding: the route's outer try/catch wrapping `db.transaction` is the standard 500-handler pattern; that's fine. The audit failure (if added) will throw inside the tx, the tx rolls back, and the outer catch logs + returns 500. Correct contract.
