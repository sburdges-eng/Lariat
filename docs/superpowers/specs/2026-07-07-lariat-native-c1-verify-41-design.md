---
title: "Phase C1 — verify pass on the 41 unverified ported-write rows"
date: 2026-07-07
status: draft — SPEC
parent: docs/superpowers/specs/2026-07-03-lariat-native-phase-c1-rule-ledger.md
branch: feat/lariat-native-c1-verify-41
generator: hand-authored (spec-plan-tdd), executed via 7 parallel read-only refute agents
---

# Goal

Finish the adversarial-verify pass the 2026-07-03 C1 ledger left unfinished. The
ledger classified 130 `app/api/**` routes and marked 71 as **ported write**, but
the refute pass (an independent agent trying to *disprove* each "ported" claim)
only completed 27 of them before a spend limit halted; **41 remain `·`
(classify-only, unverified)**. Phase C5 deletes a web write route only once its
ledger row is verified-`ported` and its native owner covers every rule — so each
unverified row is a latent business-rule loss if C5 deletes it on faith.

This wave verifies all 41 vs the committed code on `main` (the ledger text is
stale — the 3 previously-refuted rows were resolved but their detail cells still
read `✗`), triages the refutations, TDD-fixes the real gaps under the
Break-wave pattern, and refreshes the ledger to a trustworthy state.

# Non-goals

- **Not** re-verifying the 27 already-upheld rows or the 3 resolved refutations
  (only their stale ledger cells get corrected — no re-audit).
- **Not** triaging the 9 low-confidence rows or the 21 edge-retained rows (that
  is ledger "Next actions" items 3 and 4, a separate pass).
- **Not** executing any C5 deletion. This wave only makes the ledger safe to act
  on later.
- **Not** porting anything greenfield. If a row is refuted because a rule was
  never ported (not merely mis-scoped), we fix the gap for parity, but we do not
  expand native scope beyond restoring web parity for the cited route.
- **Not** touching the web app (`app/api/**`, `lib/**`) or `data/lariat.db`.

# The 41 rows under verification (batches mirror the audit grouping)

| Batch | Domain (risk) | Routes |
|---|---|---|
| **B1** | HACCP / food-safety (regulated — highest) | checks, cleaning, cooling, date-marks, pest, sanitizer, sds, signoff, temp-log, thermometer-calibrations, tphc (11) |
| **B2** | Labor / HR (regulated) | certifications, performance-reviews, sick-leave, sick-worker, tip-pool, wage-notices (6) |
| **B3** | Inventory / prep / costing (mixed) | costing/ingredient-masters, costing/pack-changes, prep-par, prep-tasks, prep-tasks/[id], receiving, receiving/matches/[id] (7) |
| **B4** | Shows — box-office = cash custody (regulated) | shows/[id]/box-office, shows/[id]/box-office/[lineId], shows/[id]/capacity, shows/[id]/deal, shows/[id]/sound, shows/[id]/sound/[sceneId], shows/[id]/sound/spl, shows/[id]/stage (8) |
| **B5** | Specials / menu (mixed) | specials/saved, specials/saved/[id], specials/saved/[id]/export, specials/saved/[id]/promote (4) |
| **B6** | FOH + purchasing (mixed) | reservations, reservations/[id], purchasing/vendor-link/attach, purchasing/vendor-link/pair (4) |
| **B7** | Misc (low) | morning (1) |

# User-facing surface

None. This is an internal verification + doc-refresh wave. Its "outputs" are:

1. **A refute-finding per row**, structured as:
   ```
   { route, native_owner, verdict: "verified" | "refuted",
     gaps: [ { rule, web_ref: "file:line", native_ref: "file:line",
               kind: "location-scope|audit-in-tx|validation|pin-scope|idempotency|
                      domain-math|actor-source|status-code|not-ported",
               failure_scenario, tested: bool } ],
     upheld_notes }   // what WAS verified faithful, so the record is auditable
   ```
2. **A triage table** (confirmed-refuted rows → fix tasks) presented at the HALT.
3. **TDD fixes** — one commit per confirmed gap, tests first (Break-wave pattern).
4. **A refreshed ledger** — the `V` column and Summary counts made truthful.

# Data model deltas

None expected. Fixes restore parity in existing native repositories
(`LariatNative/Sources/LariatDB/*.swift`) and add tests
(`LariatNative/Tests/**`). No new tables/columns; no migration. If a fix appears
to need a schema change, that is a signal it is greenfield scope — stop and
surface it, do not proceed (see Non-goals).

# Invariants — the adversarial-refute checklist each row must pass

These are the failure modes the *completed* C1 pass actually caught (BEO lost
`AND location_id = ?` on delete/prep-done; Break skipped the open-break 409 for
waived meals; KA soft-stubbed an audited action). Each verifier tries to
**disprove** "ported" by hunting for a violation of these, reading the **web
route + native owner + native tests** for that row:

