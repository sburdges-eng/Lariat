# BOH Handbook — Recipe Book, SOPs, Training, Logs

**Audience:** Kitchen Manager, PIC, trainers, line cooks.
**Purpose:** One place for every back-of-house book and log The Lariat needs on paper and in Cockpit.
**Language:** Kitchen words. Short labels. See `docs/UI_COPY_RULES.md`.
**Last reviewed:** 2026-07-25.

> This handbook is the ops contract. Where Lariat already has a board or table, that is the live source. Where it does not, use the printable templates under `docs/boh/` until the surface ships.

---

## Quick map

| Book / log | Who uses it | Live in Lariat today | Paper template |
|------------|-------------|----------------------|----------------|
| Recipe Book | Line, prep, KM | `/recipes` (Recipe Hub) | `docs/boh/recipe-card.md` |
| SOP binder | All staff, PIC | Partial (`docs/SOP_*.md`) | `docs/boh/sop-index.md` |
| Training matrix | Trainer, KM | Gap — track on paper / sheet | `docs/boh/training-matrix.md` |
| Waste log | Line, prep, KM | `/inventory/waste` | `docs/boh/waste-log.md` |
| Ticket fulfillment log | Expo, KM | Partial KDS (`placed_at` / `bumped_at`) — needs window + table times | `docs/boh/ticket-fulfillment-log.md` |
| Time & agenda logbook | You (owner/KM) | Gap — personal / manager book | `docs/boh/time-agenda-logbook.md` |
| Combined order guide | Purchasing, KM | `/purchasing` (flat list) | `docs/boh/order-guide-combined.md` |
| Prep / par sheet | Prep, KM | Prep boards + BEO cascade | `docs/boh/prep-par-sheet.md` |
| Shift handoff | Closing PIC → opening PIC | Preshift notes (partial) | `docs/boh/shift-handoff.md` |
| Comp / void / courtesy | KM, FOH lead | Gap | `docs/boh/comp-void-log.md` |
| Incident / guest problem | PIC | Gap (sick-worker / pest exist separately) | `docs/boh/incident-log.md` |

---

## 1. Recipe Book

### Why it exists
Every plate on the menu must taste the same on Tuesday and Saturday. The book is the only legal recipe — not memory, not “how we used to do it.”

### What every recipe card must have

| Field | Rule |
|-------|------|
| Name + slug | Menu name cooks say out loud; stable id for costing |
| Station | Where it fires (grill, saute, fry, garde, bar, …) |
| Category | Sauce, protein, side, dessert, drink, prep, etc. |
| Yield | Batch size + unit (e.g. 3.2 qt) |
| Ingredients | Item, qty, unit — same units the order guide uses when possible |
| Sub-recipes | Named links (never bury a mother sauce as prose) |
| Procedure | Numbered steps. One action per step. |
| Allergens | Direct allergens called out; escalate guest allergies to manager |
| Menu items | Which plates pull this recipe |
| Notes | Hold time, critical control, plating cue — short |

### House rules
1. **Scale from the card**, not from guesswork. Use Recipe Hub scaler or a written multiplier.
2. **No silent changes.** KM edits the card; cooks do not “fix it on the fly.”
3. **Photos optional, plating notes required** when the dish has a set build.
4. **Allergen tags are kitchen tags**, not legal labels. Guest allergies go to a manager.
5. **Sub-recipes win.** If queso embeds salsa, change salsa in one place.

### Live surface
- Browse / scale: `/recipes`
- Source workbooks: `XL/Lariat_Unified_Workbook.xlsx` (Recipe Book) + optional `XL/Lariat Recipe Book.pdf`
- Cache: `data/cache/recipes.json`

### Card template
See `docs/boh/recipe-card.md`.

---

## 2. SOPs (Standard Operating Procedures)

### Why they exist
SOPs are the “how we do it here” for jobs that are not a single recipe — cleanup, receiving, open/close, body-fluid response, reviews.

### Binder structure (recommended tabs)

