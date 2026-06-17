---
name: Lariat
last_updated: 2026-06-17
---

# Lariat Strategy

## Target problem

Back-of-house at a full-service independent kitchen runs on fragmented tools—Excel workbooks, POS exports, vendor sheets, and paper—while shift-critical state (line readiness, 86s, temps, prep) must stay accurate through a live service. The crux is that nothing stays a single trusted, current source of truth: managers can't see station status without walking the line, and regulated food-safety records can't live in ad-hoc tools that drift from what cooks actually did on the floor.

## Our approach

We bet on offline-first operational truth on the kitchen LAN: one local database the shift actually runs on, fed from the workbooks managers already maintain, with write-time enforcement for regulated ops—not a cloud bolt-on, and not "Excel on an iPad" pretending to be a system of record.

## Who it's for

**Primary:** Kitchen manager running a live BOH shift at an independent full-service restaurant (The Lariat). They're hiring Lariat to run service knowing which stations are ready, what's 86'd, and that food-safety records are complete—without walking the line or reconciling spreadsheets after the fact.

**Secondary:** Line cooks on iPad (execute checks, 86s, safety logs); owner/GM on Mac for costing and analytics.

## Key metrics

- **Station sign-off coverage** — Share of required stations signed off before service start. Measured in `lariat.db` sign-offs + shift window (per shift; can regress).
- **Open flags at service** — Unresolved line-check failures plus active 86s at service start. Measured in line-check and 86 tables (weekly roll-up).
- **Food-safety log completeness** — Required same-shift HACCP entries (temps, cleaning, date marks) logged before close with no silent gaps. Measured in safety tables + rule gates (per shift; thresholds TBD).
- **86 resolution time** — Median minutes from open to resolved. Measured in 86 event timestamps (weekly).
- **Operational data freshness** — Max age of costing/vendor and Toast sales ingests vs what ordering and margin work needs. Measured via ingest metadata / freshness tiles (lagging, weekly–monthly).

## Tracks

### Shift floor

Line readiness, stations, 86s, KDS punch—cook-simple capture, manager-visible state on the LAN hub.

_Why it serves the approach:_ The live shift becomes the authoritative record instead of walk-the-line checks plus spreadsheet reconciliation.

### Food safety ledger

Regulated HACCP workflows with enforced writes and audit trail—temps, date marks, cleaning, breaks.

_Why it serves the approach:_ Write-time enforcement preserves trust through inspection without cloud dependency.

### Ops data plane

Excel / Toast / Shamrock ingest into SQLite; costing, analytics, and order-guide freshness for manager decisions.

_Why it serves the approach:_ Spreadsheets stay the human editing layer while the kitchen database stays current for margin and purchasing.

### Native clients

macOS manager read tier and iPad cook write tier on shared `lariat.db` alongside the web server.

_Why it serves the approach:_ Offline LAN clients share one operational truth without SaaS coupling.
