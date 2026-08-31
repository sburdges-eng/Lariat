---
title: "P7 — Signed HR paperwork suite (from LariatHR)"
date: 2026-08-31
status: draft — needs Sean's design sign-off before any code
canonical_id: hr-paperwork-suite
source: app-lineage audit 2026-08-31 (LariatHR / "Lariat Ops" com.therope.LariatHR, July 2026)
---

# P7 — Signed HR paperwork suite

Port the four HR paperwork concepts from LariatHR ("LARIAT TRY 3") that never
made it into the current product. Port **concepts, not code or DDL** — the
GRDB-era source tree is lost (only the July-9 binary survived, archived at
`~/lariat_dev/stash-archive-2026-08-30/app-lineage-20260831/`), the pre-dbfix
source (June 19, no DB) is at `Dev/lariat-data-sources/LariatHR` in the
recovery dump, and its schema predates today's.

## Why

A manager on a hot line needs a 2-minute injury log the moment it happens, and
a write-up that captures the employee's own words and both signatures at the
moment of the conversation. `docs/HEALTH_SAFETY_LABOR_AUDIT.md` already scores
"employee grievance with remedy" as a gap. Today: nothing — performance
reviews (3 scores + notes) are the only adjacent surface.

## The four forms (shared infrastructure first)

| # | Form | Core fields (from LariatHR) |
|---|------|------------------------------|
| 0 | Shared: form → PDF → signature infra | PDFKit-style generator; signature strokes rendered into the PDF; print path (NSPrintOperation pattern already in 6 boards) |
| 1 | Injury / incident report | type (injury/equipment/hazard), witnesses, immediate action taken, medical-attention flag + details, signature |
| 2 | Disciplinary write-up | violation type, level ladder (verbal → 1st written → final → suspension → termination), prior warnings, **employee's own statement**, corrective action, follow-up date, dual signatures |
| 3 | Onboarding checklist | W-4, I-9, direct deposit, food-handler cert, alcohol-service cert, allergen training, POS account, uniform/keys, handbook, tour — cert items land in `staff_certifications` on tick |
| 4 | Grievance report | ships nearly free on the same infra; closes the audit-doc gap |

Signature capture: trackpad on Mac now; **finger on iPad is the real target**
(H7b) — design the capture view for both from day one.

## Decisions Sean must make before code

1. **PHI custody for incident reports.** `medicalAttentionRequired` /
   `medicalDetails` are PHI-adjacent → must follow the sick-note custody
   contract (`docs/PROTECTED_CONTRACTS.md`): encrypted at rest, PIN-gated
   reads, audit-tied writes. Confirm scope: same Keychain key or its own?
2. **Where paper lives.** LariatHR's answer was "print to the office binder."
   Keep that, or file PDFs under Application Support with retention rules?
3. **Which tier.** Labor tier (with certs/sick time/tip pool) or Manager tier?
   Write-ups and grievances are manager-only reads (#607 fail-closed set).
4. **No hardcoded names.** LariatHR hardcoded real manager names in the
   grievance form — the port derives manager identity from the PIN session.

## Non-negotiables

- Spec → plan → TDD; every write audit-tied; PIN-gated per the board contract.
- Do not mix with costing/BEO/packaging work in one PR.
- Realistic test data (real-shaped names/violations), never foo/bar.
- PII from the LariatHR bundle (client names in BEO CSVs, RecipeBook.pdf)
  never enters this repo.

## Deferred with it (same source, lower priority)

- **Stage-plan inbox** — band-submitted `.stageplan` with revision diff,
  house-locked vs band-movable gear (shows arm; own spec when picked).
- **Recipe-book page citations** ("PDF p16" column) — tiny, needs a
  migration; bundle with the next recipes schema change.
- **Availability import/matcher** — only if scheduling moves off 7shifts.