1. **Open / Close** — station setup, side work, shutoff
2. **Food safety** — temps, cooling, receiving, date marks, sanitizer, sick worker, body-fluid cleanup
3. **Line** — fire order, expo language, 86 rules, ticket bump
4. **Prep** — batch cadence, labeling, hold times
5. **Purchasing / receiving** — who orders, who checks in, rejection rules
6. **People** — training sign-off, performance reviews, breaks
7. **Events (BEO)** — pull, fire times, leftover handling
8. **Emergency** — power loss, walk-in failure, fire, guest injury

### SOP writing rules
- One page when possible; two pages max for regulated cleanup.
- Start with **who owns it** and **when it runs**.
- Numbered steps. No SaaS words.
- Cite the Food Code / CO rule when regulated.
- End with **what to log** and **who to call**.

### Already written in-repo
| SOP | Path |
|-----|------|
| Body-fluid cleanup | `docs/SOP_VOMIT_DIARRHEA_CLEANUP.md` |
| Staff performance reviews | `docs/SOP_STAFF_PERFORMANCE_REVIEWS.md` |

### Still needed (priority)
| SOP | Why |
|-----|-----|
| Open / close by station | Stops “tribal knowledge” open |
| Receiving rejection | Protects food safety + invoice disputes |
| 86 and 86-clear | Same language line ↔ expo ↔ FOH |
| Ticket fire → window → table | Matches the fulfillment log below |
| Waste logging | When to toss vs. rework; reason codes |
| Allergen guest call | Manager-only path; no guessing from tags |
| Walk-in / freezer fail | Time-temp decision tree |
| Knife / cut / burn first aid | Fast, posted |

Index template: `docs/boh/sop-index.md`.

---

## 3. Training

### Goal
A new cook can run their station safely without shadowing every shift for a month. Training is **signed**, not “I watched once.”

### Levels
| Level | Meaning | Gate |
|-------|---------|------|
| T0 Shadow | Watch only | Safety tour + body-fluid kit location |
| T1 Assist | Hands on with trainer | Recipe cards for that station; waste + date-mark basics |
| T2 Solo | Runs station under PIC eye | Line check sign-off + ticket times OK for 3 shifts |
| T3 Trainer | Can sign others off | KM approval |

### Training matrix (stations × people)
Track one row per person:

- Station (grill, saute, fry, garde, expo, dish, bar support)
- Recipes signed (list or count / total for that station)
- SOPs signed (open/close, receiving, 86, allergen call, body-fluid)
- Food-safety certs (ServSafe / local) + expiry
- Last dual-control shift date
- Trainer initials + date

Template: `docs/boh/training-matrix.md`.

### Session cadence
- **Day 1:** Tour, allergens, kit location, handwashing, sick-worker rule.
- **Days 2–5:** Station recipes + line check + waste log practice.
- **Week 2:** Solo under PIC; ticket times reviewed.
- **30-day:** KM review (see performance-review SOP).

### What “signed” means
Initials + date on the matrix **and** a verbal check: trainer asks the cook to run the card cold (no peeking at steps until stuck).

---

## 4. Waste log

### Why
Waste is money and a signal. Separate from 86: 86 means “cannot sell”; waste means “threw out / burned / dropped / spoiled.”

### Live surface
`/inventory/waste` → writes `inventory_updates` with `direction = 'waste'`.

### Fields (every entry)
| Field | Example |
|-------|---------|
| When | Shift date + time |
| Station | saute |
| Item | cilantro |
| Qty + unit | 1 bunch |
| Why (reason code) | Spoilage / Drop / Burn / Overcook / Overprep / Training / Comp-plate / Other |
| Cook | Who logged it |
| Notes | Optional short note |

### Reason codes (use these words)
- **Spoilage** — past date or bad on open
- **Drop** — floor / contamination
- **Burn** — pan or fryer
- **Overcook** — unusable plate or batch
- **Overprep** — made too much, cannot hold
- **Training** — practice product
- **Comp-plate** — remake / courtesy (also log comps separately if $ tracked)
- **Other** — note required

### Cadence
- Log **as it happens**, not at close.
- KM reviews **weekly**: top items, $ if costed, pattern by station.
- Training waste is normal for new hires — do not hide it.

