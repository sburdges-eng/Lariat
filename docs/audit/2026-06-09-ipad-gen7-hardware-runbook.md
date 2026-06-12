# iPad Gen 7 hardware runbook for roadmap row 2.21

> **ACCEPTANCE RULE CHANGED (2026-06-12): the operator waived the physical
> device run for v2 cutover entry.** Closure evidence is the WebKit
> software run in `docs/audit/2026-06-12-ipad-profile-software-v2.json`
> (`--no-hardware --route-prefix /v2`); the chromium 4× stress preflight
> and its 86-add residual risk are recorded in the Stage-0 evidence note.
> This runbook remains valid if a device run is ever wanted — drop
> `--no-hardware` and follow the steps below unchanged.

Purpose: finish the only roadmap row explicitly marked as the next implementation step after the merged freeze work.

Source of truth:
- `docs/PROJECT_ROADMAP.md` row 2.21
- `docs/audit/2026-06-07-ipad-performance-profile.md`
- `scripts/profile-ipad-cook-surfaces.mjs`

## What closes row 2.21

Row 2.21 can close only when a real low-power iPad gen 7 run proves all cook-tier flows stay at or under 100 ms p95 tap-to-feedback.

Required proof:
1. Device is an iPad gen 7.
2. Low Power Mode is on.
3. Target is Safari or the installed Lariat PWA on the same LAN as the host.
4. The report includes at least 5 samples for each flow.
5. Every flow reports `p95Ms <= 100`.
6. The JSON report is saved into repo evidence and referenced from the audit doc / roadmap.

## Preflight on the Lariat host

Run from the repo root:

```bash
git status --short --branch
npm run test:ipad-profile
npm run profile:ipad -- --help
```

Expected:
- working tree is known/intentional
- helper tests pass
- profiler CLI prints options without error

## Host startup

Start the app in the same environment that serves the cook-tier routes:

```bash
npm run dev
```

If production-like local verification is preferred before the hardware pass:

```bash
npm run build
npm run start
```

Record the base URL the iPad can reach over LAN, for example:

```text
http://192.168.1.25:3000
```

## iPad preparation

On the iPad gen 7:
1. Join the same LAN as the host.
2. Enable Low Power Mode.
3. Disable background downloads / obvious competing activity.
4. Use Safari, unless the installed PWA is the exact ship target being tested.
5. Verify the three target surfaces load manually:
   - `/stations/grill_saute?location=perf-ipad`
   - `/kds/punch?location=perf-ipad`
   - `/eighty-six?location=perf-ipad`

## Hardware run command

Use the profiler against the LAN-visible host:

```bash
npm run profile:ipad -- \
  --base-url http://LAN_HOST:3000 \
  --browser=webkit \
  --device='iPad (gen 7)' \
  --iterations=5 \
  --threshold-ms=100 \
  --out output/playwright/ipad-gen7-hardware.json
```

Notes:
- Keep `--out` relative.
- Do not swap to Chromium for the closing run unless Safari/WebKit is impossible and the acceptance rule is formally changed.
- The existing Chromium + slowdown path remains a preflight only, not closure evidence.

## Required evidence capture

After the run, save all of the following in the handoff / audit trail:

- Device model and iPadOS version
- Confirmation that Low Power Mode was on
- Base URL used
- Browser used (`webkit` / Safari or PWA note)
- Output path, expected to be:
  - `output/playwright/ipad-gen7-hardware.json`
- Whether each flow passed:
  - station-pass
  - kds-send
  - eighty-six-add

## Pass / fail rule

Pass only if every flow in the JSON report satisfies:

```text
summary.count >= 5
summary.p95Ms <= 100
withinThreshold = true
```

Fail closed if any flow exceeds the threshold. If it fails, attach the JSON and note the worst offending flow and p95.

## After a passing run

1. Update `docs/audit/2026-06-07-ipad-performance-profile.md` with the real hardware evidence.
2. Update `docs/PROJECT_ROADMAP.md` row 2.21 from hardware-pending to closed.
3. Append a concise entry to `.agent-sessions/handoff.md` with:
   - device
   - base URL
   - report path
   - per-flow p95s
   - close / fail result

## If blocked

If no iPad gen 7 hardware is available, the roadmap is still blocked. The next useful action is not more simulation work; it is acquiring the device and running this exact checklist.
