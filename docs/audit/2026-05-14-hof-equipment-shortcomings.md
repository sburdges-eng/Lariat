# HOF equipment catalog — shortcomings + recommended re-photographs + online lookups

**Generated** 2026-05-14 from a vision pass over the 71 HEIC photos in
`/Users/seanburdges/Desktop/Equipment photos/`. Source data lives in
`data/inventory/hof-equipment.csv`,
`data/inventory/hof-equipment-maintenance.csv`,
`docs/floor-plans/hof-dining-room.md`, and
`docs/floor-plans/hof-kitchen-line.md`.

This doc lists what **couldn't** be extracted, why, and what to do
about it.

---

## A. Photos with no extractable equipment metadata

These shots are useful for layout/condition but carry no labels:

| photo | reason |
|---|---|
| IMG_4882 | overview only (kitchen line, no labels) |
| IMG_4883 | overview only (plumbing/fryer area) |
| IMG_4884 | Atosa logo only — no data plate captured |
| IMG_4885 | hand-drawn floor plan (parsed → `docs/floor-plans/hof-dining-room.md`) |
| IMG_4889 / IMG_4890 / IMG_4891 | Hatco heat lamps — no model plate captured |
| IMG_4892 | Hamilton Beach microwave — display obscures the model line |
| IMG_4893 / IMG_4897 / IMG_4919 / IMG_4926 / IMG_4933 / IMG_4934 | kitchen overviews, no labels |
| IMG_4901 | immersion blender plate not legible |
| IMG_4905 | exhaust fan housing — no plate visible |
| IMG_4920 / IMG_4921 / IMG_4924 | hood interior / vapor-light shots, no labels |
| IMG_4922 / IMG_4923 / IMG_4925 / IMG_4949 / IMG_4950 | charbroiler interior maintenance shots — Vulcan inferred from cookline, no plate |
| IMG_4927 / IMG_4928 / IMG_4943 | Beverage-Air and Avantco logo decals only |
| IMG_4929 | refrigerator interior (food only) |
| IMG_4930 / IMG_4931 / IMG_4932 | cooler service access mid-clean — brand inferred |
| IMG_4941 | fryer data plate too oily / illegible |
| IMG_4944 | Dukers reach-in data plate partial (barcode + "MODEL D28...") |
| IMG_4947 / IMG_4948 | prep-table brand badge not in frame; only Gold Medal service vendor sticker |

---

## B. High-priority re-photograph list

For each, capture a clean square-on shot of the data plate
(usually inside a door, on a kickplate, behind a removable panel,
or on the back) and re-import:

1. **Vulcan 6-burner range w/ charbroiler** (IMG_4917) — plate likely behind the kickplate or on the rear apron.
2. **Vulcan single-tank fryer** (IMG_4936) — plate often inside the front door above the tank.
3. **Atosa LG400-1 fryer** (IMG_4941) — clean the oily plate inside the cabinet and re-shoot.
4. **Beverage-Air worktop refrigerator** (IMG_4928) — plate inside the lid or on the back.
5. **Beverage-Air reach-in** (IMG_4927) — same.
6. **Avantco under-counter cooler** (IMG_4943) — plate inside the door or behind the kickplate.
7. **Dukers reach-in** (IMG_4944) — plate is partially visible; reshoot at 90° angle.
8. **True (?) prep table** (IMG_4947, 4948) — confirm brand + capture plate inside lid.
9. **Walk-in cooler** (IMG_4904) — plate often on the evaporator-coil housing inside the box.
10. **Hatco Glo-Ray heat lamps** (IMG_4895) — model number is on the back of the unit; needs a ladder shot.
11. **Hamilton Beach commercial microwave** (IMG_4892) — plate on the back or bottom.
12. **KitchenAid Commercial stand mixer** (IMG_4903) — plate on the back or under the tilt-head.
13. **Vitamix commercial blender** (IMG_4906) — plate on the bottom of the motor base.
14. **State UltraForce water heater** (IMG_4887) — rating plate is separate from the service-call placard; usually upper-front face or near the gas valve.
15. **Atosa ice machine head** (IMG_4884) — plate inside the front grille or on the back.
16. **Commercial immersion blender** (IMG_4901) — plate near the on/off switch or motor base.

For each, the inventory CSV row already exists (with brand-only and `make_model` partial) — the operator just needs to re-import after capturing the missing fields.

---

## C. Online lookup candidates

Where the brand + partial model is known, these manufacturer / vendor
pages should fill in spec gaps:

