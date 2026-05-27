# Test release (`v.I.NN.NNN`) — runs offline, no vendor APIs

Lariat ships on two channels:

| Channel | Version scheme | Vendor APIs (Toast / 7shifts / Prism / datapack) |
|---------|----------------|--------------------------------------------------|
| **Test release** | `v.I.NN.NNN` (4-part, e.g. `v0.1.00.001`) | **Disabled** — no credentials required; runs fully offline |
| **Official** | `v.---.--` (semver) | Expected to be configured for production |

A **test release** is for demos, fresh dev machines, and pre-flight verification
where there's no Toast / 7shifts / Prism access. It runs entirely on the local
SQLite DB and bundled caches — the running app makes **no calls** to those vendor
APIs (those live only in the offline `npm run ingest:*` scripts).

## Run a test release

Set one env var:

```bash
LARIAT_TEST_RELEASE=1
```

With it on:
- `lib/release.ts#isTestRelease()` returns `true`; `/api/health` reports
  `channel: "test"`, `testRelease: true`.
- The Toast / 7shifts / Prism / datapack health probes report
  `disabled — test release (...)` instead of failing, so **missing vendor creds
  no longer mark the app `degraded`**. The required probes (sqlite, cache,
  pin_gate) still gate `down` / `503` exactly as before.
- Nothing at boot needs vendor creds (`middleware.js` only uses the PIN).

Unset (or `=0`) → official channel: unset vendor creds report as failing
(`degraded`), as before.

## Stamp the version

```bash
npm run version:stamp     # writes version.json (channel defaults to "test")
npm run version:print     # → v0.1.00.001
npm run version:bump      # NNN += 1 (rolls into NN at 999)
```

`LARIAT_RELEASE_CHANNEL=official npm run version:stamp` records the official
channel in `version.json`. The stamp runs automatically on every `next build`
via the `prebuild` hook (local + CI).

## Verify offline behavior

```bash
node --experimental-strip-types --test tests/js/test-health-route.mjs tests/js/test-release.mjs
```

The health suite asserts that a test release neutralizes the vendor probes and
reports the `test` channel; `test-release.mjs` covers the channel detection.
