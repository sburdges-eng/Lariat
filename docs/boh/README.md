# BOH printable templates

Kitchen-facing sheets that go with [`docs/BOH_HANDBOOK.md`](../BOH_HANDBOOK.md).

Print, photocopy, or copy into a sheet. Prefer the live Lariat board when one exists.
Sheets marked **filled** carry real Lariat data (stations, items, batches, vendors, cadence) from the source workbooks — blanks in them are for pencil.

| Template | Use |
|----------|-----|
| `day-plan-dinner.md` | **Filled** — Wed–Sat delegation, doors at 4 |
| `day-plan-sunday.md` | **Filled** — Sunday brunch, service 11–5 |
| `deep-clean-rotation.md` | **Filled** — weekly rotation + monthly list + scoring |
| `station-sops.md` | **Filled** — setup / line check / close per station |
| `manager-eod-log.md` | **Filled** — end-of-day sign-off, one page per week |
| `recipe-book-index.md` | **Filled** — 46 recipe cards on file, in-book + signed boxes |
| `prep-par-sheet.md` | **Filled** — real prep items, batch yields, shelf lives |
| `sysco-count-sheet.md` | **Filled** — the live Sysco guide as a count sheet by zone, with proposed pars |
| `order-guide-combined.md` | **Filled** — cross-vendor view (Sysco vs Shamrock) for price comparison |
| `purveyor-call-planner.md` | **Filled** — order/delivery days, contacts, weekly rhythm, call log |
| `training-matrix.md` | **Filled** — real stations, skill ladder, Week-1 track |
| `time-agenda-logbook.md` | Owner/KM daily agenda + manager routine + time blocks |
| `recipe-card.md` | Standard recipe card fields |
| `sop-index.md` | SOP binder table of contents + sign-off |
| `waste-log.md` | Daily waste sheet |
| `ticket-fulfillment-log.md` | Fire / window / table times |
| `shift-handoff.md` | Close → open handoff |
| `comp-void-log.md` | Comps, voids, courtesy plates |
| `incident-log.md` | Guest / injury / ops incidents |

Print-ready packet (one page per sheet, big type): `print/lariat-ops-packet.html` — open in a browser and print.

## On a phone

The same 12 sheets are in the app at **`/boh`** (Line book) — tap to tick, type counts in, and
**Copy sheet** to paste a filled sheet into the handoff board. Entries are saved on that phone
for that service date only; they are a working sheet, not a record. Temps and food-safety logs
still go in Food safety.

Four sheets sit behind the manager PIN because they carry vendor pricing or a sign-off: the
Sysco count sheet, purveyor planner, manager weekly routine, and EOD log. The other eight stay
open so a cook can pull up their own station SOP mid-shift.

The app reads its sheets from `print/lariat-ops-packet.html` via
`node scripts/build-boh-sheets.mjs` → `lib/boh/sheets.generated.ts`. **Edit the packet, then
re-run that script** — do not hand-edit the generated file. `npm run test:boh` proves the two
still match.