| equipment | suggested URL |
|---|---|
| AYOSA YR450-AP-161 | https://www.atosausa.com (search YR450-AP-161; Atosa owns AYOSA in some regions) |
| Auto-Chlor AF/AC/AH-3D series | https://autochlorsystem.com/dishmachines + 719-299-0347 (leased — they hold the serial + lease record) |
| VacMaster VP210 | https://www.vacmasterfresh.com/vacuum-sealers/chamber-machines/vp210 |
| Hatco Glo-Ray family | https://www.hatcocorp.com/en/equipment/food-finishing-and-holding/heat-lamps |
| Hamilton Beach commercial microwave | https://commercial.hamiltonbeach.com (likely HMC520) |
| Carnival King WBM26DGT | https://www.webstaurantstore.com/carnival-king-wbm26dgt |
| Galaxy Equipment cooker/warmer | https://www.webstaurantstore.com (Galaxy SW1 / 177FCW100 likely) |
| My Weigh KD-8000 | https://myweigh.com/products/kd-8000 |
| San Jamar Escali | https://www.sanjamar.com (SCDGP series) |
| Robot Coupe R2 | https://www.robotcoupeusa.com/products/r-2 |
| KitchenAid Commercial | https://www.kitchenaidcommercial.com (KSM8990 / KSMC895) |
| Vitamix Commercial | https://www.vitamix.com/us/en_us/shop/commercial |
| Accurex XFCC | https://www.accurex.com — serial 14901292 already captured |
| Zone Defense Model 375 | https://www.amerex-fire.com (Amerex parent) — verify last UL-300 cert |
| Square D QOC32UF | https://www.se.com (Schneider Electric load center) |
| Vulcan range | https://www.vulcanequipment.com — Hobart service 1-888-4-HOBART |
| Atosa LG400-1 | https://www.atosausa.com — serial DV1160003 already captured |
| Beverage-Air | https://www.beverage-air.com — need model |
| Avantco | https://www.avantcoequipment.com — need model |
| Dukers | https://dukersusa.com — service 1-800-931-8628 |
| State Ultra-Force | https://www.statewaterheaters.com — 1-800-365-0024 |

---

## D. Bar surface — not yet photographed

The dining-room map (`docs/floor-plans/hof-dining-room.md`) shows a
**BAR** in the middle of the room, but the photo set carries no bar-
equipment shots: no kegs, no glycol chiller, no beer tower, no glass
coolers, no bar dishwasher (if separate from the kitchen Auto-Chlor).

**Recommended:** schedule a separate photo pass of:
1. Under-bar coolers (data plates inside the lid).
2. Glycol unit (typically in BOH near the walk-in).
3. Beer-line / tower hardware.
4. Bar dishwasher or hand-sink config.
5. Bar overhead overview shot so layout can be drawn into a sister
   floor-plan doc.

---

## E. Things blocked on human/API authorization

These can't be resolved from the photos alone:

| item | blocker | tactic |
|---|---|---|
| Auto-Chlor serial + lease docs | data lives at Auto-Chlor, not on the machine | call 719-299-0347 with the placard model (AF-/AC-/AH-3D series) and the property tag; they pull from their CRM |
| Hood-cleaning service history beyond 2024 | TECH Hood Cleaning has the maintenance file | call 251-458-5594 to request the full service log + ask for documentation export |
| Hobart-service history on Vulcan fryers | Hobart parts/service holds the case file | call 1-888-4-HOBART with the visible decal, serial DV1160003 (Atosa) — Hobart can pull both lines |
| Fire suppression cert dates | local UL-300 certifying contractor holds the record (the placard is on the cylinder we haven't photographed) | photograph the cylinder cert tag, then either re-import or call the local certifier |
| Receipts / purchase dates / purchase costs | not in the photo set; would live in operator accounting or vendor portal | export from accounting or pull from vendor invoice (Webstaurant, KaTom, etc.) |

---

## F. What was successfully extracted (summary)

- **31 unique equipment units** captured into `data/inventory/hof-equipment.csv`.
- **8 maintenance entries** seeded in `data/inventory/hof-equipment-maintenance.csv` (3 needs-service flags; 5 scheduled / recurring entries).
- **Dining-room + bar floor plan** transcribed into `docs/floor-plans/hof-dining-room.md` from the operator's hand-drawn map.
- **Kitchen-line floor plan** drawn from overview photos into `docs/floor-plans/hof-kitchen-line.md`.
- **2 confirmed full serial numbers** (AYOSA ice maker, Atosa LG400-1 fryer).
- **5 maintenance/service vendor contacts** captured (Auto-Chlor, TECH Hood Cleaning, Hobart, Gold Medal, Dukers).
- **All 71 photos** have at least a 1-line catalog entry in the catalog the vision pass returned (preserved in commit history if you want the raw source).

---

## G. Recommended next steps (operator-facing)

1. **Now** — review `data/inventory/hof-equipment.csv` and edit any inferred fields (brand-only entries, "needs_service" flags) against your own knowledge of the line.
2. **Soon** — do the high-priority re-photograph pass (Section B, ~16 units, ~30 min walking the kitchen).
3. **Soon** — schedule a separate bar photo pass (Section D).
4. **When convenient** — call Auto-Chlor / TECH / Hobart to backfill service histories.
5. **Optional** — wire a `scripts/import-hof-equipment.mjs` that reads the CSVs and INSERTs into the `equipment` + `equipment_maintenance` tables. Today the CSVs are the source of truth; import scripts can land in a follow-up if the operator wants the inventory in SQLite.

End of doc.
