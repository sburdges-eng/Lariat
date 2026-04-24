# Line Checks — How We Run Them

A line check is a single pass across every item on a station, answering three
questions for each: **Par / Have / Need**.

- **Par** — how much we want on the line at service start (fixed per item)
- **Have** — what's actually on the line right now
- **Need** — what's missing (par − have)

If `need > 0`, that's prep that has to happen **before** you sign off.

---

## When

Every station runs a line check **twice a day**:

1. **T-30 before opening** — the actual operating line check. Block 3:30 PM for
   a 4:00 open, 10:30 AM for an 11:00 brunch open.
2. **At close** — final check for tomorrow's AM crew. Flags what the morning
   cook is walking into.

BEO/private events may require an additional mid-day check — see `/beo`.

## How (on the iPad)

1. Cook opens `/stations/[id]` on the iPad
2. Picks their name from the sidebar
3. Walks the line, tapping through each row:
   - **Par** is pre-filled (edit if menu just changed)
   - Count what's there → type into **Have**
   - App computes **Need** automatically
4. For anything we're out of and can't prep in time → **tap 86** on the row.
   Pick reason + estimated qty. The red banner appears on `/today` and on
   FOH screens.
5. Sign off: **"Sign off this station"** at the bottom.

Sign-off time and signer are persisted to the line_check table.

## How (on paper, when wifi is down)

1. Print the blank template: [../templates/line-check-blank.csv](../templates/line-check-blank.csv)
2. Walk the line, write par / have / need, initial + time at bottom
3. Leave on clipboard at station
4. When wifi returns, transcribe into the iPad

## The four station line checks

- [Grill / Saute →](grill-saute.md)
- [Salad / Garde →](salad-garde.md)
- [Fry →](fry.md)
- [Expo →](expo.md)

Brunch line check pulls a different set — see `data/cache/line_checks.json`
→ `brunch` key, and `/stations/expo?shift=brunch` in the app.

## The 86 discipline

An 86 is not a shrug. It's a commitment that:
- The item is unavailable right now
- We know the reason (out of prep / vendor short / equipment down)
- We have an ETA or "rest of shift"
- FOH has been alerted (banner on `/today` + POS-side via Toast when wired)

A KM (or senior cook) resolves the 86 when restocked. See `/eighty-six`.
