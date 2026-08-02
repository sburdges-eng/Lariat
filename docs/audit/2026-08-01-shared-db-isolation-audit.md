# Shared-DB isolation audit — `tests/js/**`

**Audited:** 2026-08-01, read-only, every suite under `tests/js/` (374 files).
**Fixed:** 2026-08-02 — see *Resolution*.

`data/lariat.db` was verified byte-identical across the whole audit
(7,852,032 bytes, mtime Aug 1 13:37, before and after).

**Question:** PR #600 fixed one suite that fell through to the shared on-disk
`data/lariat.db`. Which others do the same?

**Answer:** 5 of 374. Three of them are in `test:regression-core` — the lane
that went red on #599.

---

## Why this matters

`getDb()` (`lib/db.ts:4007`) falls back to `<dataDir>/lariat.db` whenever no
`setDbPathForTest()` override is active, and every open runs `initSchema(_db)`
— a migration pass. `node --test` runs the files in a lane concurrently, one
process each. So a suite that falls through is not merely reading the wrong
database: it is running DDL against a file its siblings hold cached prepared
statements on. That is the `SQLITE_SCHEMA` signature observed on #599.

## Method

Three passes, because the first two had a confound worth naming.

1. **Empty scratch dir.** Each suite run with `LARIAT_DATA_DIR` pointed at a
   private empty directory; a `lariat.db` appearing there means the suite
   reached the on-disk path. Flagged 11 files.
2. **Real-data copy.** Each flagged suite re-run against its own full copy of
   `data/`, hash-diffed before and after, to separate readers from writers.
3. **Symlink farm — the authoritative pass.** Passes 1 and 2 *injected*
   `LARIAT_DATA_DIR`, and `resolveDataDir()` prefers that env var over cwd.
   Six suites isolate by spawning their import script with its own cwd
   (`<tmp>/cwd/data/lariat.db`); the inherited env var silently overrode that,
   making correct suites look broken. Pass 3 injects nothing: cwd points at a
   farm where every top-level repo entry is symlinked through to the real repo
   **except** `data/`, which is scratch. Node realpaths ESM specifiers, so
   `../../lib/db.ts` still resolves into the real repo — only cwd differs.
   This is how CI runs it.

Call sites were then read off real stack traces by making the farm's `data/`
unwritable, so a fall-through throws `SQLITE_CANTOPEN` instead of succeeding
silently.

**Positive control:** `test-pin-helper-shared.mjs` at its pre-#600 state (still
the version in the working tree) is flagged by every pass. The detector works.

**Cleared by pass 3 — not defects:** `test-import-vendor-prices.mjs`,
`test-import-vendor-prices-beverage-warning.mjs`,
`test-import-dish-components.mjs`, `test-import-prism-deals.mjs`,
`test-coverage-gap-export.mjs`, `test-recipe-api.mjs`. All six isolate via
child cwd and are correct as written. Their fragility is real but conditional:
an inherited `LARIAT_DATA_DIR` defeats them, because `resolveDataDir()` ranks
env above cwd. Nothing sets it in CI today.

---

## Findings

| # | Suite | Lane | Mechanism | Suite goes red? |
| --- | --- | --- | --- | --- |
| 1 | `test-unconfigured-install-fails-closed.mjs` | regression-core | Never isolated; asserts install state **from the shared DB** | No — passes for the wrong reason |
| 2 | `test-pin-helper-shared.mjs` | regression-core | Describe-scoped setup torn down under sibling describes | No — **fixed by #600** |
| 3 | `test-haccp-audit-atomicity.mjs` | regression-foodsafety | Deferred `setImmediate` fires after teardown | No — error swallowed |
| 4 | `test-pin-defense-in-depth.mjs` | regression-core | Same deferred-`setImmediate` class | No — error swallowed |
| 5 | `test-coverage-weekly.mjs` | regression-infra | Importing the script under test ran the whole weekly job | Yes, if DB unreachable |

Every one of the five opens **and `initSchema()`s** the shared file: each
produced a 1,290,240-byte fully-migrated `lariat.db` in a directory that
started empty.

### 1. `test-unconfigured-install-fails-closed.mjs` — highest severity

No `setDbPathForTest` anywhere in the file. It imports `lib/pin.ts` and calls
`pinConfigured()`, which is:

```text
pinConfigured()  →  managerPinGateConfigured()      lib/pin.ts:165
                 →  hasActiveManagerPinUsers()      lib/managerPins.ts:130
                 →  getDb()                         → data/lariat.db
```

Line 170 asserts `pin.pinConfigured() === false`. That is not a property of an
unconfigured install — it is a **live read of `manager_pin_users` in the shared
database**, and it holds only while that table happens to have no active row
for the default location.

Two ways it bites:

- Any sibling in `test:regression-core` that inserts an active manager PIN user
  into the shared DB flips it to `true`. Red, intermittently, by interleaving.
- On any machine with a manager PIN actually configured, the assertion fails —
  and, worse, the two assertions around it (`pinRequiredForPic() === true`)
  stop describing the unconfigured state they claim to cover.

`managerPinGateConfigured` catches DB errors and returns `true` (fail-closed,
`lib/managerPins.ts:131-133`), which is correct for production and is why this
never surfaced as a crash. Measured with the data dir unwritable: **10 pass,
1 fail** — that one assertion is the whole on-disk dependency.

This is a security-surface test (PHI, pay data, staff records) whose premise is
currently supplied by a database it does not control.

*Fix shape:* establish an in-memory DB at file scope, so `manager_pin_users` is
empty by construction rather than by luck.

### 2. `test-pin-helper-shared.mjs` — already fixed, PR #600

