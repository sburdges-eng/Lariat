---
title: "Phase C2 + C3 — what exists now, and the not-yet-done flip steps"
date: 2026-07-03
status: build-phase complete (pre-flip); flip steps gated on the C4 window
parent: docs/superpowers/specs/2026-07-02-lariat-native-phase-c-schema-inversion.md
---

# Phase C2 (SchemaMigrator) + C3 (actor_source taxonomy) — activation guide

This documents the **build-phase** deliverables that landed and the **flip
steps** that must NOT run until the Phase C preconditions hold (Phase A exit,
Phase B landed, one green shut-off test, a restore-tested backup — see the
parent spec). Nothing here changes who owns the schema yet.

## What exists now (build phase)

### C2 — native `SchemaMigrator` (byte-parity, not yet authoritative)
- `LariatNative/Sources/LariatDB/SchemaMigrator.swift` builds a fresh DB whose
  normalized `sqlite_master` is **identical** to one built by the web's
  `lib/db.ts initSchema()`. Proven by `SchemaMigratorTests`
  (`testFreshSchemaMatchesWebBaseline`, seed parity, idempotency, and a no-op
  replay against a real web-built DB).
- **Approach — replay the frozen canonical schema, not the statement history.**
  `scripts/dump-fresh-schema.mjs --executable` captures every `sqlite_master`
  object as a re-entrant `CREATE … IF NOT EXISTS` plus `INSERT OR IGNORE` seed
  rows into `Sources/LariatDB/Resources/frozen_schema.sql`, which the migrator
  replays as one migration. This is byte-parity **by construction** and
  re-entrant (safe against an already-migrated DB). It deliberately avoids
  hand-porting `initSchema()`'s ~70 order- and guard-sensitive
  `migrateLegacyColumns` `ALTER`s — those are upgrade-only paths that add net-
  new columns on the web's own history; on a frozen schema they carry
  transcription risk for zero schema benefit.
- **Version handshake (read/stamp only):** `SchemaMigrator.currentVersion`
  reads `PRAGMA user_version`; `migrate` stamps `expectedVersion`
  (= migration count). The web's own marker (`schema_migrations`,
  `SCHEMA_VERSION = 3`) is replayed and readable via
  `webSchemaMigrationsVersion`. No refusal/enforcement logic exists yet.
- `assertCriticalSchemas` is ported (fails loud on partial-deploy column drift).

### C3 — canonical `actor_source` taxonomy
- `LariatNative/Sources/LariatModel/ActorSource.swift` — the 19-value canonical
  union (17 web surfaces + `native_cook`/`native_mac`), each with provenance.
- The C4 reconcile checker (`scripts/phase-c-reconcile.mjs`) mirrors this exact
  set; `ActorSourceTests` + the reconcile tests pin them in lockstep.
- Historical rows are **never rewritten** — the enum governs new writes only.

## NOT yet done — the flip steps (do only after the C4 window is green)

1. **Freeze the web migration list.** Add a CI guard in the web repo that fails
   if the `lib/db.ts` migration array (or `SCHEMA_VERSION`) grows. From the flip
   forward, only native runs DDL (single-DDL-writer rule). Until then the web is
   still the schema owner and this migrator must not run against `data/lariat.db`.
2. **Web-edge `schema_version` refusal handshake.** Teach the edge server to
   read `PRAGMA user_version` / `schema_migrations` on boot and fail closed with
   a clear error if the DB is newer than it knows. Native stamps the version;
   the edge refuses forward-incompatible schemas.
3. **Point native writes at native ownership.** `LariatWriteDatabase` currently
   refuses to create/migrate (read-only default). Enabling `SchemaMigrator` on
   open is the actual inversion — do it wave-by-wave per the parent spec's C5
   cutover order, each wave reconciled clean for ≥2 days first.
4. **Post-freeze refinement (optional).** If granular authored migrations are
   wanted (the spec's "migration history" shape), split `frozen_schema.sql` into
   per-domain migrations. No behavior change; purely for readability of the
   owned history. The frozen replay is correct as-is.

## Regenerating the frozen schema

If a legitimate web schema change lands *before* the freeze, regenerate both the
resource and the test baselines from the same web commit:

```
node scripts/dump-fresh-schema.mjs --executable > LariatNative/Sources/LariatDB/Resources/frozen_schema.sql
node scripts/dump-fresh-schema.mjs            > LariatNative/Tests/LariatDBTests/Fixtures/web_schema_baseline.sql
node scripts/dump-fresh-schema.mjs --seeds    > LariatNative/Tests/LariatDBTests/Fixtures/web_seed_baseline.txt
node scripts/dump-fresh-schema.mjs --full     > LariatNative/Tests/LariatDBTests/Fixtures/web_full_dump.sql
```

`SchemaMigratorTests` fails if you regenerate one but not the others — that is
the guard against a partial refresh.

## Known minor (recorded, not blocking)
- Seed `INSERT`s in `frozen_schema.sql` carry the concrete `created_at`
  timestamp captured at generation time (rather than `datetime('now')`). It is
  inert — the seed-parity test excludes timestamp columns, and in production the
  real seed rows already exist in `data/lariat.db`. Only a truly fresh
  native-built DB would show the frozen timestamp on its default location row.
