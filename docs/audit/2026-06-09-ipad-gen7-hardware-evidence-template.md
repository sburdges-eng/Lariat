# iPad Gen 7 hardware evidence template for roadmap row 2.21

Use this after running:

```bash
npm run profile:ipad -- \
  --base-url http://LAN_HOST:3000 \
  --browser=webkit \
  --device='iPad (gen 7)' \
  --iterations=5 \
  --threshold-ms=100 \
  --out output/playwright/ipad-gen7-hardware.json
```

Then validate the JSON with:

```bash
node scripts/verify-ipad-hardware-report.mjs output/playwright/ipad-gen7-hardware.json
```

## Hardware facts

- Date:
- Device model: iPad gen 7
- iPadOS version:
- Low Power Mode: on / off
- Browser target: Safari / PWA
- Host base URL:
- Report path: `output/playwright/ipad-gen7-hardware.json`

## Per-flow results

- station-pass:
  - samples:
  - p95Ms:
  - withinThreshold:
- kds-send:
  - samples:
  - p95Ms:
  - withinThreshold:
- eighty-six-add:
  - samples:
  - p95Ms:
  - withinThreshold:

## Validator result

Paste output from:

```bash
node scripts/verify-ipad-hardware-report.mjs output/playwright/ipad-gen7-hardware.json
```

## Closure decision

- Row 2.21 status: PASS / FAIL
- If FAIL, worst flow and p95:
- If PASS, update:
  - `docs/audit/2026-06-07-ipad-performance-profile.md`
  - `docs/PROJECT_ROADMAP.md`
  - `.agent-sessions/handoff.md`
