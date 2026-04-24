# Prep — The Method

We prep in two loops:

### The daily loop (today)
Every morning, the KM (or opening cook) looks at:
1. Last night's close-of-shift line check (what was low)
2. Today's BEO load (`/beo`)
3. Forecast from Toast + weather (`/analytics` → Prep Forecast)

…and builds a **daily prep list** from [daily-prep-list.md](daily-prep-list.md).

### The weekly loop (Wednesday + Thursday)
Big-batch items that cover the whole week run on a fixed Wed/Thu schedule:

- [Wednesday →](weekly-prep-wednesday.md)
- [Thursday →](weekly-prep-thursday.md)

---

## Par / Have / Need discipline

Every prep item is tracked like a line-check row — `par`, `have`, `need`.
When `need > 0`, it goes on the board. When it's done, mark it off on the iPad
(`/stations/[id]` → Prep) or on paper.

## The one-bite rule

If a prep task takes less than one bite of time (≤ 60 sec) and you're passing
through — do it. The station sheet is for tasks that need uninterrupted focus.

## When BEOs change the math

BEOs add prep on top of the standing lists. Pull BEO prep tasks from `/beo` —
they surface in each station's Prep tab with a purple "BEO" chip.

## Reference

- Prep list source: `data/imports/drive-kitchen-ops-20260421/Prep list.docx`
- Weekly prep source: `WEEKLY PREP.xlsx`, `Weekly Prep.docx`
- Cached structured form: `data/cache/weekly_prep.json`
- Script that pushes a new prep sheet into SQLite: `scripts/add_prep_sheet.py`
- Coverage notes: `docs/T2C_PREP_COVERAGE.md`
