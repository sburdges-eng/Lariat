# iPad Performance Profile Harness - 2026-06-07

## Scope

Affected subsystem: cook-tier iPad surfaces and local Playwright profiling.

Freeze-readiness impact: positive, but incomplete. This adds a repeatable profiling harness for row 2.21; it does not replace the required low-power iPad gen 7 hardware run.

Determinism impact: positive. The profiler emits schema-versioned JSON with stable ordering, relative output paths, fixed default target settings, and explicit pass/fail threshold evaluation.

Security impact: neutral. The harness runs locally against an operator-started Lariat app, stores only synthetic location/cook identifiers, and introduces no runtime cloud dependency.

Runtime coupling introduced: no.

## Harness

Command:

```bash
npm run profile:ipad -- --base-url http://localhost:3000 --browser=webkit --out output/playwright/ipad-profile.json
```

Chromium fallback when local WebKit is unavailable:

```bash
npm run profile:ipad -- --base-url http://localhost:3000 --browser=chromium --cpu-slowdown=4 --out output/playwright/ipad-profile.json
```

The default target is:

- Browser: `webkit`
- Device profile: `iPad (gen 7)`
- Iterations per flow: `5`
- Threshold: `100ms` p95 tap-to-feedback
- Hardware acceptance: required

The profiler covers three cook-tier interactions:

- `/stations/grill_saute`: tap a station `Pass` control and wait for pressed feedback.
- `/kds/punch`: submit a KDS punch ticket and wait for sent feedback.
- `/eighty-six`: add an 86 item and wait for the item to appear.

## Acceptance Criteria

Row 2.21 can close only after a real hardware run proves all of the following:

- Device is an iPad gen 7 in low-power mode.
- Browser target is Safari or installed PWA on the same LAN as the Lariat host.
- The JSON report includes at least five samples for each harness flow.
- Every flow has `p95Ms <= 100`.
- The JSON report is attached or copied into the release/audit evidence.

Until that hardware evidence exists, this harness is a preflight and regression tool, not proof that the fleet target meets the line-use latency bar.

## Invariants

- Output JSON starts with `schemaVersion`.
- No absolute local filesystem paths are serialized.
- `--out` must be a relative path that stays within the current working directory.
- The harness fails closed when any profiled flow exceeds the configured p95 threshold.
- The hardware acceptance flag remains false for local simulator/device-profile runs.