The known case. `setDbPathForTest(':memory:')` sat inside the
`requirePinOrScope` describe, which also registered an `after()` resetting it
to null; the `revocation-aware identity` describe below has no DB setup and
just calls `getDb()`. Measured with the data dir unwritable: **11 pass, 7
fail** — seven tests were running on the shared DB.

The file-scope fix in #600 is correct; it merged 2026-08-02.

### 3 & 4. `test-haccp-audit-atomicity.mjs`, `test-pin-defense-in-depth.mjs` — one root cause

Both files isolate correctly: `setDbPathForTest(TMP_DB)` at file scope before
any route is imported. Both still open the shared DB, from stack traces:

```text
test-haccp-audit-atomicity:
  app/api/receiving/route.js:528  Immediate._onImmediate
    → triggerComputeEngine()      lib/computeEngine/index.ts:38
      → getDb()                   lib/db.ts:4015   SQLITE_CANTOPEN

test-pin-defense-in-depth:
  app/api/compute/status/route.js:96  Immediate._onImmediate
    → triggerComputeEngine()          lib/computeEngine/index.ts:38
      → getDb()                       lib/db.ts:4015   SQLITE_CANTOPEN
```

The routes fire the compute engine through `setImmediate`, so it runs **after**
the file's `after()` has already called `setDbPathForTest(null)`. The override
is gone; `getDb()` opens the production path and migrates it. The resulting
error is caught and logged as `Compute Engine Trigger Error`, so both suites
exit 0 and look clean while doing it.

This is not a property of these two files. Any suite exercising a route with a
deferred compute trigger inherits it — these two are simply the ones whose
teardown wins the race.

*Fix shape:* drop `setDbPathForTest(null)` from teardown. The process is about
to exit, so the reset buys nothing, and it is precisely what opens the door.
If the reset must stay, flush pending immediates before it.

### 5. `test-coverage-weekly.mjs` — worse than "no db seam"

The suite tests two pure helpers and never calls `main()`. It did not need to:
`scripts/coverage-weekly.mjs` ended in a bare `main().catch(...)` at module
scope, so `await import('../../scripts/coverage-weekly.mjs')` **ran the entire
weekly job**. Every run of `test:regression-infra`, in CI and locally:

- opened and `initSchema()`d the shared `data/lariat.db`;
- built a coverage report and wrote a dated CSV, a dated summary, and
  `latest.txt` into `data/coverage-reports/`;
- called `process.exit(1)` from inside the test runner when the DB was
  unreachable.

`REPORT_DIR` resolves from `__dirname`, not `resolveDataDir()`, so those writes
land in the real repo **regardless of `LARIAT_DATA_DIR`**. A test could not opt
out of them. This is the only finding that also writes outside the database.

*Fix:* run `main()` only when the file is invoked directly (`process.argv[1]`
matches `import.meta.url`), which is what launchd does. Importing it for its
helpers is now inert.

---

## Resolution

All five are fixed. Finding 2 shipped in #600; findings 1, 3, 4 and 5 shipped
together on `fix/test-db-isolation-sweep`.

Re-running pass 3 against the fixed tree: **0 of 375 suites** open
`<cwd>/data/lariat.db`. `test:regression-core` 517/517, `test:regression-
foodsafety` 665/665, `test:regression-infra` 532/532, and no `data/lariat.db`
is left behind.

## The workaround this removes

CI already knew. `.github/workflows/ci.yml` prefixes the python step with:

```yaml
rm -f data/lariat.db data/lariat.db-wal data/lariat.db-shm
npm run test:python
```

commented "*An earlier node:test suite can leave a stray schema-only
data/lariat.db*". Someone hit this, wrote it down, and swept it rather than
finding the suite. Two steps above, another comment asserts the regression
lanes "all use in-memory/tmp DBs (no data/lariat.db)" — untrue for five of
them until now, true as of this branch.

Both are left in place here: this branch changes only the four suites it
names. Removing the `rm -f` and replacing it with the guard below is a
follow-up.

## Recommended gate

CI checks out a tree with no `data/lariat.db`. All five findings **created**
it. So the cheapest enforceable guard is a post-lane assertion that
`data/lariat.db` does not exist — one line, catching every future instance of
all five mechanisms, including the deferred-`setImmediate` class that no static
check would find. It can go green now that finding 5 is fixed.

## Limits

- Suites were run one per process, as `node --test` does. The audit proves
  *which suites reach the shared file*; it does not reproduce the #599
  interleaving itself, which remains unreproduced across five local runs.
- Pass 3's farm changes cwd only. A suite that resolves the data dir some third
  way — neither `LARIAT_DATA_DIR` nor cwd — would not be detected. None was
  found, but the sweep cannot rule it out.
- Jest suites (`app/__tests__`, `npm run test:unit`) were not covered; this
  audit is `node --test` files only.
- The audit's own runs tripped finding 5 before it was understood: importing
  `scripts/coverage-weekly.mjs` wrote `dish-components-gap-2026-08-01.csv` into
  the real `data/coverage-reports/` and overwrote `latest.txt` with a summary
  built from an empty scratch database. That directory is gitignored, so no
  repo state changed, but `latest.txt` no longer reflects the last real run
  (`coverage-2026-06-16.txt` is the newest legitimate summary). `data/lariat.db`
  itself was verified byte-identical throughout.

## Incidental

`tests/js/test-dataset-v2-slices.mjs` fails on the current working tree (61/62)
independent of any DB isolation issue. It is not wired into `npm run verify` —
only into `test:dataset-v2`, which `verify` never calls. Out of scope here;
flagging it rather than fixing it.