1. **Location scoping / IDOR** — every native write/read that the web scopes with
   `AND location_id = ?` must carry the same predicate. A cross-location caller
   must not mutate or read another location's row. Cross-location lookups return
   the web's status (usually 404, not 403 — no existence leak). *This is the #1
   gap the prior pass found; check every UPDATE/DELETE/SELECT-for-write.*
2. **Audit in the same transaction** — where web writes `audit_events` inside the
   same `db.transaction` as the source row, native must too (via
   `AuditedWriteRunner`/`AuditEventWriter` with the `isInsideTransaction` guard);
   audit failure must roll back the mutation. Where web uses JSONL
   (`logAuditAction`) instead of `audit_events`, native must match *that* choice,
   not silently upgrade/downgrade the audit channel.
3. **Validation parity** — every 400/422 the web returns (missing/typed/enum/
   length-clip/range) must have a native equivalent, rejecting **before any
   write**. Missing a soft-reject or a clip is a rule loss.
4. **PIN / temp-PIN scope gate** — the exact gate (`requirePin`,
   `hasPinOrTempPin`, `requirePinOrScope('...')`, or *deliberately none*) and the
   exact scope string must match. A regulated surface that drops its gate is a
   critical refutation.
5. **Idempotency** — `withIdempotency` present/absent must match web intent (and
   the *deliberate* exceptions must be preserved — e.g. temp-pin issue must NOT
   cache the raw PIN; specials export deliberately re-stamps every call).
6. **Domain / rule math** — HACCP classification (temp bands, sanitizer ppm,
   cooling breach, TPHC cutoff), labor caps (sick-leave accrual/cap, tip-pool
   COMPS §3.4 manager-exclusion, wage-notice freshness), and cash math (deal
   points, box-office qty) must be server-authoritative and match `lib/*`.
7. **Actor source & payload shape** — `actor_source` (`cook_ui`/`pic_ui`/
   `manager_ui`/`api`/route-specific) and audit payload/PII-redaction must match.
8. **Status-code fidelity** — 400 vs 422 vs 404 vs 409 vs 403 ordering and
   precedence (e.g. HACCP rejection outranking input-shape 400) must match.
9. **Coverage honesty** — a rule that is *implemented* but has **zero native
   test** is a partial finding (`tested: false`): parity code exists but is
   unverified. The Break wave treated this as a real gap worth a TDD test. Flag
   it; the triage decides whether it blocks C5.

A row is **verified** only if no gap survives across 1–9. Any surviving gap →
**refuted**, with the failure scenario and the web/native line refs.

# Method & execution

- **Verify vs code, not vs ledger text.** The ledger's line/column numbers are a
  2026-07-03 snapshot and some are stale; agents cite fresh `file:line` from the
  code on this branch.
- **7 read-only agents in parallel**, one per batch (B1–B7). Each is
  `general-purpose`, tools read-only by contract, and returns the structured
  finding list above. No agent edits code.
- **Triage → HALT.** Lead collates all findings, dedupes, and presents a triage
  table (confirmed refutations → proposed fix tasks) for human review **before
  any fix code is written** (this is the user-approved "verify all 41 → halt →
  fix" boundary).
- **TDD fixes** after approval, one commit per task, Break-wave pattern: write
  the failing parity test first, confirm it fails for the right reason, minimal
  fix to green, never weaken a test.
- **Ledger refresh** last: correct the 3 stale `✗` cells (L93/94/122), flip
  verified rows `·`→`✓` (or `·`→`✗` + resolution note for fixed ones), update the
  Summary block (`verified`, `refuted`, `verify not run` counts) and the drop the
  "Verification coverage is partial" caveat once the 41 are done.

# Open questions (surface to user at the HALT, not now)

- **OQ1 — coverage-only refutations.** For rows where the rule is correctly
  ported but has *zero* native test (invariant 9), do we (a) add the missing
  parity test this wave, or (b) log it as a follow-up and mark the row verified
  with a coverage caveat? The Break wave chose (a). Recommend (a) for regulated
  batches B1/B2/B4, (b) allowable for low-risk B7. *Decide per-row at triage.*
- **OQ2 — deliberate divergences.** Some rows document intentional stricter-than-
  web behavior (e.g. date-marks native adds a cross-location guard the web
  lacks). These are **not** refutations; the verifier records them as
  `verified (divergence documented)`. Confirm we keep documented-stricter as
  acceptable.
- **OQ3 — not-ported vs mis-scoped.** If a row is refuted because an action was
  never ported at all (like the KA `code_search` stub), the fix may be a
  *reclassification* (ported→deferred/edge) rather than code — same call the KA
  row got. Triage decides fix-vs-reclassify per row.
