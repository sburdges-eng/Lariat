# Temperature Logs — The Procedure

Temperature logs are HACCP-mandated and audit-critical. **If it's not logged,
it didn't happen.**

> App: `/food-safety/temp-log` • Library: `lib/tempLog.ts` • Master CSV: `food_safety/daily_temp_log_template.csv`

---

## What we log, and when

| Equipment                      | Target range       | Frequency                     |
| ------------------------------ | ------------------ | ----------------------------- |
| Walk-in cooler (main unit)     | 32–41°F            | **2×/day** — open + close     |
| Walk-in freezer (main unit)    | −10 to 0°F         | **2×/day** — open + close     |
| Grill lowboy                   | 32–41°F            | 1×/day at opening line check  |
| Salad lowboy / cold well       | 32–41°F            | 1×/day at opening line check  |
| Fry lowboy                     | 32–41°F            | 1×/day at opening line check  |
| Fry lowboy freezer             | −10 to 0°F         | 1×/day at opening line check  |
| Hot wells (green chile, queso, birria, jus, consume) | ≥ 135°F | Every 2 hrs during service |
| Incoming deliveries (cold)     | ≤ 41°F             | Every delivery                |
| Cooked-to-temp protein (poultry) | ≥ 165°F (15 sec) | Every batch                   |
| Cooling cooked food            | 135→70°F in 2 hrs, 70→41°F in 4 hrs | Every cool-down (see `/food-safety/cooling`) |

---

## How to log — iPad

1. `/food-safety/temp-log`
2. Tap the equipment row
3. Probe with a calibrated thermometer (calibration log: `/food-safety/calibrations`)
4. Enter reading → app auto-flags out-of-range
5. If flagged → see [corrective-actions.md](corrective-actions.md)

## How to log — paper fallback

[../templates/daily-temp-log.csv](../templates/daily-temp-log.csv) — print and
clip inside the walk-in. Transcribe to the iPad next time wifi is up.

Columns: date, time, recorded_by, location, equipment, temp_f, target_min_f,
target_max_f, in_range, corrective_action, notes.

---

## HACCP critical control points

Full CCP list with hazards and monitoring: [haccp-critical-control-points.md](haccp-critical-control-points.md)

Master CSV (for audit binder): `food_safety/haccp_checklist_template.csv`
→ mirrored at [../templates/haccp-checklist.csv](../templates/haccp-checklist.csv)

---

## Related app routes

- `/food-safety/temp-log` — the live logger
- `/food-safety/cooling` — cooling time/temp tracking
- `/food-safety/calibrations` — thermometer calibration
- `/food-safety/receiving` — delivery temp checks
- `/food-safety/date-marks` — 7-day date marking
- `/food-safety/sanitizer` — sanitizer concentration (ppm)
- `/food-safety/sick-worker` — Big 6 illness reporting