Template: `docs/boh/waste-log.md`.

---

## 5. Ticket fulfillment log

### Why
Ticket times tell you if the line is healthy. You asked for four truths per ticket:

1. **Time Fired** — when the ticket hits the line (fire / place)
2. **Time to window** — when expo has it ready (pass / bump to window)
3. **Time to table** — when it leaves expo to the guest
4. **Notes** — hold, remake, allergy, VIP, long ticket

### How this maps to Lariat today
| Moment | Today | Gap |
|--------|-------|-----|
| Time Fired | `kds_tickets.placed_at` | Named “fired” in UI copy |
| Time to window | `bumped_at` / `kds_ticket_states.bumped_at` (closest: leave-line / bump) | Need explicit **window_ready_at** if bump ≠ window |
| Time to table | — | **Not stored** — add `table_delivered_at` (or paper log) |
| Notes | Destination / modifiers only | Free-text ticket notes |

Until the schema grows, run the paper log at expo for service audits (Fri/Sat + one weekday), or sample 10 tickets per rush.

### Target times (house defaults — tune per concept)
| Service | Fire → window | Window → table | Fire → table |
|---------|---------------|----------------|--------------|
| Lunch rush | ≤ 12 min | ≤ 3 min | ≤ 15 min |
| Dinner normal | ≤ 14 min | ≤ 3 min | ≤ 17 min |
| Dinner rush | ≤ 16 min | ≤ 4 min | ≤ 20 min |
| Apps / bar snacks | ≤ 8 min | ≤ 2 min | ≤ 10 min |

### Log columns
Date | Ticket # | Table / dest | Fired | Window | Table | Mins F→W | Mins W→T | Mins F→T | Station(s) | Notes

### Rules
- Clock times in local kitchen clock; 24h or am/pm — pick one and stick to it.
- Remakes: new row, note “REMAKE of #123”.
- Allergen tickets: note **ALLERGY** and manager who checked.
- Never invent a table time — leave blank if unknown.

Template: `docs/boh/ticket-fulfillment-log.md`.

---

## 6. Time & agenda logbook (yours)

### Why
Owner / KM days get eaten by fires. A personal logbook keeps **time spent** and **agenda** honest so purchasing, training, and costing do not vanish.

### What to capture each day
| Block | Content |
|-------|---------|
| Date / service | e.g. 2026-07-25 · Dinner |
| Agenda (AM) | Top 3 must-dos before doors |
| Agenda (PM) | Top 3 before close |
| Time blocks | What you actually did, with start–end |
| Decisions | Price change, 86 standing, schedule call |
| Follow-ups | Who / what / by when |
| People | Coaching notes (private) |
| Numbers glance | Covers, voids, waste $ if known |

### Cadence
- **Morning:** write agenda before email.
- **During service:** only park blockers (one line).
- **Close:** fill time blocks + follow-ups (10 minutes).
- **Weekly:** review follow-ups; move unfinished to next week.

### Privacy
This book can hold HR-tinged notes. Keep it **manager-only**. Do not store PINs, full socials, or medical detail here — point to regulated surfaces (sick-worker, reviews).

Template: `docs/boh/time-agenda-logbook.md`.

---

## 7. Categorized combined order guide

### Why
A flat vendor dump is hard to shop and hard to prep against. You want **one guide** that can be read two ways:

1. **By vendor** — for the order call / portal
2. **By category / station** — for walk-in pull and prep

### Row shape
| Field | Notes |
|-------|-------|
| Category | Produce, Dairy, Protein, Dry, Frozen, Paper, Chemical, Beverage, Other |
| Station affinity | Who burns it first (prep, grill, saute, bar, …) |
| Ingredient | Kitchen name (match recipe book) |
| Pack / unit | Case, each, lb — as purchased |
| Par | Shelf + walk-in target |
| On hand | From last count |
| To order | Max(par − on hand, 0) or BEO-driven need |
| Vendor | Primary |
| Backup vendor | Optional |
| Unit price | Last known |
| Notes | Catch-weight, seasonal, 86-prone |

