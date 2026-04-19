# iPad / kitchen smoke checklist

Run on the LAN URL (printed when the server starts). Pick a cook in the sidebar first.

1. **Today** — Station cards load; colors reflect line check progress where applicable.
2. **Stations** — Open a station with a line checklist; toggle pass / fail / n/a; optional par/have; **86** prompts for reason and writes to 86 board.
3. **Sign off** — Sign off requires cook selected; timestamp updates on Today.
4. **Recipes** — Search and open a recipe; scaler changes quantities.
5. **86 Board** — Add an 86; resolve from KM flow; banner on Today when active.
6. **Inventory** — Log an adjustment; recent row appears on Today.
7. **Export** — From the Mac, `npm run export` produces files in `exports/`.
8. **Export v2** — `npm run export:v2` writes `lariat_v2_snapshot_*.xlsx` + CSVs (after ingesting v2 data).

v2 read-only pages (after ingest):

9. **Analytics** — Non-empty tables if `npm run ingest:analytics` has been run.
10. **Costing / Order guide** — Data if `npm run ingest:costing` has been run.
11. **Menu engineering** — Rows appear when both sales and costing data exist with name overlap.
12. **BEO** — Create event, add prep task, toggle checkbox, delete event.
