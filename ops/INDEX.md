# Lariat — Operational Runbook

Source of truth for day-to-day kitchen operations at the Lariat. Every item here
has a live counterpart in the Cockpit app — paper is the fallback, the iPad is
the daily driver.

Last generated: 2026-04-22 • Stations in scope: **Grill/Saute**, **Salad (Garde)**, **Fry**, **Expo**

---

## The 30-second tour

| I need to...                               | Go to                                                                    | Live in app                                             |
| ------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| Open a station                             | [opening/](opening/)                                                     | `/stations/[id]` → Setup tab                            |
| Run a line check                           | [line-checks/](line-checks/)                                             | `/stations/[id]` → Line Check                           |
| Check what gets prepped today              | [prep/](prep/)                                                           | `/stations/[id]` → Prep, `/analytics` → Prep Forecast   |
| Close a station                            | [closing/](closing/)                                                     | `/stations/[id]` → Closing                              |
| Log a walk-in / lowboy temp                | [temps/](temps/)                                                         | `/food-safety/temp-log`                                 |
| Record a corrective action                 | [temps/corrective-actions.md](temps/corrective-actions.md)               | `/food-safety/temp-log` → Flag                          |
| Run daily / weekly / monthly cleaning      | [cleaning/](cleaning/)                                                   | `/admin/cleaning-schedule`                              |
| See where a cooler lives or what's on what shelf | [cooler-diagrams/](cooler-diagrams/)                               | `/equipment`, `/concept-layout`                         |

---

## Directory map

```
ops/
├── INDEX.md                          ← you are here
├── opening/
│   ├── grill.md
│   ├── salad.md
│   ├── fry.md
│   └── whole-kitchen.md              ← master sequence (all stations)
├── line-checks/
│   ├── README.md                     ← how to run a line check
│   ├── grill-saute.md
│   ├── salad-garde.md
│   ├── fry.md
│   └── expo.md
├── prep/
│   ├── README.md                     ← prep philosophy + par/have/need
│   ├── daily-prep-list.md            ← full prep universe by category
│   ├── weekly-prep-wednesday.md
│   └── weekly-prep-thursday.md
├── closing/
│   ├── grill.md
│   ├── salad.md
│   ├── fry.md
│   ├── expo.md
│   └── whole-kitchen.md              ← house-close sequence
├── cleaning/
│   ├── daily.md                      ← embedded in closing, called out here
│   ├── weekly.md                     ← Wed–Sun rolling deep-clean
│   └── monthly-maintenance.md
├── temps/
│   ├── README.md                     ← procedure + frequencies
│   ├── haccp-critical-control-points.md
│   ├── corrective-actions.md
│   └── ../templates/daily-temp-log.csv   (print template)
├── cooler-diagrams/
│   ├── README.md                     ← how to read these
│   ├── kitchen-floor-plan.svg        ← overhead — stations + refrigeration
│   ├── walk-in-cooler.svg            ← shelf-by-shelf, food-safety order
│   ├── walk-in-freezer.svg
│   ├── fryer-lowboy-top.svg          ← top-station layout
│   ├── fryer-freezer.svg             ← from FRYRER_FREEZER DIAGRAM
│   ├── grill-lowboy.svg
│   └── salad-lowboy.svg              ← from SALAD SET UP diagram
├── templates/
│   ├── daily-temp-log.csv
│   ├── line-check-blank.csv
│   ├── haccp-checklist.csv
│   └── corrective-actions.csv
└── launchd/                          ← existing macOS scheduled jobs (don't touch)
```

---

## How this directory relates to the rest of the repo

| Ops doc                       | Paper/live source                                              | App route                          | Library                    |
| ----------------------------- | -------------------------------------------------------------- | ---------------------------------- | -------------------------- |
| Line checks                   | `data/imports/drive-kitchen-ops-20260421/*Line Check*.xlsx`    | `/stations/[id]`                   | `app/stations/[id]/StationChecklist.tsx` |
| Prep lists                    | `data/imports/drive-kitchen-ops-20260421/Prep list.docx`       | `/stations/[id]` → Prep            | `scripts/add_prep_sheet.py`              |
| Weekly prep                   | `.../WEEKLY PREP.xlsx`, `Weekly Prep.docx`                     | `/analytics` → Prep Forecast       | `data/cache/weekly_prep.json`            |
| Opening / setup               | `.../Setups.docx`, `GRILL SET-UP.xlsx`, `SALAD SET-UP.xlsx`    | `/stations/[id]` → Setup           | —                                        |
| Closing                       | `.../Closing procedures.docx`, `CLOSING GRILL.xlsx`, `CLOSING SALAD.xlsx` | `/stations/[id]` → Closing | `data/cache/closings.json`               |
| Cleaning — weekly / monthly   | `.../Weekly Cleaning.docx`, `.../Monthly Cleaning_Maintenance.docx` | `/admin/cleaning-schedule`    | `lib/cleaning.ts`                        |
| Temp logs                     | `food_safety/daily_temp_log_template.csv`                      | `/food-safety/temp-log`            | `lib/tempLog.ts`                         |
| HACCP CCPs                    | `food_safety/haccp_checklist_template.csv`                     | `/food-safety`                     | —                                        |
| Corrective actions            | `food_safety/corrective_actions.csv`                           | `/food-safety/temp-log` → Flag     | —                                        |
| Cooler / station layouts      | `.../FRYRER_FREEZER DIAGRAM.xlsx`, `SALAD SET UP.xlsx`, `FRYER_LOWBOY TOP STATION.xlsx` | `/concept-layout`, `/equipment` | — |

---

## The rules of engagement

1. **The iPad is the source of truth mid-shift.** Paper is for when wifi is down
   or for training. If it's signed off in the app, it's done.
2. **Every line-check item has a 1-tap 86 button.** Use it. See
   [line-checks/README.md](line-checks/README.md).
3. **Temp logs happen twice — open and close.** Two readings per cooler, per day,
   minimum. See [temps/README.md](temps/README.md).
4. **Corrective actions are not optional paperwork.** If a temp reads above 41°F
   on a cooler or below 135°F on a hotwell, [file one](temps/corrective-actions.md).
5. **A station isn't closed until the closing checklist is signed off.**
   "Flip station → refill → shut off equipment → sanitize → clock out." In that
   order. See [closing/whole-kitchen.md](closing/whole-kitchen.md).

---

## Change log

| Date       | Change                                                             |
| ---------- | ------------------------------------------------------------------ |
| 2026-04-22 | Initial consolidation. All runbooks sourced from drive-kitchen-ops-20260421 imports + data/cache + food_safety templates. |