### Combined view rules
1. **Kitchen name is canonical** — vendor SKU is secondary.
2. **BEO / event demand adds to `to_order`**, never silently replaces par.
3. **Placeholder prices** stay marked — do not trust them for costing.
4. Print **vendor sort** for the order; print **category sort** for the pull.

### Live surface
- Flat guide: `/purchasing` (`order_guide_items`)
- Event demand: BEO cascade order-guide tab
- Enrichment: `lib/orderGuideEnrichment.ts`

Paper / sheet template: `docs/boh/order-guide-combined.md`.

---

## 8. What else you likely need

These close the holes most kitchens discover after the basics:

| Book / log | Purpose | Priority |
|------------|---------|----------|
| **Prep / par sheet** | Daily batch targets by station | High |
| **Shift handoff** | 86s, low stock, VIP, broken gear, people notes | High |
| **Comp / void / courtesy** | Money + reason (separate from waste) | High |
| **Incident / guest problem** | Injury, complaint, pest sighting follow-up | High |
| **Station setup cards** | What “ready” looks like before first ticket | Medium |
| **Side work / closing duties** | Named tasks, not “clean the line” | Medium |
| **Label / date-mark cheat sheet** | 7-day rule examples in house language | Medium |
| **Allergen matrix (menu × allergen)** | Fast FOH/expo lookup; still escalate | Medium |
| **Key / alarm / cash** | Who opened what (FOH-leaning, still house ops) | Medium |
| **Equipment down log** | What broke, temp workaround, parts ordered | Medium — equipment board exists; keep a simple down list |
| **BEO run sheet** | Fire times, headcount, dietary, leftover plan | High when events run |
| **Walk-in map** | Where product lives; speeds counts + FIFO | Low/Medium |

Templates included for prep/par, handoff, comp/void, and incident under `docs/boh/`.

---

## 9. Daily / weekly rhythm

### Every service
1. Open checklists + line checks signed.
2. Preshift note posted (86s, VIPs, 86 watch list).
3. Waste logged as it happens.
4. Tickets timed (full log or sample during rush).
5. Shift handoff filled at close.

### Every order day
1. Count against categorized order guide.
2. Merge BEO demand.
3. Place orders by vendor sort.
4. Receiving log on delivery.

### Every week
1. Waste top-10 review.
2. Ticket-time averages vs targets.
3. Training matrix: who is stuck at T1.
4. Your agenda logbook: clear follow-ups.
5. SOP binder: fix one unclear step you heard on the line.

### Every month
1. Recipe card audit (5 dishes — taste + card match).
2. Cert expiry sweep.
3. Par levels vs actual usage.
4. Body-fluid kit attestation (cleaning schedule).

---

## 10. Lariat build gaps (for product, not cooks)

Planning notes only — no schema change is authorized by this handbook alone.

| Gap | Suggested direction |
|-----|---------------------|
| Ticket **window** vs **table** times | Add `window_ready_at` + `table_delivered_at` (or expo confirm) on KDS; keep `placed_at` as fired |
| Ticket notes | Free-text on `kds_tickets` |
| Training matrix | New board + table; PIN not required for read; KM write |
| Manager agenda logbook | Optional private notes store, manager-PIN, not in cook context |
| Order guide categories | Persist category + station_affinity; dual sort in `/purchasing` |
| Comp / void log | Append-only; reason codes; $ optional from Toast later |
| SOP binder in-app | Index of `docs/SOP_*.md` + house PDFs; read-only for cooks |

---

## 11. Related docs

- `docs/UI_COPY_RULES.md` — words on screens
- `docs/ARCHITECTURE.md` — tables and boards
- `docs/OPERATIONS.md` — ingest cadence
- `docs/HEALTH_SAFETY_LABOR_AUDIT.md` — regulated gaps
- `docs/SOP_VOMIT_DIARRHEA_CLEANUP.md`
- `docs/SOP_STAFF_PERFORMANCE_REVIEWS.md`
- Printable templates: `docs/boh/`
