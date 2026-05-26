# Lariat ERP Master Proposal

**Status:** Phase 3 planning synthesis complete.
**Date:** 2026-05-26
**Scope:** Planning document only. No schema, runtime, build, or deployment change is authorized by this proposal.

## Governance declaration

| Field | Declaration |
|-------|-------------|
| Affected subsystem | Planning docs for Lariat ERP, Phase 3 scope, roadmap, and agent handoff |
| Freeze-readiness impact | Improves freeze readiness by naming what is shipped, what is deferred, and what needs a separate implementation plan |
| Determinism impact | None at runtime; this proposal preserves local-first, reproducible-source expectations |
| Security impact | None at runtime; future write paths remain PIN-gated and audited |
| Runtime AI coupling introduced | No |

## Executive summary

Lariat should advance as a local-first restaurant ERP, not as a cloud SaaS clone. The durable product shape is a deterministic operations system for receiving, inventory, recipes, costing, HACCP, labor, KDS coordination, POS analytics, and management rollups.

Phase 3 has already delivered the first operator-facing proof points:

- Closed-loop receiving writes delivery truth into inventory.
- `/management` rollup exists as the manager entry point.
- KDS ticket and bump workflows exist with Lariat-local bump state.
- Temp-PIN and BEO station/fire-time work expanded time-boxed authority and production coordination.

The next work should stabilize those flows and their contracts before any database-platform or service-topology expansion.

## Non-negotiable architecture posture

1. **Offline-first runtime.** The bundled app must keep working without cloud APIs. External systems can be ingest sources or export targets, but they cannot become hidden runtime dependencies for core kitchen, inventory, or food-safety work.
2. **Deterministic artifacts.** Generated data, reports, indexes, and exports must be reproducible from source inputs and scripts.
3. **Schema discipline.** Any new structured contract needs a `schemaVersion`, canonical ordering, explicit invariants, and migration coverage. No silent in-place schema drift.
4. **Local AI boundary.** Development AI may help build the system. Runtime AI must stay explicit, locally configured where possible, and non-authoritative for regulated or financial records.
5. **Operational plain language.** UI and report copy must stay kitchen-readable: short labels, no SaaS jargon, no dev-style field names.

## Current ERP capability map

| Capability | Current state | Completion posture |
|------------|---------------|--------------------|
| Receiving | Closed-loop receiving shipped | Stabilize audit, SKU matching, and exception handling |
| Inventory | Counts, pars, updates, depletion, master ingredient mapping | Keep single-venue SQLite as source of truth for now |
| Costing | BOM, vendor prices, food-cost and variance surfaces | Continue toward variance attribution and price-shock actionability |
| Management | `/management` rollup shipped | Expand only by composing existing computes first |
| KDS | Ticket mirror/manual ticket/local bump shipped | Toast authoritative bump is deferred |
| HACCP / food safety | Validation-heavy regulated workflows exist | Do not weaken validation or auto-correct records silently |
| POS / vendors | Toast, Sysco, Shamrock ingestion paths exist | Keep integrations explicit and replayable |
| Runtime AI / LaRi | Local assistant patterns exist | Do not let AI become source of truth for records |

## Phase 3 completion definition

Phase 3 should be considered planning-complete when the team has:

1. A single source proposal for the ERP direction.
2. A scoped near-term lane that does not require database migration or microservices.
3. Explicit deferrals for high-risk platform changes.
4. A handoff that names the next implementation slice.

This document completes the planning synthesis. It does not complete the implementation work.

## Recommended next implementation lane

### 1. SKU to inventory-master stabilization

Bring receiving, ingredient masters, vendor item aliases, and inventory updates into a tighter contract.

Acceptance criteria:

- Receiving writes are keyed to stable inventory or ingredient master identifiers.
- Ambiguous vendor matches fail closed into a queue.
- The queue uses short kitchen language and has audit coverage.
- No new schema is added without a migration and invariant list.

Why first: every higher-level ERP surface depends on trusted on-hand and cost inputs.

### 2. Management rollup hardening

Keep `/management` as the operator entry point, but expand it only by composing known computes.

Acceptance criteria:

- COGS, labor, price shocks, depletion exceptions, and certification warnings either link to existing pages or clearly state no current data.
- Manager-facing labels avoid internal table names.
- PIN and audit behavior stay consistent with existing management routes.

Why second: this turns the receiving and costing work into an operator workflow without adding hidden contracts.

### 3. KDS protocol regression coverage

Keep the shipped Lariat-local KDS posture stable before revisiting Toast round-trips.

Acceptance criteria:

- KDS response fields are pinned against the protocol document.
- Parser drift fails tests before runtime.
- Toast authoritative bump remains out of scope unless a separate retry/audit design is approved.

Why third: KDS is high-visibility during service, and protocol drift is more dangerous than missing features.

## Deferred platform decisions

| Decision | Status | Reason |
|----------|--------|--------|
| Postgres/MySQL migration | Deferred | SQLite remains the deterministic bundled-app source of truth until multi-venue or concurrency pressure proves otherwise |
| Microservices split | Deferred | Service decomposition would increase deployment and offline failure modes before the local contracts are mature |
| Toast authoritative KDS bump | Deferred | Requires write-path retry, reconciliation, and user-visible failure behavior |
| Shamrock/Sysco order placement | Deferred | Requires vendor agreements, approval workflow, retry queue, and audit semantics |
| Scheduled PDF/email reports | Deferred | Useful, but lower priority than source data correctness |

## Freeze-readiness checklist

Before any ERP implementation slice is marked freeze-ready:

- The affected tables, routes, files, and UI surfaces are named up front.
- The change has deterministic tests or replay checks.
- Any structured output has canonical ordering and explicit invariants.
- No absolute local paths are introduced.
- No `__pycache__`, generated DB cache, or one-off local artifact is staged.
- Runtime behavior does not depend on cloud AI or hidden network state.
- Food-safety and financial records fail closed on ambiguity.

## Proposed first work ticket

**Title:** Stabilize receiving-to-inventory master contract.

**Scope:** receiving flow, vendor item alias handling, exception queue, audit records, and focused tests.

**Out of scope:** database-platform migration, microservices, vendor order placement, Toast authoritative KDS bump, and runtime cloud AI.

**Definition of done:** a manager can check in a delivery, unresolved matches are visible, inventory updates are audit-backed, and the management rollup can trust the resulting on-hand state.
