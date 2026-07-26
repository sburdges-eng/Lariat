// GENERATED FILE — do not edit by hand.
//
// Source:     docs/boh/print/lariat-ops-packet.html
// Generator:  scripts/build-boh-sheets.mjs
// Regenerate: node scripts/build-boh-sheets.mjs
//
// tests/js/test-boh-sheets.mjs asserts this file still matches the packet.

import type { BohSheet } from './types.ts';

export const BOH_SHEETS: BohSheet[] = [
  {
    "slug": "dinner-day-plan",
    "title": "Dinner Day Plan — Wed–Sat",
    "blurb": "Wed–Sat. Doors at 4.",
    "tier": "cook",
    "blocks": [
      {
        "kind": "fields",
        "parts": [
          {
            "kind": "field",
            "id": "dinner-day-plan.b0.f0",
            "label": "Date"
          },
          {
            "kind": "static",
            "text": "Day W / Th / F / Sa"
          },
          {
            "kind": "static",
            "text": "**Doors 4:00 · Service 4:00–9:30**"
          },
          {
            "kind": "field",
            "id": "dinner-day-plan.b0.f1",
            "label": "A–Grille/Sauté"
          },
          {
            "kind": "field",
            "id": "dinner-day-plan.b0.f2",
            "label": "B–Fry/Garde"
          },
          {
            "kind": "field",
            "id": "dinner-day-plan.b0.f3",
            "label": "C–Dish+Swing"
          },
          {
            "kind": "field",
            "id": "dinner-day-plan.b0.f4",
            "label": "Mgr (Expo)"
          }
        ]
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "3:00 — In"
      },
      {
        "kind": "tasks",
        "ordered": false,
        "rows": [
          {
            "id": "dinner-day-plan.b2.r0",
            "who": "All",
            "task": "Clock in · sani buckets + towels · read handoff board"
          },
          {
            "id": "dinner-day-plan.b2.r1",
            "who": "A",
            "task": "Ovens, grill, salamander ON · unwrap drawers / lowboy proteins"
          },
          {
            "id": "dinner-day-plan.b2.r2",
            "who": "B",
            "task": "Fryers ON — left two @350, right @305 · unwrap fry + garde lowboys"
          },
          {
            "id": "dinner-day-plan.b2.r3",
            "who": "C",
            "task": "Pull today's prep sheet — start Prep Needed column, biggest batch first"
          }
        ]
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "3:00–3:40 — Setup"
      },
      {
        "kind": "tasks",
        "ordered": false,
        "rows": [
          {
            "id": "dinner-day-plan.b4.r0",
            "who": "A",
            "task": "Heat sauces: green chili ½+⅙ · queso ½+⅙ · chicken jus 1/9 · birria ⅓ · consommé ⅓"
          },
          {
            "id": "dinner-day-plan.b4.r1",
            "who": "A",
            "task": "Bacon jam chafe · S&P 1/9 · clarified butter + 2 qt backup · oil + wine · temper honey + herb butter"
          },
          {
            "id": "dinner-day-plan.b4.r2",
            "who": "A",
            "task": "Breads + tortillas · protein backups (min ⅔ burgers, ⅓ jefe, ⅓ bacon · 6 ord chicken/cod · 5 ord trout/pork chop on ice) · blanch + shock asparagus"
          },
          {
            "id": "dinner-day-plan.b4.r3",
            "who": "B",
            "task": "Fry sauces (buffalo · thai chili · bama · nashville oil · BBQ) · B&B pickles + 1 qt slaw · seasonings · freezer: 1 case each fries / sweets / wings / tenders / roots"
          },
          {
            "id": "dinner-day-plan.b4.r4",
            "who": "B",
            "task": "½ pan chicken flour · 4 qt beer flour + 4 qt guinness-vodka — **wet added right before service, never early**"
          },
          {
            "id": "dinner-day-plan.b4.r5",
            "who": "B",
            "task": "Garde: lowboy stocked · sauces refilled · ceramics + bullets · heat lamps ON"
          },
          {
            "id": "dinner-day-plan.b4.r6",
            "who": "C",
            "task": "Prep list done → label, date, initial"
          },
          {
            "id": "dinner-day-plan.b4.r7",
            "who": "C",
            "task": "Expo w/ Mgr: steam table · deli cups (3 qt blackened salsa · 2 qt tomatillo · 1 qt limes · 1 qt furikake · 2 qt mexi-relish) · chips + baskets · spoon bucket"
          },
          {
            "id": "dinner-day-plan.b4.r8",
            "who": "Mgr",
            "task": "Toast counts entered · 86 board current"
          }
        ]
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "3:45 — Line check gate + pre-shift"
      },
      {
        "kind": "callout",
        "text": "A fills **Grille/Sauté** · B fills **Fry** + **Garde** — Par / Have / **NEED = make or pull it NOW**. Manager: walk line · taste one item (rotate sauce/dressing/protein) · one cold temp ≤40°F · **sign each sheet.** Pre-shift huddle: 86s · counts · events · tonight's tasks. **Service does not start on an unsigned line check.**"
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "4:00 — Doors · Service 4:00–9:30"
      },
      {
        "kind": "note",
        "text": "C to dish pit at 5:00: break down prep boxes · prep dishes · silverware + bullets · fresh liner. Manager on expo: quality gate every plate · call + pace tickets · 86 board + Toast current."
      },
      {
        "kind": "note",
        "text": "**Lull (7–8):** Each — deep-clean task of the day (rotation sheet, initial) ☐ · A/B — restock + flip · sauce bottles · wipe + sweep · trash ☐ · Mgr — glance, reassign out loud if slammed ☐"
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "8:30–9:30 — Close"
      },
      {
        "kind": "tasks",
        "ordered": false,
        "rows": [
          {
            "id": "dinner-day-plan.b11.r0",
            "who": "A",
            "task": "Equipment off · clean grill · proteins → walk-in · sanitize · season flattop · hood drip pans · deck-brush · clean range · GFI"
          },
          {
            "id": "dinner-day-plan.b11.r1",
            "who": "B",
            "task": "Wrap line · fryers off + **filter oil** · boards to dish (bleach every other day) · sanitize · sweep · GFI"
          },
          {
            "id": "dinner-day-plan.b11.r2",
            "who": "C",
            "task": "Pans / baskets · silverware for rolling · sinks + drains · bleach boards · drain + power off machine · sweep + trash · dump expo hot well · deck-brush + squeegee line"
          },
          {
            "id": "dinner-day-plan.b11.r3",
            "who": "Mgr",
            "task": "Steamwells + lamps off · wrap / ice-bath contents · ceramics restock · tomorrow's Toast counts + 86 risks"
          }
        ]
      },
      {
        "kind": "fields",
        "parts": [
          {
            "kind": "static",
            "text": "**9:30–10:00 — Post-shift + sign-off:** closing line check (tomorrow's thaw / brine / order add-ons)"
          },
          {
            "kind": "static",
            "text": "Mgr walk — 2 random items per close list + deep-clean task"
          },
          {
            "kind": "static",
            "text": "fill the **EOD manager log**"
          },
          {
            "kind": "field",
            "id": "dinner-day-plan.b12.f0",
            "label": "clock out by 10. Mgr sign"
          }
        ]
      }
    ]
  },
  {
    "slug": "sunday-day-plan",
    "title": "Sunday Day Plan — brunch",
    "blurb": "Brunch. Doors at 11.",
    "tier": "cook",
    "blocks": [
      {
        "kind": "fields",
        "parts": [
          {
            "kind": "field",
            "id": "sunday-day-plan.b0.f0",
            "label": "Date"
          },
          {
            "kind": "static",
            "text": "**Doors 11:00 · Service 11:00–5:00**"
          },
          {
            "kind": "static",
            "text": "staff 9–5"
          },
          {
            "kind": "static",
            "text": "manager 9:30–6"
          },
          {
            "kind": "field",
            "id": "sunday-day-plan.b0.f1",
            "label": "A–Line"
          },
          {
            "kind": "field",
            "id": "sunday-day-plan.b0.f2",
            "label": "B–Fry/Garde+Eggs"
          },
          {
            "kind": "field",
            "id": "sunday-day-plan.b0.f3",
            "label": "C–Dish+Swing"
          },
          {
            "kind": "field",
            "id": "sunday-day-plan.b0.f4",
            "label": "Mgr"
          }
        ]
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "9:00 — In · setup to 10:30"
      },
      {
        "kind": "tasks",
        "ordered": false,
        "rows": [
          {
            "id": "sunday-day-plan.b2.r0",
            "who": "All",
            "task": "Clock in · sani buckets · handoff board"
          },
          {
            "id": "sunday-day-plan.b2.r1",
            "who": "A",
            "task": "Equipment + **waffle iron** ON · grill mise · french toast + waffle mixes · warm queso, quesa birria + consommé, green chili · cold line: yuzu kosho, mashed avocado, cali pepper oil, dulce de leche"
          },
          {
            "id": "sunday-day-plan.b2.r2",
            "who": "B",
            "task": "Fryers ON · egg station · bacon for bar & expo + tostadas · brunch stock: green chile, shredded cheese, scrambled + whole eggs, pico, home fries, sourdough, fruit, lg flour tortillas, pre-fried corn tortillas, syrup, chives, chicken breasts, chipotle aioli, aji verde, special sauce"
          },
          {
            "id": "sunday-day-plan.b2.r3",
            "who": "C",
            "task": "Pit ready · Saturday dishes · expo w/ Mgr (no mexi-relish Sunday)"
          },
          {
            "id": "sunday-day-plan.b2.r4",
            "who": "Mgr",
            "task": "**9:30–10:30 — build + place the order** (Sunday order → Monday drop) · check BEO calendar — event = batch UP, never raid line backups"
          }
        ]
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "10:30 — Line check gate + pre-shift"
      },
      {
        "kind": "callout",
        "text": "Fill the brunch line-check list · **1 test waffle + 1 test poached egg** · Mgr tastes, one cold temp, **signs** — unsigned = doors don't open. Pre-shift: 86s · counts · events · tasks. 10:45 breakfast potatoes to the grill."
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "11:00 — Doors · Service 11:00–5:00"
      },
      {
        "kind": "note",
        "text": "C to pit at first push · Mgr on expo · 86 board + Toast live."
      },
      {
        "kind": "note",
        "text": "**2:00–2:30 (brunch winds down):** family meal from surplus eggs / potatoes / french toast / waffles ☐ · waffle iron + egg station washed · line flipped for dinner menu ☐"
      },
      {
        "kind": "heading",
        "level": 3,
        "text": "Afternoon lull — Sunday deep clean (initial each)"
      },
      {
        "kind": "tasks",
        "ordered": false,
        "rows": [
          {
            "id": "sunday-day-plan.b9.r0",
            "who": "A",
            "task": "Charbroiler — grates scrubbed + re-seasoned · radiants reseated · grease-can cavity"
          },
          {
            "id": "sunday-day-plan.b9.r1",
            "who": "B",
            "task": "Hood filters through dish machine + hood interior wipe — **run before machine drains**"
          },
          {
            "id": "sunday-day-plan.b9.r2",
            "who": "C",
            "task": "Mats hosed + hung · walk-in floor swept + spot-mopped"
          },
          {
            "id": "sunday-day-plan.b9.r3",
            "who": "Mgr",
            "task": "Walls behind expo & steam table · ceramics restock audit"
          }
        ]
      },
      {
        "kind": "note",
        "text": "**4:30–5:00 — staff wrap + out:** stations restocked + wrapped · pit caught up · handoff note for Wednesday (86s, low stock, thaw/brine starts) · staff out by 5."
      },
      {
        "kind": "fields",
        "parts": [
          {
            "kind": "static",
            "text": "**5:00–6:00 — Manager post-shift + sign-off:** close walk"
          },
          {
            "kind": "static",
            "text": "steamwells/lamps off"
          },
          {
            "kind": "static",
            "text": "Wednesday Toast counts + 86 risks"
          },
          {
            "kind": "static",
            "text": "fill the **EOD manager log**"
          },
          {
            "kind": "static",
            "text": "tally week's score for Wednesday posting. Mgr sign"
          },
          {
            "kind": "field",
            "id": "sunday-day-plan.b11.f0",
            "label": "Note"
          }
        ]
      }
    ]
  },
  {
    "slug": "deep-clean",
    "title": "Deep-Clean & Maintenance Rotation",
    "blurb": "Who cleans what, by day.",
    "tier": "cook",
    "blocks": [
      {
        "kind": "fields",
        "parts": [
          {
            "kind": "field",
            "id": "deep-clean.b0.f0",
            "label": "Week of"
          },
          {
            "kind": "field",
            "id": "deep-clean.b0.f1",
            "label": "A–Grille/Sauté"
          },
          {
            "kind": "field",
            "id": "deep-clean.b0.f2",
            "label": "B–Fry/Garde"
          },
          {
            "kind": "field",
            "id": "deep-clean.b0.f3",
            "label": "C–Dish"
          },
          {
            "kind": "static",
            "text": "Mgr takes the Expo column"
          }
        ]
      },
      {
        "kind": "grid",
        "columns": [
          "Day",
          "A · Grille/Sauté",
          "B · Fry/Garde",
          "Mgr · Expo",
          "C · Dish"
        ],
        "rows": [
          {
            "id": "deep-clean.b1.r0",
            "cells": [
              {
                "kind": "text",
                "text": "WED"
              },
              {
                "kind": "check",
                "id": "deep-clean.b1.r0.c1",
                "text": "Left oven deep clean — racks to pit, interior scraped, door + glass (no scouring powder)"
              },
              {
                "kind": "check",
                "id": "deep-clean.b1.r0.c2",
                "text": "Boil out both fryers"
              },
              {
                "kind": "check",
                "id": "deep-clean.b1.r0.c3",
                "text": "Steam table drained, delimed, wiped · heat lamps degreased (cool first)"
              },
              {
                "kind": "check",
                "id": "deep-clean.b1.r0.c4",
                "text": "Dish machine deep clean — delime, curtains soaked, spray arms cleared"
              }
            ]
          },
          {
            "id": "deep-clean.b1.r1",
            "cells": [
              {
                "kind": "text",
                "text": "THU"
              },
              {
                "kind": "check",
                "id": "deep-clean.b1.r1.c1",
                "text": "Right oven deep clean + range drip pans emptied & washed"
              },
              {
                "kind": "check",
                "id": "deep-clean.b1.r1.c2",
                "text": "Wipe behind & between fryers"
              },
              {
                "kind": "check",
                "id": "deep-clean.b1.r1.c3",
                "text": "Pass shelving + ticket/POS area deep wipe & sanitize"
              },
              {
                "kind": "check",
                "id": "deep-clean.b1.r1.c4",
                "text": "Dish pit walls + shelving above sinks scrubbed"
              }
            ]
          },
          {
            "id": "deep-clean.b1.r2",
            "cells": [
              {
                "kind": "text",
                "text": "FRI"
              },
              {
                "kind": "check",
                "id": "deep-clean.b1.r2.c1",
                "text": "Walls + shelf behind hot line — degrease top-down"
              },
              {
                "kind": "check",
                "id": "deep-clean.b1.r2.c2",
                "text": "Garde lowboy — gaskets, shelves, FIFO re-organize"
              },
              {
                "kind": "check",
                "id": "deep-clean.b1.r2.c3",
                "text": "Walk-in: one shelf section + door gasket & handle"
              },
              {
                "kind": "check",
                "id": "deep-clean.b1.r2.c4",
                "text": "ALL floor drains — covers scrubbed, bleach flush"
              }
            ]
          },
          {
            "id": "deep-clean.b1.r3",
            "cells": [
              {
                "kind": "text",
                "text": "SAT"
              },
              {
                "kind": "check",
                "id": "deep-clean.b1.r3.c1",
                "text": "Salamander — crumb tray, rack, exterior · degrease knobs & handles"
              },
              {
                "kind": "check",
                "id": "deep-clean.b1.r3.c2",
                "text": "Walls behind fry station · freezer organize & rotate"
              },
              {
                "kind": "check",
                "id": "deep-clean.b1.r3.c3",
                "text": "Dry storage: one shelf + date/label audit (flag shorts on prep sheet)"
              },
              {
                "kind": "check",
                "id": "deep-clean.b1.r3.c4",
                "text": "Sinks & faucets delimed · sprayer soaked · under-sink wipe"
              }
            ]
          },
          {
            "id": "deep-clean.b1.r4",
            "cells": [
              {
                "kind": "text",
                "text": "SUN"
              },
              {
                "kind": "check",
                "id": "deep-clean.b1.r4.c1",
                "text": "Charbroiler — grates scrubbed & re-seasoned, radiants reseated, grease cavity"
              },
              {
                "kind": "check",
                "id": "deep-clean.b1.r4.c2",
                "text": "Hood filters thru machine + hood wipe (before machine drains)"
              },
              {
                "kind": "check",
                "id": "deep-clean.b1.r4.c3",
                "text": "Walls behind expo & steam table · ceramics audit"
              },
              {
                "kind": "check",
                "id": "deep-clean.b1.r4.c4",
                "text": "Mats hosed & hung · walk-in floor swept + spot-mopped"
              }
            ]
          }
        ]
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "Monthly — manager assigns one per week"
      },
      {
        "kind": "grid",
        "columns": [
          "Wk",
          "Task",
          "Who",
          "Done"
        ],
        "rows": [
          {
            "id": "deep-clean.b3.r0",
            "cells": [
              {
                "kind": "text",
                "text": "1"
              },
              {
                "kind": "text",
                "text": "Walk-in fan guards & condenser dusted · check door seals"
              },
              {
                "kind": "entry",
                "id": "deep-clean.b3.r0.c2"
              },
              {
                "kind": "check",
                "id": "deep-clean.b3.r0.c3",
                "text": ""
              }
            ]
          },
          {
            "id": "deep-clean.b3.r1",
            "cells": [
              {
                "kind": "text",
                "text": "2"
              },
              {
                "kind": "text",
                "text": "Vents above the line wiped"
              },
              {
                "kind": "entry",
                "id": "deep-clean.b3.r1.c2"
              },
              {
                "kind": "check",
                "id": "deep-clean.b3.r1.c3",
                "text": ""
              }
            ]
          },
          {
            "id": "deep-clean.b3.r2",
            "cells": [
              {
                "kind": "text",
                "text": "3"
              },
              {
                "kind": "text",
                "text": "Pull rolling equipment forward — clean underneath & behind the line"
              },
              {
                "kind": "entry",
                "id": "deep-clean.b3.r2.c2"
              },
              {
                "kind": "check",
                "id": "deep-clean.b3.r2.c3",
                "text": ""
              }
            ]
          },
          {
            "id": "deep-clean.b3.r3",
            "cells": [
              {
                "kind": "text",
                "text": "4"
              },
              {
                "kind": "text",
                "text": "Lowboy / reach-in tops, coils, legs & casters"
              },
              {
                "kind": "entry",
                "id": "deep-clean.b3.r3.c2"
              },
              {
                "kind": "check",
                "id": "deep-clean.b3.r3.c3",
                "text": ""
              }
            ]
          }
        ]
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "Score (posted Wednesday)"
      },
      {
        "kind": "callout",
        "text": "3 pts / station / shift: checklist complete · deep clean done (or formally reassigned) · spot-check passed. Weekly = earned ÷ possible."
      },
      {
        "kind": "grid",
        "columns": [
          "",
          "Wed",
          "Thu",
          "Fri",
          "Sat",
          "Sun",
          "Week %"
        ],
        "rows": [
          {
            "id": "deep-clean.b6.r0",
            "cells": [
              {
                "kind": "text",
                "text": "A"
              },
              {
                "kind": "entry",
                "id": "deep-clean.b6.r0.c1",
                "hint": "/3"
              },
              {
                "kind": "entry",
                "id": "deep-clean.b6.r0.c2",
                "hint": "/3"
              },
              {
                "kind": "entry",
                "id": "deep-clean.b6.r0.c3",
                "hint": "/3"
              },
              {
                "kind": "entry",
                "id": "deep-clean.b6.r0.c4",
                "hint": "/3"
              },
              {
                "kind": "entry",
                "id": "deep-clean.b6.r0.c5",
                "hint": "/3"
              },
              {
                "kind": "entry",
                "id": "deep-clean.b6.r0.c6"
              }
            ]
          },
          {
            "id": "deep-clean.b6.r1",
            "cells": [
              {
                "kind": "text",
                "text": "B"
              },
              {
                "kind": "entry",
                "id": "deep-clean.b6.r1.c1",
                "hint": "/3"
              },
              {
                "kind": "entry",
                "id": "deep-clean.b6.r1.c2",
                "hint": "/3"
              },
              {
                "kind": "entry",
                "id": "deep-clean.b6.r1.c3",
                "hint": "/3"
              },
              {
                "kind": "entry",
                "id": "deep-clean.b6.r1.c4",
                "hint": "/3"
              },
              {
                "kind": "entry",
                "id": "deep-clean.b6.r1.c5",
                "hint": "/3"
              },
              {
                "kind": "entry",
                "id": "deep-clean.b6.r1.c6"
              }
            ]
          },
          {
            "id": "deep-clean.b6.r2",
            "cells": [
              {
                "kind": "text",
                "text": "C"
              },
              {
                "kind": "entry",
                "id": "deep-clean.b6.r2.c1",
                "hint": "/3"
              },
              {
                "kind": "entry",
                "id": "deep-clean.b6.r2.c2",
                "hint": "/3"
              },
              {
                "kind": "entry",
                "id": "deep-clean.b6.r2.c3",
                "hint": "/3"
              },
              {
                "kind": "entry",
                "id": "deep-clean.b6.r2.c4",
                "hint": "/3"
              },
              {
                "kind": "entry",
                "id": "deep-clean.b6.r2.c5",
                "hint": "/3"
              },
              {
                "kind": "entry",
                "id": "deep-clean.b6.r2.c6"
              }
            ]
          }
        ]
      },
      {
        "kind": "fields",
        "parts": [
          {
            "kind": "field",
            "id": "deep-clean.b7.f0",
            "label": "Station of the Week"
          },
          {
            "kind": "static",
            "text": "— first pick of weekend station assignments"
          }
        ]
      }
    ]
  },
  {
    "slug": "prep-par",
    "title": "Prep / par sheet — daily",
    "blurb": "What to make today, and how much.",
    "tier": "cook",
    "blocks": [
      {
        "kind": "fields",
        "parts": [
          {
            "kind": "field",
            "id": "prep-par.b0.f0",
            "label": "Date"
          },
          {
            "kind": "field",
            "id": "prep-par.b0.f1",
            "label": "Service"
          },
          {
            "kind": "field",
            "id": "prep-par.b0.f2",
            "label": "Prep lead"
          }
        ]
      },
      {
        "kind": "note",
        "text": "**Rules:** label + date + initials or it gets tossed · FIFO · batch recipes and stated yields only · beer batter wet-mixed at service, never early · event on the BEO calendar = **batch UP per the BEO — event prep never comes out of line backups**."
      },
      {
        "kind": "note",
        "text": "**Pars below = real weekly demand** from 13 months of Toast sales (Pars_DRAFT_2026-07 v2), shelf-life capped. **PEAK** = Fri/Sat and summer/event weeks (×1.45)."
      },
      {
        "kind": "note",
        "text": "**Make fractional batches.** Most book batches are 4–20× weekly use — a full batch of a slow sauce is a guaranteed toss. Never cook the full book batch without a BEO reason."
      },
      {
        "kind": "note",
        "text": "**Lead times:** brined chicken **24 hr** · pork chop brine **48 hr** · pig wings thaw **48 hr** · trout thaw **24 hr**."
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "Garde / cold"
      },
      {
        "kind": "count",
        "inputs": [
          {
            "key": "on-hand",
            "label": "On hand"
          },
          {
            "key": "make",
            "label": "Make"
          }
        ],
        "rows": [
          {
            "id": "prep-par.b6.r0",
            "label": "Chipotle aioli",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~2 qt"
              },
              {
                "label": "Par",
                "value": "3 qt"
              },
              {
                "label": "PEAK par",
                "value": "3 qt"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b6.r1",
            "label": "Lemon thyme vin (3-day shelf — small batches)",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~½ qt"
              },
              {
                "label": "Par",
                "value": "1 qt"
              },
              {
                "label": "PEAK par",
                "value": "1 qt"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b6.r2",
            "label": "Coleslaw dressing",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~1.6 qt"
              },
              {
                "label": "Par",
                "value": "2 qt"
              },
              {
                "label": "PEAK par",
                "value": "2.5 qt"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b6.r3",
            "label": "Mexi slaw dressing",
            "meta": [
              {
                "label": "Use/wk",
                "value": "pencil"
              },
              {
                "label": "Par",
                "value": "1 qt"
              },
              {
                "label": "PEAK par",
                "value": "1 qt"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b6.r4",
            "label": "Pico (same-day)",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~1.7 qt"
              },
              {
                "label": "Par",
                "value": "½ qt/day"
              },
              {
                "label": "PEAK par",
                "value": "1–1.5 qt Sat"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b6.r5",
            "label": "Aji verde",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~⅓ qt"
              },
              {
                "label": "Par",
                "value": "1 qt"
              },
              {
                "label": "PEAK par",
                "value": "1 qt"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b6.r6",
            "label": "Succotash (**3-day shelf** — never the 8 qt batch)",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~1.5 qt"
              },
              {
                "label": "Par",
                "value": "2 qt"
              },
              {
                "label": "PEAK par",
                "value": "2 qt"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b6.r7",
            "label": "Caesar dressing",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~1 qt"
              },
              {
                "label": "Par",
                "value": "2 qt"
              },
              {
                "label": "PEAK par",
                "value": "2 qt"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b6.r8",
            "label": "Tartar sauce",
            "meta": [
              {
                "label": "Use/wk",
                "value": "pencil"
              },
              {
                "label": "Par",
                "value": "2 qt"
              },
              {
                "label": "PEAK par",
                "value": "2 qt"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b6.r9",
            "label": "Bama white sauce",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~¼ qt"
              },
              {
                "label": "Par",
                "value": "1 qt"
              },
              {
                "label": "PEAK par",
                "value": "1 qt"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b6.r10",
            "label": "Chimichurri (menu use near zero)",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~0"
              },
              {
                "label": "Par",
                "value": "½ qt every 2 wks"
              },
              {
                "label": "PEAK par",
                "value": "—"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b6.r11",
            "label": "Tomato confit",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~⅓ pan"
              },
              {
                "label": "Par",
                "value": "⅓ pan"
              },
              {
                "label": "PEAK par",
                "value": "½ pan"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b6.r12",
            "label": "Blackened salsa",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~3.5 qt"
              },
              {
                "label": "Par",
                "value": "4 qt"
              },
              {
                "label": "PEAK par",
                "value": "5 qt"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b6.r13",
            "label": "Tomatillo salsa",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~1.7 qt"
              },
              {
                "label": "Par",
                "value": "2 qt"
              },
              {
                "label": "PEAK par",
                "value": "2.5 qt"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b6.r14",
            "label": "Croutons",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~2 qt"
              },
              {
                "label": "Par",
                "value": "2 qt"
              },
              {
                "label": "PEAK par",
                "value": "3 qt"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b6.r15",
            "label": "Hard-boiled eggs",
            "meta": [
              {
                "label": "Use/wk",
                "value": "pencil"
              },
              {
                "label": "Par",
                "value": "3 doz"
              },
              {
                "label": "PEAK par",
                "value": "3 doz"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b6.r16",
            "label": "Rope pickles",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~1.3 qt"
              },
              {
                "label": "Par",
                "value": "3 qt"
              },
              {
                "label": "PEAK par",
                "value": "3 qt"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b6.r17",
            "label": "Pickled red onion",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~1 qt"
              },
              {
                "label": "Par",
                "value": "2 qt"
              },
              {
                "label": "PEAK par",
                "value": "2 qt"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b6.r18",
            "label": "Mixed greens (wash + spin) · romaine · avocados",
            "meta": [
              {
                "label": "Use/wk",
                "value": "stock"
              },
              {
                "label": "Par",
                "value": "to line check"
              }
            ],
            "checkable": true
          }
        ]
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "Fry"
      },
      {
        "kind": "count",
        "inputs": [
          {
            "key": "on-hand",
            "label": "On hand"
          },
          {
            "key": "make",
            "label": "Make"
          }
        ],
        "rows": [
          {
            "id": "prep-par.b8.r0",
            "label": "Brined chicken — **start 24 hr ahead**",
            "meta": [
              {
                "label": "Use/wk",
                "value": "40–50 pc"
              },
              {
                "label": "Par",
                "value": "40–50 pc/wk"
              },
              {
                "label": "PEAK par",
                "value": "60–70 pc"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b8.r1",
            "label": "Chicken flour · nash rub (dry)",
            "meta": [
              {
                "label": "Use/wk",
                "value": "—"
              },
              {
                "label": "Par",
                "value": "½ pan + backup · 1 batch/mo"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b8.r2",
            "label": "Nashville oil",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~1 qt"
              },
              {
                "label": "Par",
                "value": "2 qt"
              },
              {
                "label": "PEAK par",
                "value": "2 qt"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b8.r3",
            "label": "Beer batter dry (**wet at service only**)",
            "meta": [
              {
                "label": "Use/wk",
                "value": "daily"
              },
              {
                "label": "Par",
                "value": "4 qt/day"
              },
              {
                "label": "PEAK par",
                "value": "4 qt"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b8.r4",
            "label": "Brined fish (basa)",
            "meta": [
              {
                "label": "Use/wk",
                "value": "pencil"
              },
              {
                "label": "Par",
                "value": "15–20 lb"
              },
              {
                "label": "PEAK par",
                "value": "20 lb"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b8.r5",
            "label": "Pig wings — **thaw 48 hr ahead**",
            "meta": [
              {
                "label": "Use/wk",
                "value": "pencil"
              },
              {
                "label": "Par",
                "value": "1 case thawing"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b8.r6",
            "label": "Chicken wings (thawed)",
            "meta": [
              {
                "label": "Use/wk",
                "value": "pencil"
              },
              {
                "label": "Par",
                "value": "1 case thawing"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b8.r7",
            "label": "Buffalo · BBQ (**purchased** — stock from gallon jugs)",
            "meta": [
              {
                "label": "Use/wk",
                "value": "—"
              },
              {
                "label": "Par",
                "value": "1 jug each at station"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b8.r8",
            "label": "Thai chili sauce",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~⅓ qt"
              },
              {
                "label": "Par",
                "value": "1 qt"
              },
              {
                "label": "PEAK par",
                "value": "1 qt"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b8.r9",
            "label": "Special sauce (12-qt scaled batch = 2 wks — batch **half**)",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~4.5 qt"
              },
              {
                "label": "Par",
                "value": "6 qt"
              },
              {
                "label": "PEAK par",
                "value": "6.5 qt"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b8.r10",
            "label": "Fries · sweets · wings · tenders · roots (frozen)",
            "meta": [
              {
                "label": "Use/wk",
                "value": "stock"
              },
              {
                "label": "Par",
                "value": "1 case each at station"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b8.r11",
            "label": "Churros",
            "meta": [
              {
                "label": "Use/wk",
                "value": "stock"
              },
              {
                "label": "Par",
                "value": "1 case"
              }
            ],
            "checkable": true
          }
        ]
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "Grill / proteins & butters"
      },
      {
        "kind": "count",
        "inputs": [
          {
            "key": "on-hand",
            "label": "On hand"
          },
          {
            "key": "make",
            "label": "Make"
          }
        ],
        "rows": [
          {
            "id": "prep-par.b10.r0",
            "label": "Hamburger patties",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~55 pc"
              },
              {
                "label": "Par",
                "value": "55–60 pc"
              },
              {
                "label": "PEAK par",
                "value": "80 pc"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b10.r1",
            "label": "Green chili",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~5–6 qt"
              },
              {
                "label": "Par",
                "value": "7 qt"
              },
              {
                "label": "PEAK par",
                "value": "8 qt"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b10.r2",
            "label": "Quesa birria + consommé (event-raid risk)",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~5 qt"
              },
              {
                "label": "Par",
                "value": "7 qt"
              },
              {
                "label": "PEAK par",
                "value": "7 qt"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b10.r3",
            "label": "Queso / mac sauce (**never the 22 qt batch**)",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~1 qt"
              },
              {
                "label": "Par",
                "value": "2 qt"
              },
              {
                "label": "PEAK par",
                "value": "2 qt"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b10.r4",
            "label": "Noodles par-cooked (**2-day shelf** — never the 22 qt batch)",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~1 qt"
              },
              {
                "label": "Par",
                "value": "2 qt"
              },
              {
                "label": "PEAK par",
                "value": "2 qt"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b10.r5",
            "label": "Chicken legs (jus + roast)",
            "meta": [
              {
                "label": "Use/wk",
                "value": "4 pc"
              },
              {
                "label": "Par",
                "value": "6 legs/wk"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b10.r6",
            "label": "Chicken jus",
            "meta": [
              {
                "label": "Use/wk",
                "value": "—"
              },
              {
                "label": "Par",
                "value": "2 qt"
              },
              {
                "label": "PEAK par",
                "value": "2 qt"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b10.r7",
            "label": "Trout — thaw, trim & vac (**24 hr**)",
            "meta": [
              {
                "label": "Use/wk",
                "value": "7–8 pc"
              },
              {
                "label": "Par",
                "value": "9–10 pc/wk"
              },
              {
                "label": "PEAK par",
                "value": "14 pc"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b10.r8",
            "label": "Pork chop — **brine 48 hr ahead**",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~4 pc"
              },
              {
                "label": "Par",
                "value": "5–6 pc/wk"
              },
              {
                "label": "PEAK par",
                "value": "8 pc"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b10.r9",
            "label": "Bacon (par-cook)",
            "meta": [
              {
                "label": "Use/wk",
                "value": "pencil"
              },
              {
                "label": "Par",
                "value": "15 lb"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b10.r10",
            "label": "Bacon jam",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~2 qt"
              },
              {
                "label": "Par",
                "value": "3 qt"
              },
              {
                "label": "PEAK par",
                "value": "3 qt"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b10.r11",
            "label": "Garlic (minced)",
            "meta": [
              {
                "label": "Use/wk",
                "value": "pencil"
              },
              {
                "label": "Par",
                "value": "1 qt"
              },
              {
                "label": "PEAK par",
                "value": "1 qt"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b10.r12",
            "label": "Herbal butter",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~⅓ lb"
              },
              {
                "label": "Par",
                "value": "1 lb"
              },
              {
                "label": "PEAK par",
                "value": "1 lb"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b10.r13",
            "label": "Honey butter",
            "meta": [
              {
                "label": "Use/wk",
                "value": "~¼ lb"
              },
              {
                "label": "Par",
                "value": "1 lb"
              },
              {
                "label": "PEAK par",
                "value": "1 lb"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b10.r14",
            "label": "Beer cheese (**purchased** — thaw from freezer)",
            "meta": [
              {
                "label": "Use/wk",
                "value": "—"
              },
              {
                "label": "Par",
                "value": "1 tub thawed"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b10.r15",
            "label": "Asparagus (blanch + shock)",
            "meta": [
              {
                "label": "Use/wk",
                "value": "pencil"
              },
              {
                "label": "Par",
                "value": "per line check"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b10.r16",
            "label": "Cornbread",
            "meta": [
              {
                "label": "Use/wk",
                "value": "low"
              },
              {
                "label": "Par",
                "value": "1 pan Thu"
              }
            ],
            "checkable": true
          },
          {
            "id": "prep-par.b10.r17",
            "label": "Breakfast potatoes (Sun only)",
            "meta": [
              {
                "label": "Use/wk",
                "value": "—"
              },
              {
                "label": "Par",
                "value": "20 lb Sun"
              }
            ],
            "checkable": true
          }
        ]
      },
      {
        "kind": "note",
        "text": "Pars marked **pencil** have no sales-data basis yet — set them by eye, then write them in."
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "Weekly batch cadence"
      },
      {
        "kind": "note",
        "text": "Long-life batches **Wed** · proteins/brines **Thu** · fresh + short-shelf **Fri/daily** · **Sat** top-up · **Sun** brunch. Wed is the big-batch day — but batch the **par**, not the book yield."
      },
      {
        "kind": "fields",
        "parts": [
          {
            "kind": "field",
            "id": "prep-par.b14.f0",
            "label": "Event prep pulled in? ☐ Yes (list)"
          },
          {
            "kind": "static",
            "text": "☐ No events"
          }
        ]
      },
      {
        "kind": "fields",
        "parts": [
          {
            "kind": "field",
            "id": "prep-par.b15.f0",
            "label": "Low / risk"
          }
        ]
      },
      {
        "kind": "fields",
        "parts": [
          {
            "kind": "field",
            "id": "prep-par.b16.f0",
            "label": "Manager check at the gate"
          },
          {
            "kind": "field",
            "id": "prep-par.b16.f1",
            "label": "time"
          }
        ]
      }
    ]
  },
  {
    "slug": "sysco-count",
    "title": "Sysco order guide — count sheet",
    "blurb": "Walk the building and count.",
    "tier": "manager",
    "blocks": [
      {
        "kind": "fields",
        "parts": [
          {
            "kind": "field",
            "id": "sysco-count.b0.f0",
            "label": "Count date"
          },
          {
            "kind": "field",
            "id": "sysco-count.b0.f1",
            "label": "Counted by"
          },
          {
            "kind": "static",
            "text": "**Order placed:** ☐ Sun ☐ Wed"
          }
        ]
      },
      {
        "kind": "note",
        "text": "Walk the building in this order. Count **Have** in cases. **Order = Par − Have** (never below zero); add event needs on top."
      },
      {
        "kind": "note",
        "text": "**Uses/wk** = real service usage per week from your Sysco invoices, with banquet buying stripped out: orders placed in the 5 days before a booked event (Rodeo 6/3, Howell wedding 7/17, Drewek 7/22) are capped at that item's normal order size before the rate is computed. Items new to Sysco are rated over their own active span. Event needs go on top of par from the BEO — never into it."
      },
      {
        "kind": "note",
        "text": "**Par** = one full week of that usage. Since you count twice a week (Sun + Wed), par carries roughly double the cover you need between drops — that margin is the safety stock. Pencil it as you learn."
      },
      {
        "kind": "note",
        "text": "Items you have not ordered in 6 months are listed at the end, off the count."
      },
      {
        "kind": "note",
        "text": "Where the guide carries two pack sizes of one item, both rows are here — strike the one you do not stock."
      },
      {
        "kind": "note",
        "text": "Sysco acct 059-075356 · order Sun + Wed, delivers Mon + Thu."
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "1 · Outside walk-in — thawing proteins, dairy, eggs"
      },
      {
        "kind": "count",
        "inputs": [
          {
            "key": "have",
            "label": "Have"
          },
          {
            "key": "order",
            "label": "Order"
          }
        ],
        "rows": [
          {
            "id": "sysco-count.b8.r0",
            "label": "Chicken wings, precooked",
            "meta": [
              {
                "label": "Pack",
                "value": "2/5LB"
              },
              {
                "label": "Uses/wk",
                "value": "3.8"
              },
              {
                "label": "Par",
                "value": "4"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r1",
            "label": "Burger patty 7 oz",
            "meta": [
              {
                "label": "Pack",
                "value": "30/7 OZ"
              },
              {
                "label": "Uses/wk",
                "value": "3.9"
              },
              {
                "label": "Par",
                "value": "4"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r2",
            "label": "Bacon, shingle center-cut",
            "meta": [
              {
                "label": "Pack",
                "value": "1/15#"
              },
              {
                "label": "Uses/wk",
                "value": "2.3"
              },
              {
                "label": "Par",
                "value": "3"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r3",
            "label": "Heavy cream 40%",
            "meta": [
              {
                "label": "Pack",
                "value": "12/32OZ"
              },
              {
                "label": "Uses/wk",
                "value": "0.8"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r4",
            "label": "Cheddar-jack, shredded",
            "meta": [
              {
                "label": "Pack",
                "value": "4/5LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.8"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r5",
            "label": "Basa/swai fillet 7-9 oz",
            "meta": [
              {
                "label": "Pack",
                "value": "1/15 LB"
              },
              {
                "label": "Uses/wk",
                "value": "2"
              },
              {
                "label": "Par",
                "value": "2"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r6",
            "label": "Buttermilk, qt",
            "meta": [
              {
                "label": "Pack",
                "value": "12/1 QT"
              },
              {
                "label": "Uses/wk",
                "value": "0.8"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r7",
            "label": "Chicken tenders, breaded",
            "meta": [
              {
                "label": "Pack",
                "value": "2/5 LB"
              },
              {
                "label": "Uses/wk",
                "value": "1.2"
              },
              {
                "label": "Par",
                "value": "2"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r8",
            "label": "Whole milk",
            "meta": [
              {
                "label": "Pack",
                "value": "4/1 GAL"
              },
              {
                "label": "Uses/wk",
                "value": "0.8"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r9",
            "label": "Pork chop, frenched",
            "meta": [
              {
                "label": "Pack",
                "value": "10/12 OZ"
              },
              {
                "label": "Uses/wk",
                "value": "0.9"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r10",
            "label": "Pig wings 4 oz",
            "meta": [
              {
                "label": "Pack",
                "value": "2/4.5LB"
              },
              {
                "label": "Uses/wk",
                "value": "1.4"
              },
              {
                "label": "Par",
                "value": "2"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r11",
            "label": "Queso blanco melting loaf",
            "meta": [
              {
                "label": "Pack",
                "value": "6/5 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.7"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r12",
            "label": "White cheddar, sliced",
            "meta": [
              {
                "label": "Pack",
                "value": "4/2.5 LB"
              },
              {
                "label": "Uses/wk",
                "value": "1.4"
              },
              {
                "label": "Par",
                "value": "2"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r13",
            "label": "Chorizo, bulk raw",
            "meta": [
              {
                "label": "Pack",
                "value": "2/7 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.7"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r14",
            "label": "Clarified butter",
            "meta": [
              {
                "label": "Pack",
                "value": "4/5 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r15",
            "label": "Pepper jack, sliced",
            "meta": [
              {
                "label": "Pack",
                "value": "8/1.5LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r16",
            "label": "Fresh mozzarella log",
            "meta": [
              {
                "label": "Pack",
                "value": "8/1 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r17",
            "label": "Egg scramble mix",
            "meta": [
              {
                "label": "Pack",
                "value": "15/2 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.4"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r18",
            "label": "Shell eggs, medium",
            "meta": [
              {
                "label": "Pack",
                "value": "1/15 DZ"
              },
              {
                "label": "Uses/wk",
                "value": "0.7"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r19",
            "label": "Pork butt, boneless",
            "meta": [
              {
                "label": "Pack",
                "value": "8/7-10#"
              },
              {
                "label": "Uses/wk",
                "value": "0.4"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r20",
            "label": "B&B pickle chips",
            "meta": [
              {
                "label": "Pack",
                "value": "1/2 GAL"
              },
              {
                "label": "Uses/wk",
                "value": "0.4"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r21",
            "label": "Blue cheese crumbles",
            "meta": [
              {
                "label": "Pack",
                "value": "2/5 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.8"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r22",
            "label": "Breakfast sausage patty 3.5 oz",
            "meta": [
              {
                "label": "Pack",
                "value": "42/3.5OZ"
              },
              {
                "label": "Uses/wk",
                "value": "0.4"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r23",
            "label": "Chihuahua, shredded",
            "meta": [
              {
                "label": "Pack",
                "value": "4/5LB"
              },
              {
                "label": "Uses/wk",
                "value": "1"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r24",
            "label": "Cotija",
            "meta": [
              {
                "label": "Pack",
                "value": "12/1#AVG"
              },
              {
                "label": "Uses/wk",
                "value": "0.8"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r25",
            "label": "Hard-cooked eggs",
            "meta": [
              {
                "label": "Pack",
                "value": "12/12 CT"
              },
              {
                "label": "Uses/wk",
                "value": "0.1"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r26",
            "label": "Unsalted butter, European",
            "meta": [
              {
                "label": "Pack",
                "value": "36/1 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.1"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b8.r27",
            "label": "Sour cream",
            "meta": [
              {
                "label": "Pack",
                "value": "2/5 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          }
        ]
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "2 · Inside walk-in — produce"
      },
      {
        "kind": "count",
        "inputs": [
          {
            "key": "have",
            "label": "Have"
          },
          {
            "key": "order",
            "label": "Order"
          }
        ],
        "rows": [
          {
            "id": "sysco-count.b10.r0",
            "label": "Tomatoes 5x6",
            "meta": [
              {
                "label": "Pack",
                "value": "1/60 CT"
              },
              {
                "label": "Uses/wk",
                "value": "2"
              },
              {
                "label": "Par",
                "value": "2"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b10.r1",
            "label": "White onions, jumbo",
            "meta": [
              {
                "label": "Pack",
                "value": "1/50LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.8"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b10.r2",
            "label": "Chives",
            "meta": [
              {
                "label": "Pack",
                "value": "1/1 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.8"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b10.r3",
            "label": "Green leaf lettuce",
            "meta": [
              {
                "label": "Pack",
                "value": "4/6 CT"
              },
              {
                "label": "Uses/wk",
                "value": "0.8"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b10.r4",
            "label": "Jalapeños — 5 lb",
            "meta": [
              {
                "label": "Pack",
                "value": "1/5 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.6"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b10.r5",
            "label": "Jalapeños — 10 lb",
            "meta": [
              {
                "label": "Pack",
                "value": "1/10 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.4"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b10.r6",
            "label": "Avocados, Hass",
            "meta": [
              {
                "label": "Pack",
                "value": "1/48 CT"
              },
              {
                "label": "Uses/wk",
                "value": "0.6"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b10.r7",
            "label": "English cucumber",
            "meta": [
              {
                "label": "Pack",
                "value": "1/12CT"
              },
              {
                "label": "Uses/wk",
                "value": "1"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b10.r8",
            "label": "Cilantro",
            "meta": [
              {
                "label": "Pack",
                "value": "1/30 CT"
              },
              {
                "label": "Uses/wk",
                "value": "0.3"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b10.r9",
            "label": "Red cabbage, shredded",
            "meta": [
              {
                "label": "Pack",
                "value": "4/5 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.8"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b10.r10",
            "label": "Green cabbage, shredded",
            "meta": [
              {
                "label": "Pack",
                "value": "4/5 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.8"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b10.r11",
            "label": "Thyme",
            "meta": [
              {
                "label": "Pack",
                "value": "1/1 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.8"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b10.r12",
            "label": "Asparagus, jumbo",
            "meta": [
              {
                "label": "Pack",
                "value": "1/11 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.7"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b10.r13",
            "label": "Red onions, jumbo",
            "meta": [
              {
                "label": "Pack",
                "value": "10/5 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.6"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b10.r14",
            "label": "Cherry tomatoes, heirloom",
            "meta": [
              {
                "label": "Pack",
                "value": "12/.5 PTS"
              },
              {
                "label": "Uses/wk",
                "value": "0.8"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b10.r15",
            "label": "Tarragon",
            "meta": [
              {
                "label": "Pack",
                "value": "1/1 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b10.r16",
            "label": "Tender greens",
            "meta": [
              {
                "label": "Pack",
                "value": "4/3 LB"
              },
              {
                "label": "Uses/wk",
                "value": "1"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b10.r17",
            "label": "Parsley Italian",
            "meta": [
              {
                "label": "Pack",
                "value": "1/1 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.8"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b10.r18",
            "label": "Dill Baby",
            "meta": [
              {
                "label": "Pack",
                "value": "1/4 OZ"
              },
              {
                "label": "Uses/wk",
                "value": "0.9"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b10.r19",
            "label": "Garlic, peeled",
            "meta": [
              {
                "label": "Pack",
                "value": "4/5LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.4"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b10.r20",
            "label": "Shallots",
            "meta": [
              {
                "label": "Pack",
                "value": "1/10 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.4"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b10.r21",
            "label": "Carrot sticks",
            "meta": [
              {
                "label": "Pack",
                "value": "4/5 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.4"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b10.r22",
            "label": "Basil — 1 lb",
            "meta": [
              {
                "label": "Pack",
                "value": "1/1 LB"
              },
              {
                "label": "Uses/wk",
                "value": "1.5"
              },
              {
                "label": "Par",
                "value": "2"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b10.r23",
            "label": "Celery — 24 ct",
            "meta": [
              {
                "label": "Pack",
                "value": "1/24 CT"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b10.r24",
            "label": "Celery — 36 ct",
            "meta": [
              {
                "label": "Pack",
                "value": "1/36CT"
              },
              {
                "label": "Uses/wk",
                "value": "0.3"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          }
        ]
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "3 · Freezer"
      },
      {
        "kind": "count",
        "inputs": [
          {
            "key": "have",
            "label": "Have"
          },
          {
            "key": "order",
            "label": "Order"
          }
        ],
        "rows": [
          {
            "id": "sysco-count.b12.r0",
            "label": "Beer-batter fries 5/16 XL",
            "meta": [
              {
                "label": "Pack",
                "value": "6/5 LB"
              },
              {
                "label": "Uses/wk",
                "value": "3.6"
              },
              {
                "label": "Par",
                "value": "4"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b12.r1",
            "label": "Brioche bun 4.5\"",
            "meta": [
              {
                "label": "Pack",
                "value": "8/10CT"
              },
              {
                "label": "Uses/wk",
                "value": "1.3"
              },
              {
                "label": "Par",
                "value": "2"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b12.r2",
            "label": "Sourdough, thick sliced",
            "meta": [
              {
                "label": "Pack",
                "value": "6/32 OZ"
              },
              {
                "label": "Uses/wk",
                "value": "0.7"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b12.r3",
            "label": "Sweet potato fries",
            "meta": [
              {
                "label": "Pack",
                "value": "5/3 LB"
              },
              {
                "label": "Uses/wk",
                "value": "1.3"
              },
              {
                "label": "Par",
                "value": "2"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b12.r4",
            "label": "Roasted corn blend",
            "meta": [
              {
                "label": "Pack",
                "value": "6/2.5LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.4"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b12.r5",
            "label": "Roasted root veg blend",
            "meta": [
              {
                "label": "Pack",
                "value": "6/2.5LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.9"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b12.r6",
            "label": "Chocolate fudge cake 10\"",
            "meta": [
              {
                "label": "Pack",
                "value": "2/110 OZ"
              },
              {
                "label": "Uses/wk",
                "value": "0.3"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b12.r7",
            "label": "Mini churros",
            "meta": [
              {
                "label": "Pack",
                "value": "1/500 CT"
              },
              {
                "label": "Uses/wk",
                "value": "0.3"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b12.r8",
            "label": "Soft pretzels, Bavarian",
            "meta": [
              {
                "label": "Pack",
                "value": "10/4 PK"
              },
              {
                "label": "Uses/wk",
                "value": "0.1"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b12.r9",
            "label": "Vanilla ice cream",
            "meta": [
              {
                "label": "Pack",
                "value": "1/3 GAL"
              },
              {
                "label": "Uses/wk",
                "value": "0"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b12.r10",
            "label": "GF burger bun",
            "meta": [
              {
                "label": "Pack",
                "value": "24/1EA"
              },
              {
                "label": "Uses/wk",
                "value": "0.2"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b12.r11",
            "label": "Impossible patty 1/4 lb",
            "meta": [
              {
                "label": "Pack",
                "value": "40/4 OZ"
              },
              {
                "label": "Uses/wk",
                "value": "0.2"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          }
        ]
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "4 · Shed — dry, canned, paper, chemical"
      },
      {
        "kind": "heading",
        "level": 3,
        "text": "Tortillas & chips"
      },
      {
        "kind": "count",
        "inputs": [
          {
            "key": "have",
            "label": "Have"
          },
          {
            "key": "order",
            "label": "Order"
          }
        ],
        "rows": [
          {
            "id": "sysco-count.b15.r0",
            "label": "Flour tortilla, pressed 6\"",
            "meta": [
              {
                "label": "Pack",
                "value": "12/24CT"
              },
              {
                "label": "Uses/wk",
                "value": "0.7"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b15.r1",
            "label": "Tortilla chips, raw yellow 4-cut",
            "meta": [
              {
                "label": "Pack",
                "value": "1/30 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b15.r2",
            "label": "Corn tortilla, white 6\"",
            "meta": [
              {
                "label": "Pack",
                "value": "12/60 CT"
              },
              {
                "label": "Uses/wk",
                "value": "0.9"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b15.r3",
            "label": "Flour tortilla 14\"",
            "meta": [
              {
                "label": "Pack",
                "value": "8/12CT"
              },
              {
                "label": "Uses/wk",
                "value": "0.2"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          }
        ]
      },
      {
        "kind": "heading",
        "level": 3,
        "text": "Dry & baking"
      },
      {
        "kind": "count",
        "inputs": [
          {
            "key": "have",
            "label": "Have"
          },
          {
            "key": "order",
            "label": "Order"
          }
        ],
        "rows": [
          {
            "id": "sysco-count.b17.r0",
            "label": "Cavatappi",
            "meta": [
              {
                "label": "Pack",
                "value": "2/10 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.8"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b17.r1",
            "label": "AP flour",
            "meta": [
              {
                "label": "Pack",
                "value": "1/50LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b17.r2",
            "label": "Cornbread mix",
            "meta": [
              {
                "label": "Pack",
                "value": "6/5 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b17.r3",
            "label": "Pancake/waffle mix",
            "meta": [
              {
                "label": "Pack",
                "value": "6/5 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.3"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b17.r4",
            "label": "Vanilla extract",
            "meta": [
              {
                "label": "Pack",
                "value": "6/32 OZ"
              },
              {
                "label": "Uses/wk",
                "value": "0.1"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b17.r5",
            "label": "Pepitas, raw",
            "meta": [
              {
                "label": "Pack",
                "value": "1/5LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b17.r6",
            "label": "Lard",
            "meta": [
              {
                "label": "Pack",
                "value": "1/50 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b17.r7",
            "label": "Panko",
            "meta": [
              {
                "label": "Pack",
                "value": "1/25 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          }
        ]
      },
      {
        "kind": "heading",
        "level": 3,
        "text": "Oils & fryer"
      },
      {
        "kind": "count",
        "inputs": [
          {
            "key": "have",
            "label": "Have"
          },
          {
            "key": "order",
            "label": "Order"
          }
        ],
        "rows": [
          {
            "id": "sysco-count.b19.r0",
            "label": "Fry-On liquid shortening",
            "meta": [
              {
                "label": "Pack",
                "value": "1/35 LB"
              },
              {
                "label": "Uses/wk",
                "value": "3"
              },
              {
                "label": "Par",
                "value": "3"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b19.r1",
            "label": "Pomace olive oil",
            "meta": [
              {
                "label": "Pack",
                "value": "3/1GAL"
              },
              {
                "label": "Uses/wk",
                "value": "0.6"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b19.r2",
            "label": "Canola oil",
            "meta": [
              {
                "label": "Pack",
                "value": "1/35 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.2"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          }
        ]
      },
      {
        "kind": "heading",
        "level": 3,
        "text": "Canned & jarred"
      },
      {
        "kind": "count",
        "inputs": [
          {
            "key": "have",
            "label": "Have"
          },
          {
            "key": "order",
            "label": "Order"
          }
        ],
        "rows": [
          {
            "id": "sysco-count.b21.r0",
            "label": "Black beans #10",
            "meta": [
              {
                "label": "Pack",
                "value": "6/10 CAN"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b21.r1",
            "label": "Vanilla pudding #10",
            "meta": [
              {
                "label": "Pack",
                "value": "6/#10"
              },
              {
                "label": "Uses/wk",
                "value": "0.2"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b21.r2",
            "label": "Diced red pepper #300",
            "meta": [
              {
                "label": "Pack",
                "value": "24/#300"
              },
              {
                "label": "Uses/wk",
                "value": "1"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b21.r3",
            "label": "Anchovy fillets",
            "meta": [
              {
                "label": "Pack",
                "value": "12/13 OZ"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b21.r4",
            "label": "Tomatillo, crushed #10",
            "meta": [
              {
                "label": "Pack",
                "value": "6/#10"
              },
              {
                "label": "Uses/wk",
                "value": "0"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b21.r5",
            "label": "Guajillo chiles, dried",
            "meta": [
              {
                "label": "Pack",
                "value": "1/5 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b21.r6",
            "label": "Capers",
            "meta": [
              {
                "label": "Pack",
                "value": "12/16 OZ"
              },
              {
                "label": "Uses/wk",
                "value": "0"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          }
        ]
      },
      {
        "kind": "heading",
        "level": 3,
        "text": "Sauces & condiments"
      },
      {
        "kind": "count",
        "inputs": [
          {
            "key": "have",
            "label": "Have"
          },
          {
            "key": "order",
            "label": "Order"
          }
        ],
        "rows": [
          {
            "id": "sysco-count.b23.r0",
            "label": "Mayonnaise, pail",
            "meta": [
              {
                "label": "Pack",
                "value": "1/28LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.8"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b23.r1",
            "label": "Thai sweet chili sauce",
            "meta": [
              {
                "label": "Pack",
                "value": "12/32 OZ"
              },
              {
                "label": "Uses/wk",
                "value": "0.2"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b23.r2",
            "label": "Buffalo sauce",
            "meta": [
              {
                "label": "Pack",
                "value": "4/1 GAL"
              },
              {
                "label": "Uses/wk",
                "value": "0.2"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b23.r3",
            "label": "Horseradish, prepared",
            "meta": [
              {
                "label": "Pack",
                "value": "6/32 OZ"
              },
              {
                "label": "Uses/wk",
                "value": "0.1"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b23.r4",
            "label": "Yellow mustard",
            "meta": [
              {
                "label": "Pack",
                "value": "6/6.5 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.3"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b23.r5",
            "label": "Dijon mustard",
            "meta": [
              {
                "label": "Pack",
                "value": "4/9 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.2"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b23.r6",
            "label": "Whole grain mustard",
            "meta": [
              {
                "label": "Pack",
                "value": "4/8.6 LB"
              },
              {
                "label": "Uses/wk",
                "value": "1"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b23.r7",
            "label": "Asian Yuzu Kosho Green",
            "meta": [
              {
                "label": "Pack",
                "value": "2/17.6OZ"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b23.r8",
            "label": "Ranch dressing mix",
            "meta": [
              {
                "label": "Pack",
                "value": "18/3.2OZ"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b23.r9",
            "label": "Apple cider vinegar",
            "meta": [
              {
                "label": "Pack",
                "value": "4/1GAL"
              },
              {
                "label": "Uses/wk",
                "value": "0"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b23.r10",
            "label": "Ketchup, squeeze",
            "meta": [
              {
                "label": "Pack",
                "value": "16/24OZ"
              },
              {
                "label": "Uses/wk",
                "value": "0"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b23.r11",
            "label": "Cholula",
            "meta": [
              {
                "label": "Pack",
                "value": "24/5FOZ"
              },
              {
                "label": "Uses/wk",
                "value": "1"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b23.r12",
            "label": "Tabasco",
            "meta": [
              {
                "label": "Pack",
                "value": "12/12 OZ"
              },
              {
                "label": "Uses/wk",
                "value": "0"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          }
        ]
      },
      {
        "kind": "heading",
        "level": 3,
        "text": "Spices"
      },
      {
        "kind": "count",
        "inputs": [
          {
            "key": "have",
            "label": "Have"
          },
          {
            "key": "order",
            "label": "Order"
          }
        ],
        "rows": [
          {
            "id": "sysco-count.b25.r0",
            "label": "Kosher salt",
            "meta": [
              {
                "label": "Pack",
                "value": "12/3LB"
              },
              {
                "label": "Uses/wk",
                "value": "7"
              },
              {
                "label": "Par",
                "value": "7"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b25.r1",
            "label": "Paprika Domestic Ground",
            "meta": [
              {
                "label": "Pack",
                "value": "3/4.5LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.3"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b25.r2",
            "label": "Cumin Ground",
            "meta": [
              {
                "label": "Pack",
                "value": "3/4.5 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.4"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b25.r3",
            "label": "Pepper Black Shaker Ground",
            "meta": [
              {
                "label": "Pack",
                "value": "3/5 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.4"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b25.r4",
            "label": "Onion Powder",
            "meta": [
              {
                "label": "Pack",
                "value": "3/5.5LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.1"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b25.r5",
            "label": "Pepper Cayenne Ground",
            "meta": [
              {
                "label": "Pack",
                "value": "3/4.5LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.1"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b25.r6",
            "label": "Garlic Granulated",
            "meta": [
              {
                "label": "Pack",
                "value": "6/26OZ"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b25.r7",
            "label": "Garlic Powder",
            "meta": [
              {
                "label": "Pack",
                "value": "3/6LB"
              },
              {
                "label": "Uses/wk",
                "value": "1"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b25.r8",
            "label": "Celery Seed Whole",
            "meta": [
              {
                "label": "Pack",
                "value": "6/1LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b25.r9",
            "label": "Pepper Red Crushed",
            "meta": [
              {
                "label": "Pack",
                "value": "3/3.25LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b25.r10",
            "label": "Chili Powder Dark",
            "meta": [
              {
                "label": "Pack",
                "value": "3/5.5 LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b25.r11",
            "label": "Cinnamon Ground",
            "meta": [
              {
                "label": "Pack",
                "value": "6/18 OZ"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          }
        ]
      },
      {
        "kind": "heading",
        "level": 3,
        "text": "Paper & disposables"
      },
      {
        "kind": "count",
        "inputs": [
          {
            "key": "have",
            "label": "Have"
          },
          {
            "key": "order",
            "label": "Order"
          }
        ],
        "rows": [
          {
            "id": "sysco-count.b27.r0",
            "label": "Trash liners 39x56",
            "meta": [
              {
                "label": "Pack",
                "value": "50/55GAL"
              },
              {
                "label": "Uses/wk",
                "value": "1.2"
              },
              {
                "label": "Par",
                "value": "2"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b27.r1",
            "label": "Nitrile gloves, Extra-large",
            "meta": [
              {
                "label": "Pack",
                "value": "10/100CT"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b27.r2",
            "label": "Kraft takeout #4",
            "meta": [
              {
                "label": "Pack",
                "value": "2/45CT"
              },
              {
                "label": "Uses/wk",
                "value": "0.8"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b27.r3",
            "label": "Kraft takeout #1",
            "meta": [
              {
                "label": "Pack",
                "value": "3/60CT"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b27.r4",
            "label": "Nitrile gloves, Large",
            "meta": [
              {
                "label": "Pack",
                "value": "10/100CT"
              },
              {
                "label": "Uses/wk",
                "value": "0.3"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b27.r5",
            "label": "PVC film 18\"",
            "meta": [
              {
                "label": "Pack",
                "value": "1/18 IN"
              },
              {
                "label": "Uses/wk",
                "value": "0.6"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b27.r6",
            "label": "Date labels, dissolvable",
            "meta": [
              {
                "label": "Pack",
                "value": "1/500CT"
              },
              {
                "label": "Uses/wk",
                "value": "0.2"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b27.r7",
            "label": "Nitrile gloves, Medium",
            "meta": [
              {
                "label": "Pack",
                "value": "10/100CT"
              },
              {
                "label": "Uses/wk",
                "value": "0.7"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b27.r8",
            "label": "Deli containers 32 oz + lids",
            "meta": [
              {
                "label": "Pack",
                "value": "240/32OZ"
              },
              {
                "label": "Uses/wk",
                "value": "0.4"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b27.r9",
            "label": "Deli containers 16 oz + lids",
            "meta": [
              {
                "label": "Pack",
                "value": "240/16OZ"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b27.r10",
            "label": "Paper towel rolls",
            "meta": [
              {
                "label": "Pack",
                "value": "3/1150FT"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b27.r11",
            "label": "Soup containers 8 oz",
            "meta": [
              {
                "label": "Pack",
                "value": "20/25 CT"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b27.r12",
            "label": "Lids, 1.5-2.5 oz portion",
            "meta": [
              {
                "label": "Pack",
                "value": "24/100CT"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          }
        ]
      },
      {
        "kind": "heading",
        "level": 3,
        "text": "Chemical & smallwares"
      },
      {
        "kind": "count",
        "inputs": [
          {
            "key": "have",
            "label": "Have"
          },
          {
            "key": "order",
            "label": "Order"
          }
        ],
        "rows": [
          {
            "id": "sysco-count.b29.r0",
            "label": "Grill cleaner, high-temp",
            "meta": [
              {
                "label": "Pack",
                "value": "6/32 OZ"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b29.r1",
            "label": "Green scour pads",
            "meta": [
              {
                "label": "Pack",
                "value": "1/20CT"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b29.r2",
            "label": "Grill bricks",
            "meta": [
              {
                "label": "Pack",
                "value": "12/1EA"
              },
              {
                "label": "Uses/wk",
                "value": "0.1"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b29.r3",
            "label": "Steel scrub pads",
            "meta": [
              {
                "label": "Pack",
                "value": "6/12CT"
              },
              {
                "label": "Uses/wk",
                "value": "0.5"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          }
        ]
      },
      {
        "kind": "heading",
        "level": 3,
        "text": "Other dry"
      },
      {
        "kind": "count",
        "inputs": [
          {
            "key": "have",
            "label": "Have"
          },
          {
            "key": "order",
            "label": "Order"
          }
        ],
        "rows": [
          {
            "id": "sysco-count.b31.r0",
            "label": "Red Bull",
            "meta": [
              {
                "label": "Pack",
                "value": "24/12 OZ"
              },
              {
                "label": "Uses/wk",
                "value": "0.7"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b31.r1",
            "label": "Chicken soup base",
            "meta": [
              {
                "label": "Pack",
                "value": "6/1LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.3"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b31.r2",
            "label": "Granulated sugar",
            "meta": [
              {
                "label": "Pack",
                "value": "1/50LB"
              },
              {
                "label": "Uses/wk",
                "value": "0.3"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          },
          {
            "id": "sysco-count.b31.r3",
            "label": "Kewpie mayo",
            "meta": [
              {
                "label": "Pack",
                "value": "4/64 OZ"
              },
              {
                "label": "Uses/wk",
                "value": "0.3"
              },
              {
                "label": "Par",
                "value": "1"
              }
            ],
            "checkable": false
          }
        ]
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "Not ordered in the last 6 months — off the count"
      },
      {
        "kind": "note",
        "text": "On the Sysco guide but no purchase history. Order by exception; move a row up if it becomes regular."
      },
      {
        "kind": "note",
        "text": "Beer cheese dip (4/5 LB), Hash browns, diced (6/6 LB), Basil (1/4 OZ), Cream cheese loaf (10/3LB), Achiote paste (1/10 LB), BBQ sauce (4/1 GAL), Balsamic glaze (6/12.9OZ), Bamboo skewers 6\" (10/1000CT), Basket liners (5/1000CT), Beverage napkins (4/250CT), Blue cheese dressing, chunky (4/1 GAL), Blue cheese dressing, deluxe (4/1 GAL), Calabrian chili, chopped (2/33.51Z), Celery Salt (6/30OZ), Chocolate sauce (12/16 OZ), Condensed milk (24/14 OZ), Dill relish (4/1 GAL), Dinner napkins (1000/1EA), Foil roll (1/18 IN), Fryer filter cones (10/50CT), Honey (6/5 LB), Kids cups (250/12OZ), Kraft takeout #8 (2/65CT), Lids, 3-4 oz portion (20/120CT), Malt vinegar (12/12OZ), Maple syrup (4/128FOZ), Nilla wafers (2/2 LB), Nutmeg Ground (6/1LB), Oregano Leaves (3/1.75LB), Pepper Black Coarse Ground (3/5LB), Pickling (1/14 OZ), Pickling Whole (6/13 OZ), Portion cups 4 oz (15/200CT), Powdered sugar (16/2 LB), Round combo container 12 oz (10/25CT), Sugar packets (2000/2.85 G), Sweet relish (4/1 GAL), Tabasco green (12/5 OZ), Turbinado sugar (12/2 LB)"
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "Order call checklist"
      },
      {
        "kind": "note",
        "text": "☐ Counted all four zones"
      },
      {
        "kind": "note",
        "text": "☐ Event / BEO demand added on top of par"
      },
      {
        "kind": "note",
        "text": "☐ 86-prone items double-checked"
      },
      {
        "kind": "note",
        "text": "☐ Pars pencil-corrected where the number was wrong"
      },
      {
        "kind": "fields",
        "parts": [
          {
            "kind": "field",
            "id": "sysco-count.b40.f0",
            "label": "☐ Confirmation # saved"
          }
        ]
      }
    ]
  },
  {
    "slug": "purveyor-planner",
    "title": "Purveyor Planner — orders · deliveries · calls",
    "blurb": "Order days, drop days, phone numbers.",
    "tier": "manager",
    "blocks": [
      {
        "kind": "fields",
        "parts": [
          {
            "kind": "field",
            "id": "purveyor-planner.b0.f0",
            "label": "Week of"
          }
        ]
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "Cadence"
      },
      {
        "kind": "grid",
        "columns": [
          "",
          "Place order",
          "Delivery lands",
          "Notes"
        ],
        "rows": [
          {
            "id": "purveyor-planner.b2.r0",
            "cells": [
              {
                "kind": "text",
                "text": "Sysco"
              },
              {
                "kind": "text",
                "text": "**Sun + Wed**"
              },
              {
                "kind": "text",
                "text": "**Mon + Thu** · key-drop 10:00–4:00"
              },
              {
                "kind": "text",
                "text": "~2 orders/wk"
              }
            ]
          },
          {
            "id": "purveyor-planner.b2.r1",
            "cells": [
              {
                "kind": "text",
                "text": "Shamrock"
              },
              {
                "kind": "text",
                "text": "cutoff: _____"
              },
              {
                "kind": "text",
                "text": "**Mon + Thu**"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b2.r1.c3"
              }
            ]
          },
          {
            "id": "purveyor-planner.b2.r2",
            "cells": [
              {
                "kind": "text",
                "text": "Webstaurant"
              },
              {
                "kind": "text",
                "text": "as needed"
              },
              {
                "kind": "text",
                "text": "ground ship"
              },
              {
                "kind": "text",
                "text": "smallwares / equipment"
              }
            ]
          }
        ]
      },
      {
        "kind": "callout",
        "text": "Key-drop: frozen + cooler behind building, left of back door."
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "Food purveyors"
      },
      {
        "kind": "grid",
        "columns": [
          "Vendor",
          "Who",
          "Phone",
          "Acct"
        ],
        "rows": [
          {
            "id": "purveyor-planner.b5.r0",
            "cells": [
              {
                "kind": "text",
                "text": "Sysco — Sales Consultant"
              },
              {
                "kind": "text",
                "text": "Cullen Haskins"
              },
              {
                "kind": "text",
                "text": "719-839-1884"
              },
              {
                "kind": "text",
                "text": "059-075356"
              }
            ]
          },
          {
            "id": "purveyor-planner.b5.r1",
            "cells": [
              {
                "kind": "text",
                "text": "Sysco — Sales Manager"
              },
              {
                "kind": "text",
                "text": "Jake Pahlke"
              },
              {
                "kind": "text",
                "text": "720-471-1889"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b5.r1.c3"
              }
            ]
          },
          {
            "id": "purveyor-planner.b5.r2",
            "cells": [
              {
                "kind": "text",
                "text": "Shamrock"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b5.r2.c1"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b5.r2.c2"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b5.r2.c3"
              }
            ]
          },
          {
            "id": "purveyor-planner.b5.r3",
            "cells": [
              {
                "kind": "text",
                "text": "Webstaurant"
              },
              {
                "kind": "text",
                "text": "portal"
              },
              {
                "kind": "text",
                "text": "—"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b5.r3.c3"
              }
            ]
          }
        ]
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "Facilities & service vendors"
      },
      {
        "kind": "grid",
        "columns": [
          "Service",
          "Company",
          "Phone",
          "Cadence",
          "Last",
          "Next due"
        ],
        "rows": [
          {
            "id": "purveyor-planner.b7.r0",
            "cells": [
              {
                "kind": "text",
                "text": "Grease trap pumping"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r0.c1"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r0.c2"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r0.c3"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r0.c4"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r0.c5"
              }
            ]
          },
          {
            "id": "purveyor-planner.b7.r1",
            "cells": [
              {
                "kind": "text",
                "text": "Trash / recycling"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r1.c1"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r1.c2"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r1.c3"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r1.c4"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r1.c5"
              }
            ]
          },
          {
            "id": "purveyor-planner.b7.r2",
            "cells": [
              {
                "kind": "text",
                "text": "Exterminator / pest"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r2.c1"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r2.c2"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r2.c3"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r2.c4"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r2.c5"
              }
            ]
          },
          {
            "id": "purveyor-planner.b7.r3",
            "cells": [
              {
                "kind": "text",
                "text": "Hood cleaning"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r3.c1"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r3.c2"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r3.c3"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r3.c4"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r3.c5"
              }
            ]
          },
          {
            "id": "purveyor-planner.b7.r4",
            "cells": [
              {
                "kind": "text",
                "text": "Fire suppression / extinguishers"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r4.c1"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r4.c2"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r4.c3"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r4.c4"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r4.c5"
              }
            ]
          },
          {
            "id": "purveyor-planner.b7.r5",
            "cells": [
              {
                "kind": "text",
                "text": "Plumber"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r5.c1"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r5.c2"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r5.c3"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r5.c4"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r5.c5"
              }
            ]
          },
          {
            "id": "purveyor-planner.b7.r6",
            "cells": [
              {
                "kind": "text",
                "text": "Electrician"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r6.c1"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r6.c2"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r6.c3"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r6.c4"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r6.c5"
              }
            ]
          },
          {
            "id": "purveyor-planner.b7.r7",
            "cells": [
              {
                "kind": "text",
                "text": "Refrigeration / HVAC tech"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r7.c1"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r7.c2"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r7.c3"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r7.c4"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r7.c5"
              }
            ]
          },
          {
            "id": "purveyor-planner.b7.r8",
            "cells": [
              {
                "kind": "text",
                "text": "Equipment repair (range, fryers)"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r8.c1"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r8.c2"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r8.c3"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r8.c4"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r8.c5"
              }
            ]
          },
          {
            "id": "purveyor-planner.b7.r9",
            "cells": [
              {
                "kind": "text",
                "text": "Dish machine / chemicals"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r9.c1"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r9.c2"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r9.c3"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r9.c4"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r9.c5"
              }
            ]
          },
          {
            "id": "purveyor-planner.b7.r10",
            "cells": [
              {
                "kind": "text",
                "text": "Linen"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r10.c1"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r10.c2"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r10.c3"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r10.c4"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r10.c5"
              }
            ]
          },
          {
            "id": "purveyor-planner.b7.r11",
            "cells": [
              {
                "kind": "text",
                "text": "Knife sharpening"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r11.c1"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r11.c2"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r11.c3"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r11.c4"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r11.c5"
              }
            ]
          },
          {
            "id": "purveyor-planner.b7.r12",
            "cells": [
              {
                "kind": "text",
                "text": "POS (Toast) support"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r12.c1"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r12.c2"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r12.c3"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r12.c4"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r12.c5"
              }
            ]
          },
          {
            "id": "purveyor-planner.b7.r13",
            "cells": [
              {
                "kind": "text",
                "text": "Landlord / building"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r13.c1"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r13.c2"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r13.c3"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r13.c4"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b7.r13.c5"
              }
            ]
          }
        ]
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "Call log"
      },
      {
        "kind": "grid",
        "columns": [
          "Date",
          "Vendor / who",
          "About",
          "Result / promised",
          "Follow-up"
        ],
        "rows": [
          {
            "id": "purveyor-planner.b9.r0",
            "cells": [
              {
                "kind": "entry",
                "id": "purveyor-planner.b9.r0.c0"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b9.r0.c1"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b9.r0.c2"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b9.r0.c3"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b9.r0.c4"
              }
            ]
          },
          {
            "id": "purveyor-planner.b9.r1",
            "cells": [
              {
                "kind": "entry",
                "id": "purveyor-planner.b9.r1.c0"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b9.r1.c1"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b9.r1.c2"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b9.r1.c3"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b9.r1.c4"
              }
            ]
          },
          {
            "id": "purveyor-planner.b9.r2",
            "cells": [
              {
                "kind": "entry",
                "id": "purveyor-planner.b9.r2.c0"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b9.r2.c1"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b9.r2.c2"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b9.r2.c3"
              },
              {
                "kind": "entry",
                "id": "purveyor-planner.b9.r2.c4"
              }
            ]
          }
        ]
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "Receiving — every drop"
      },
      {
        "kind": "note",
        "text": "☐ Cold ≤40°F, frozen solid — probe one case ☐ Count vs confirmation before signing ☐ Damaged/short/warm → photo + same-day credit call ☐ Invoice filed same day · staple jumps >5% written down"
      }
    ]
  },
  {
    "slug": "manager-week",
    "title": "Manager Weekly Routine",
    "blurb": "The manager week, block by block.",
    "tier": "manager",
    "blocks": [
      {
        "kind": "grid",
        "columns": [
          "Day",
          "Hours",
          "Blocks"
        ],
        "rows": [
          {
            "id": "manager-week.b0.r0",
            "cells": [
              {
                "kind": "text",
                "text": "MON"
              },
              {
                "kind": "text",
                "text": "9–1 (4 hr)"
              },
              {
                "kind": "text",
                "text": "Inventory · order · vendor exceptions + calls · prep · receive Mon drops\n3–5 mgmt hrs (inventory, order) + 2–3 prep"
              }
            ]
          },
          {
            "id": "manager-week.b0.r1",
            "cells": [
              {
                "kind": "text",
                "text": "TUE"
              },
              {
                "kind": "text",
                "text": "OFF"
              },
              {
                "kind": "entry",
                "id": "manager-week.b0.r1.c2"
              }
            ]
          },
          {
            "id": "manager-week.b0.r2",
            "cells": [
              {
                "kind": "text",
                "text": "WED"
              },
              {
                "kind": "text",
                "text": "2–10 (8 hr)"
              },
              {
                "kind": "text",
                "text": "2–3 order · 3–4 setup + line ✓ + pre-shift · 4–9:30 service + task · 9:30–10 post-shift + sign-off\n3 mgmt hrs — pars + quality control + order · 5 cook"
              }
            ]
          },
          {
            "id": "manager-week.b0.r3",
            "cells": [
              {
                "kind": "text",
                "text": "THU"
              },
              {
                "kind": "text",
                "text": "2–10 (8 hr)"
              },
              {
                "kind": "text",
                "text": "2–3 inventory + order · receive Thu drops · 3–4 setup + line ✓ + pre-shift · 4–9:30 service + task · 9:30–10 post-shift + sign-off\n2.5 mgmt · 6.5 cook"
              }
            ]
          },
          {
            "id": "manager-week.b0.r4",
            "cells": [
              {
                "kind": "text",
                "text": "FRI + SAT"
              },
              {
                "kind": "text",
                "text": "1:30–10 (8.5 hr)"
              },
              {
                "kind": "text",
                "text": "1:30–3:30 mid-week prep · 3:30–4 pre-shift + setup + task · 4–9:30 service + task · 9:30–10 post-shift + sign-off"
              }
            ]
          },
          {
            "id": "manager-week.b0.r5",
            "cells": [
              {
                "kind": "text",
                "text": "SUN"
              },
              {
                "kind": "text",
                "text": "9:30–6 (8.5 hr)"
              },
              {
                "kind": "text",
                "text": "9:30–10:30 order · 10:30–11 store / setup / pre-shift · 11–5 service · 5–6 post-shift + sign-off"
              }
            ]
          }
        ]
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "Every service (~10 min)"
      },
      {
        "kind": "note",
        "text": "☐ **Gate:** walk line · taste one item (rotate sauce/dressing/protein) · one cold temp · sign every line-check sheet — service doesn't start unsigned\n☐ **Lull glance (7–8):** deep-clean moving? slammed → reassign out loud + write it\n☐ **Post-shift walk:** 2 random items per close list + today's deep-clean task · initial · fill EOD log"
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "Wednesday reset (10 min)"
      },
      {
        "kind": "note",
        "text": "☐ Score last week + post it ☐ Station of the Week ☐ Set prep pars ☐ Confirm monthly deep-clean task"
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "Agenda — today"
      },
      {
        "kind": "grid",
        "columns": [
          "Before doors",
          "Before close"
        ],
        "rows": [
          {
            "id": "manager-week.b6.r0",
            "cells": [
              {
                "kind": "text",
                "text": "1.\n2.\n3."
              },
              {
                "kind": "text",
                "text": "1.\n2.\n3."
              }
            ]
          }
        ]
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "Follow-ups"
      },
      {
        "kind": "grid",
        "columns": [
          "Who",
          "What",
          "By when",
          "Done"
        ],
        "rows": [
          {
            "id": "manager-week.b8.r0",
            "cells": [
              {
                "kind": "entry",
                "id": "manager-week.b8.r0.c0"
              },
              {
                "kind": "entry",
                "id": "manager-week.b8.r0.c1"
              },
              {
                "kind": "entry",
                "id": "manager-week.b8.r0.c2"
              },
              {
                "kind": "check",
                "id": "manager-week.b8.r0.c3",
                "text": ""
              }
            ]
          },
          {
            "id": "manager-week.b8.r1",
            "cells": [
              {
                "kind": "entry",
                "id": "manager-week.b8.r1.c0"
              },
              {
                "kind": "entry",
                "id": "manager-week.b8.r1.c1"
              },
              {
                "kind": "entry",
                "id": "manager-week.b8.r1.c2"
              },
              {
                "kind": "check",
                "id": "manager-week.b8.r1.c3",
                "text": ""
              }
            ]
          },
          {
            "id": "manager-week.b8.r2",
            "cells": [
              {
                "kind": "entry",
                "id": "manager-week.b8.r2.c0"
              },
              {
                "kind": "entry",
                "id": "manager-week.b8.r2.c1"
              },
              {
                "kind": "entry",
                "id": "manager-week.b8.r2.c2"
              },
              {
                "kind": "check",
                "id": "manager-week.b8.r2.c3",
                "text": ""
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "slug": "eod-log",
    "title": "EOD Manager Log",
    "blurb": "End of night sign-off.",
    "tier": "manager",
    "blocks": [
      {
        "kind": "fields",
        "parts": [
          {
            "kind": "field",
            "id": "eod-log.b0.f0",
            "label": "Week of"
          },
          {
            "kind": "static",
            "text": "fill during post-shift + sign-off (9:30–10"
          },
          {
            "kind": "static",
            "text": "Sun 5–6)"
          }
        ]
      },
      {
        "kind": "grid",
        "columns": [
          "",
          "Wed",
          "Thu",
          "Fri",
          "Sat",
          "Sun"
        ],
        "rows": [
          {
            "id": "eod-log.b1.r0",
            "cells": [
              {
                "kind": "text",
                "text": "Covers / sales feel"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r0.c1"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r0.c2"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r0.c3"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r0.c4"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r0.c5"
              }
            ]
          },
          {
            "id": "eod-log.b1.r1",
            "cells": [
              {
                "kind": "text",
                "text": "86s tonight"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r1.c1"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r1.c2"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r1.c3"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r1.c4"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r1.c5"
              }
            ]
          },
          {
            "id": "eod-log.b1.r2",
            "cells": [
              {
                "kind": "text",
                "text": "Waste — top item"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r2.c1"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r2.c2"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r2.c3"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r2.c4"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r2.c5"
              }
            ]
          },
          {
            "id": "eod-log.b1.r3",
            "cells": [
              {
                "kind": "text",
                "text": "Comps / voids / remakes"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r3.c1"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r3.c2"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r3.c3"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r3.c4"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r3.c5"
              }
            ]
          },
          {
            "id": "eod-log.b1.r4",
            "cells": [
              {
                "kind": "text",
                "text": "Equipment issues"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r4.c1"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r4.c2"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r4.c3"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r4.c4"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r4.c5"
              }
            ]
          },
          {
            "id": "eod-log.b1.r5",
            "cells": [
              {
                "kind": "text",
                "text": "Temps / food safety OK?"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r5.c1"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r5.c2"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r5.c3"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r5.c4"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r5.c5"
              }
            ]
          },
          {
            "id": "eod-log.b1.r6",
            "cells": [
              {
                "kind": "text",
                "text": "Deep-clean done (or moved to)"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r6.c1"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r6.c2"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r6.c3"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r6.c4"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r6.c5"
              }
            ]
          },
          {
            "id": "eod-log.b1.r7",
            "cells": [
              {
                "kind": "text",
                "text": "Line checks signed"
              },
              {
                "kind": "check",
                "id": "eod-log.b1.r7.c1",
                "text": ""
              },
              {
                "kind": "check",
                "id": "eod-log.b1.r7.c2",
                "text": ""
              },
              {
                "kind": "check",
                "id": "eod-log.b1.r7.c3",
                "text": ""
              },
              {
                "kind": "check",
                "id": "eod-log.b1.r7.c4",
                "text": ""
              },
              {
                "kind": "check",
                "id": "eod-log.b1.r7.c5",
                "text": ""
              }
            ]
          },
          {
            "id": "eod-log.b1.r8",
            "cells": [
              {
                "kind": "text",
                "text": "People notes"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r8.c1"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r8.c2"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r8.c3"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r8.c4"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r8.c5"
              }
            ]
          },
          {
            "id": "eod-log.b1.r9",
            "cells": [
              {
                "kind": "text",
                "text": "Thaw / brine started (+24/48 hr)"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r9.c1"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r9.c2"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r9.c3"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r9.c4"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r9.c5"
              }
            ]
          },
          {
            "id": "eod-log.b1.r10",
            "cells": [
              {
                "kind": "text",
                "text": "Order add-ons needed"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r10.c1"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r10.c2"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r10.c3"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r10.c4"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r10.c5"
              }
            ]
          },
          {
            "id": "eod-log.b1.r11",
            "cells": [
              {
                "kind": "text",
                "text": "Tomorrow's top 3"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r11.c1"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r11.c2"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r11.c3"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r11.c4"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r11.c5"
              }
            ]
          },
          {
            "id": "eod-log.b1.r12",
            "cells": [
              {
                "kind": "text",
                "text": "Sign-off (initials + time)"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r12.c1"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r12.c2"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r12.c3"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r12.c4"
              },
              {
                "kind": "entry",
                "id": "eod-log.b1.r12.c5"
              }
            ]
          }
        ]
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "Week close (Sunday post-shift)"
      },
      {
        "kind": "fields",
        "parts": [
          {
            "kind": "field",
            "id": "eod-log.b3.f0",
            "label": "Week score for Wednesday posting: A"
          },
          {
            "kind": "field",
            "id": "eod-log.b3.f1",
            "label": "B"
          },
          {
            "kind": "field",
            "id": "eod-log.b3.f2",
            "label": "C"
          },
          {
            "kind": "field",
            "id": "eod-log.b3.f3",
            "label": "Station of the Week"
          }
        ]
      },
      {
        "kind": "fields",
        "parts": [
          {
            "kind": "static",
            "text": "Carried to Monday (inventory / order / vendor exceptions):"
          },
          {
            "kind": "field",
            "id": "eod-log.b4.f0",
            "label": "Note"
          }
        ]
      },
      {
        "kind": "fields",
        "parts": [
          {
            "kind": "field",
            "id": "eod-log.b5.f0",
            "label": "Follow-ups into next week"
          }
        ]
      }
    ]
  },
  {
    "slug": "sop-grille",
    "title": "Station SOP — Grille / Sauté",
    "blurb": "Grille and sauté — setup to close.",
    "tier": "cook",
    "blocks": [
      {
        "kind": "heading",
        "level": 2,
        "text": "Setup (3:00–3:40)"
      },
      {
        "kind": "tasks",
        "ordered": true,
        "rows": [
          {
            "id": "sop-grille.b1.r0",
            "who": null,
            "task": "Ovens, grill, salamander ON · sani bucket + towels · unwrap drawers / lowboy proteins"
          },
          {
            "id": "sop-grille.b1.r1",
            "who": null,
            "task": "Heat sauces: green chili ½+⅙ · queso ½+⅙ · chicken jus 1/9 · birria ⅓ · consommé ⅓"
          },
          {
            "id": "sop-grille.b1.r2",
            "who": null,
            "task": "Bacon jam 1 qt in ⅙ chafe with water, right of flattop · S&P 1/9 insert"
          },
          {
            "id": "sop-grille.b1.r3",
            "who": null,
            "task": "Clarified butter bottle topped + 2 qt backup tempering · oil + wine topped · temper honey + herb butter"
          },
          {
            "id": "sop-grille.b1.r4",
            "who": null,
            "task": "Stock buns, sourdough, boule · 4.5\" white corn + flour tortillas"
          },
          {
            "id": "sop-grille.b1.r5",
            "who": null,
            "task": "Protein backups: under ⅔ burgers / ⅓ jefe / ⅓ cooked bacon → pull, portion, cook · 6 orders chicken + cod · ⅓ pan on ice: 5 orders trout + pork chop"
          },
          {
            "id": "sop-grille.b1.r6",
            "who": null,
            "task": "Blanch asparagus 15–20 sec heavily seasoned boiling water, shock in ice"
          },
          {
            "id": "sop-grille.b1.r7",
            "who": null,
            "task": "Lettuce 3/3 · tomatoes 2/6 · one backup of all roll-top items · noodles, burger prep, 1 qt shredded cheese below"
          },
          {
            "id": "sop-grille.b1.r8",
            "who": null,
            "task": "Ramekins stocked · plates forward"
          }
        ]
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "Line check (3:45 — manager signs)"
      },
      {
        "kind": "note",
        "text": "Cornbread · mayo · bacon jam · burger pickles · special sauce · thawed buns (+ GF) · impossible burgers · thawed burgers · chorizo patties · brined pork chop · par-cooked bacon · birria beef · consommé · sliced tomatoes · lettuce · mozzarella · pickled red onion · grain mustard (HH) · pepper jack · white cheddar · quesa birria cheese · honey butter · clarified butter · sourdough whole + sliced · oil · beer cheese (HH) · pretzels (HH) · par-cooked noodles · toasted panko · tortillas · confit chicken · chicken jus · trout thawed + cleaned · minced garlic · capers · lemon halves · white wine · asparagus"
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "Close (8:30–10)"
      },
      {
        "kind": "note",
        "text": "Restock + flip · refill sauce bottles · wipe + sweep · drip pans · trash · equipment off · clean grill · proteins wrapped → walk-in · sanitize · season flattop · hood drip pans · deck-brush floor · clean range · check GFI · closing line check — note tomorrow's needs"
      }
    ]
  },
  {
    "slug": "sop-fry-garde",
    "title": "Station SOP — Fry & Garde",
    "blurb": "Fry and garde — setup to close.",
    "tier": "cook",
    "blocks": [
      {
        "kind": "heading",
        "level": 2,
        "text": "Fry setup (3:00–3:40)"
      },
      {
        "kind": "tasks",
        "ordered": true,
        "rows": [
          {
            "id": "sop-fry-garde.b1.r0",
            "who": null,
            "task": "Fryers ON — left two @ 350, right @ 305 · sani buckets + towels · unwrap lowboy"
          },
          {
            "id": "sop-fry-garde.b1.r1",
            "who": null,
            "task": "Sauces: buffalo · thai chili · bama · nashville oil · BBQ · Toppings: B&B pickles + 1 qt slaw"
          },
          {
            "id": "sop-fry-garde.b1.r2",
            "who": null,
            "task": "Seasonings: 1/9 salt, green salt, lariat rub, nash rub"
          },
          {
            "id": "sop-fry-garde.b1.r3",
            "who": null,
            "task": "Freezer: 1 case each — regular fries, sweets, chicken wings, tenders, roasted roots"
          },
          {
            "id": "sop-fry-garde.b1.r4",
            "who": null,
            "task": "½ pan chicken flour · mix 4 qt beer flour + 4 qt guinness-vodka blend — **wet added right before service**"
          },
          {
            "id": "sop-fry-garde.b1.r5",
            "who": null,
            "task": "Mixing bowls, large ceramic salad bowls, large ceramic plates"
          }
        ]
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "Fry line check (3:45)"
      },
      {
        "kind": "note",
        "text": "Chicken seasoned flour · chicken brined · nash rub · nashville oil · beer batter (wet at service) · brined fish · brined chicken · pig wings thawed · B&B pickles · bama · buffalo · lariat rub · fries · sweet fries · chicken wings · churros · chips · tenders · cinnamon-sugar mix · thai chili · root veg · furikake (HH) · miso/honey (HH)"
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "Garde setup (3:00–3:40)"
      },
      {
        "kind": "tasks",
        "ordered": true,
        "rows": [
          {
            "id": "sop-fry-garde.b5.r0",
            "who": null,
            "task": "Sani bucket + towels · unwrap + restock lowboy"
          },
          {
            "id": "sop-fry-garde.b5.r1",
            "who": null,
            "task": "Pull sauces from under lowboy, refill all"
          },
          {
            "id": "sop-fry-garde.b5.r2",
            "who": null,
            "task": "Stock ceramic ramekins, large/small bowls, silver bullets · heat lamps ON"
          }
        ]
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "Garde line check (3:45)"
      },
      {
        "kind": "note",
        "text": "Croutons · chipotle aioli · lemon thyme vinaigrette · coleslaw dressing · slaw NE · slaw mexican · pico · aji verde · grilled onions · roasted pepitas · succotash · caesar · tartar · banana pudding · tomato confit · chocolate cake · bama · herb blue cheese dressing · mixed greens · lime wedges · romaine · cotija · avocados · cucumbers · sliced cherry tomato · raw red onion · blue cheese crumble · balsamic glaze · italian chimichurri · carrot/celery sticks · sliced hard egg · chopped bacon"
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "Close (8:30–10)"
      },
      {
        "kind": "note",
        "text": "**Fry:** restock + flip · prep sink · trash · wrap line · fryers off + **filter oil** · boards to dish (bleach every other day) · sanitize · sweep · GFI · closing line check. **Garde:** restock + flip · wrap lowboy · sanitize · sweep · lamps off with expo."
      }
    ]
  },
  {
    "slug": "sop-expo-dish",
    "title": "Station SOP — Expo & Dish Pit",
    "blurb": "Expo and dish pit — setup to close.",
    "tier": "cook",
    "blocks": [
      {
        "kind": "heading",
        "level": 2,
        "text": "Expo setup (3:00–3:40)"
      },
      {
        "kind": "tasks",
        "ordered": true,
        "rows": [
          {
            "id": "sop-expo-dish.b1.r0",
            "who": null,
            "task": "Steam table refilled + ON · cutting board + hotel pan for sauces/toppings"
          },
          {
            "id": "sop-expo-dish.b1.r1",
            "who": null,
            "task": "Spoon bucket + ⅙ pan bev napkins"
          },
          {
            "id": "sop-expo-dish.b1.r2",
            "who": null,
            "task": "Deli cups: 3 qt blackened salsa · 2 qt tomatillo · 1 qt limes · 1 qt furikake · 2 qt mexi-relish (not Sunday)"
          },
          {
            "id": "sop-expo-dish.b1.r3",
            "who": null,
            "task": "Chips restocked, baskets lined · heat lamp ON · Toast counts entered"
          }
        ]
      },
      {
        "kind": "note",
        "text": "**During service:** 86 board + Toast counts current · quality gate every plate — build, garnish, temp, clean rim · call and pace tickets · non-matching plate goes back."
      },
      {
        "kind": "note",
        "text": "**Expo close:** sauce bottles refilled · wrap / ice-bath steamwell contents · steamwells + lamps off · ceramics restock · dump hot well **before dish machine drains** · sanitize · tomorrow's Toast counts + 86 risks."
      },
      {
        "kind": "heading",
        "level": 2,
        "text": "Dish pit — shift"
      },
      {
        "kind": "note",
        "text": "**5:00 in:** break down prep boxes · wash prep dishes · silverware + bullets for the rush · fresh liner. **6:30–7:00:** service dishes · 1/6, 1/3, ½ pans back for station flip. **8:00:** plates + bullets cycling."
      },
      {
        "kind": "note",
        "text": "**Machine:** seat scrap screens + drain plug, fill, one empty cycle to posted temp, check chemical lines. Every rack: scrape → pre-rinse → rack right (plates in pegs, cups face-down, pans angled, silverware loose, presoak crusted) → full racks only in rush → air dry. Clear scrap screens hourly · change cloudy water · sanitizer strip once/shift (fail → tell manager, switch to three-sink). **Never in machine:** knives (hand wash, return immediately), wood, nonstick."
      },
      {
        "kind": "note",
        "text": "**Three-sink:** wash hot + detergent → rinse → sanitize (labeled concentration, test strip) → air dry. **Rush priority:** line's pans → bullets/silverware → plates → everything else."
      },
      {
        "kind": "note",
        "text": "**Chemical safety:** never mix chemicals · gloves for bleach/boards · apron at machine · squeegee wet floor immediately · know the SDS binder · report every cut/burn same shift."
      },
      {
        "kind": "note",
        "text": "**Close (8:30–10):** remaining pans/spatulas/fry baskets · silverware for rolling · sinks + drains · bleach cutting boards · drain + power off machine · sweep + trash · dump expo hot well · scrub line with floor sanitizer + deck brush · squeegee to floor drain."
      }
    ]
  },
  {
    "slug": "recipe-index",
    "title": "Recipe Book Index",
    "blurb": "Every recipe card on file.",
    "tier": "cook",
    "blocks": [
      {
        "kind": "note",
        "text": "Master: Lariat Recipe Book (MASTER pdf) · ☐ = printed card in the book · initial = cook signed off (matches training matrix) · no recipe cooks from memory — missing card → flag the KM"
      },
      {
        "kind": "grid",
        "columns": [
          "Sauces & dressings",
          "☐",
          "Signed",
          "Salsas · pickles · brines · batters",
          "☐",
          "Signed"
        ],
        "rows": [
          {
            "id": "recipe-index.b1.r0",
            "cells": [
              {
                "kind": "text",
                "text": "Aji verde"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r0.c1",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r0.c2"
              },
              {
                "kind": "text",
                "text": "Blackened tomato salsa"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r0.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r0.c5"
              }
            ]
          },
          {
            "id": "recipe-index.b1.r1",
            "cells": [
              {
                "kind": "text",
                "text": "Alabama white sauce"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r1.c1",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r1.c2"
              },
              {
                "kind": "text",
                "text": "Tomatillo salsa"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r1.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r1.c5"
              }
            ]
          },
          {
            "id": "recipe-index.b1.r2",
            "cells": [
              {
                "kind": "text",
                "text": "Chipotle aioli"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r2.c1",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r2.c2"
              },
              {
                "kind": "text",
                "text": "Pico de gallo"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r2.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r2.c5"
              }
            ]
          },
          {
            "id": "recipe-index.b1.r3",
            "cells": [
              {
                "kind": "text",
                "text": "Chimichurri"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r3.c1",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r3.c2"
              },
              {
                "kind": "text",
                "text": "Mexi relish"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r3.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r3.c5"
              }
            ]
          },
          {
            "id": "recipe-index.b1.r4",
            "cells": [
              {
                "kind": "text",
                "text": "Cobb dressing"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r4.c1",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r4.c2"
              },
              {
                "kind": "text",
                "text": "Pickles"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r4.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r4.c5"
              }
            ]
          },
          {
            "id": "recipe-index.b1.r5",
            "cells": [
              {
                "kind": "text",
                "text": "Honey mustard"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r5.c1",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r5.c2"
              },
              {
                "kind": "text",
                "text": "Rope pickle"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r5.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r5.c5"
              }
            ]
          },
          {
            "id": "recipe-index.b1.r6",
            "cells": [
              {
                "kind": "text",
                "text": "Lemon thyme vinaigrette"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r6.c1",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r6.c2"
              },
              {
                "kind": "text",
                "text": "Buttermilk brine"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r6.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r6.c5"
              }
            ]
          },
          {
            "id": "recipe-index.b1.r7",
            "cells": [
              {
                "kind": "text",
                "text": "Miso honey"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r7.c1",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r7.c2"
              },
              {
                "kind": "text",
                "text": "Fish brine"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r7.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r7.c5"
              }
            ]
          },
          {
            "id": "recipe-index.b1.r8",
            "cells": [
              {
                "kind": "text",
                "text": "Santa Fe caesar"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r8.c1",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r8.c2"
              },
              {
                "kind": "text",
                "text": "Pork chop marinade"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r8.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r8.c5"
              }
            ]
          },
          {
            "id": "recipe-index.b1.r9",
            "cells": [
              {
                "kind": "text",
                "text": "Special sauce"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r9.c1",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r9.c2"
              },
              {
                "kind": "text",
                "text": "Beer batter"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r9.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r9.c5"
              }
            ]
          },
          {
            "id": "recipe-index.b1.r10",
            "cells": [
              {
                "kind": "text",
                "text": "Tartar sauce"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r10.c1",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r10.c2"
              },
              {
                "kind": "text",
                "text": "Beer flour"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r10.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r10.c5"
              }
            ]
          },
          {
            "id": "recipe-index.b1.r11",
            "cells": [
              {
                "kind": "text",
                "text": "Thai chili sauce"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r11.c1",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r11.c2"
              },
              {
                "kind": "text",
                "text": "Chicken flour"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r11.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r11.c5"
              }
            ]
          },
          {
            "id": "recipe-index.b1.r12",
            "cells": [
              {
                "kind": "text",
                "text": "Queso / mac sauce"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r12.c1",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r12.c2"
              },
              {
                "kind": "text",
                "text": "Corndog batter"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r12.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r12.c5"
              }
            ]
          },
          {
            "id": "recipe-index.b1.r13",
            "cells": [
              {
                "kind": "entry",
                "id": "recipe-index.b1.r13.c0"
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r13.c1"
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r13.c2"
              },
              {
                "kind": "text",
                "text": "French toast batter"
              },
              {
                "kind": "check",
                "id": "recipe-index.b1.r13.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b1.r13.c5"
              }
            ]
          }
        ]
      },
      {
        "kind": "grid",
        "columns": [
          "Rubs & seasonings",
          "☐",
          "Signed",
          "Proteins · mains · sides · sweets",
          "☐",
          "Signed"
        ],
        "rows": [
          {
            "id": "recipe-index.b2.r0",
            "cells": [
              {
                "kind": "text",
                "text": "Lariat rub"
              },
              {
                "kind": "check",
                "id": "recipe-index.b2.r0.c1",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r0.c2"
              },
              {
                "kind": "text",
                "text": "Birria"
              },
              {
                "kind": "check",
                "id": "recipe-index.b2.r0.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r0.c5"
              }
            ]
          },
          {
            "id": "recipe-index.b2.r1",
            "cells": [
              {
                "kind": "text",
                "text": "Nashville hot rub"
              },
              {
                "kind": "check",
                "id": "recipe-index.b2.r1.c1",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r1.c2"
              },
              {
                "kind": "text",
                "text": "Chicken confit"
              },
              {
                "kind": "check",
                "id": "recipe-index.b2.r1.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r1.c5"
              }
            ]
          },
          {
            "id": "recipe-index.b2.r2",
            "cells": [
              {
                "kind": "text",
                "text": "Nashville oil"
              },
              {
                "kind": "check",
                "id": "recipe-index.b2.r2.c1",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r2.c2"
              },
              {
                "kind": "text",
                "text": "Chicken jus"
              },
              {
                "kind": "check",
                "id": "recipe-index.b2.r2.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r2.c5"
              }
            ]
          },
          {
            "id": "recipe-index.b2.r3",
            "cells": [
              {
                "kind": "text",
                "text": "QB seasoning"
              },
              {
                "kind": "check",
                "id": "recipe-index.b2.r3.c1",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r3.c2"
              },
              {
                "kind": "text",
                "text": "Green chile"
              },
              {
                "kind": "check",
                "id": "recipe-index.b2.r3.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r3.c5"
              }
            ]
          },
          {
            "id": "recipe-index.b2.r4",
            "cells": [
              {
                "kind": "entry",
                "id": "recipe-index.b2.r4.c0"
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r4.c1"
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r4.c2"
              },
              {
                "kind": "text",
                "text": "Mesa melt"
              },
              {
                "kind": "check",
                "id": "recipe-index.b2.r4.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r4.c5"
              }
            ]
          },
          {
            "id": "recipe-index.b2.r5",
            "cells": [
              {
                "kind": "entry",
                "id": "recipe-index.b2.r5.c0"
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r5.c1"
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r5.c2"
              },
              {
                "kind": "text",
                "text": "Three cheese grilled cheese"
              },
              {
                "kind": "check",
                "id": "recipe-index.b2.r5.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r5.c5"
              }
            ]
          },
          {
            "id": "recipe-index.b2.r6",
            "cells": [
              {
                "kind": "entry",
                "id": "recipe-index.b2.r6.c0"
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r6.c1"
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r6.c2"
              },
              {
                "kind": "text",
                "text": "Tomato soup"
              },
              {
                "kind": "check",
                "id": "recipe-index.b2.r6.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r6.c5"
              }
            ]
          },
          {
            "id": "recipe-index.b2.r7",
            "cells": [
              {
                "kind": "entry",
                "id": "recipe-index.b2.r7.c0"
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r7.c1"
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r7.c2"
              },
              {
                "kind": "text",
                "text": "Bacon jam"
              },
              {
                "kind": "check",
                "id": "recipe-index.b2.r7.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r7.c5"
              }
            ]
          },
          {
            "id": "recipe-index.b2.r8",
            "cells": [
              {
                "kind": "entry",
                "id": "recipe-index.b2.r8.c0"
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r8.c1"
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r8.c2"
              },
              {
                "kind": "text",
                "text": "Black bean & corn succotash"
              },
              {
                "kind": "check",
                "id": "recipe-index.b2.r8.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r8.c5"
              }
            ]
          },
          {
            "id": "recipe-index.b2.r9",
            "cells": [
              {
                "kind": "entry",
                "id": "recipe-index.b2.r9.c0"
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r9.c1"
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r9.c2"
              },
              {
                "kind": "text",
                "text": "Coleslaw · mexi slaw"
              },
              {
                "kind": "check",
                "id": "recipe-index.b2.r9.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r9.c5"
              }
            ]
          },
          {
            "id": "recipe-index.b2.r10",
            "cells": [
              {
                "kind": "entry",
                "id": "recipe-index.b2.r10.c0"
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r10.c1"
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r10.c2"
              },
              {
                "kind": "text",
                "text": "Cornbread"
              },
              {
                "kind": "check",
                "id": "recipe-index.b2.r10.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r10.c5"
              }
            ]
          },
          {
            "id": "recipe-index.b2.r11",
            "cells": [
              {
                "kind": "entry",
                "id": "recipe-index.b2.r11.c0"
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r11.c1"
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r11.c2"
              },
              {
                "kind": "text",
                "text": "Herbal butter · honey butter"
              },
              {
                "kind": "check",
                "id": "recipe-index.b2.r11.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r11.c5"
              }
            ]
          },
          {
            "id": "recipe-index.b2.r12",
            "cells": [
              {
                "kind": "entry",
                "id": "recipe-index.b2.r12.c0"
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r12.c1"
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r12.c2"
              },
              {
                "kind": "text",
                "text": "Roasted pepitas"
              },
              {
                "kind": "check",
                "id": "recipe-index.b2.r12.c4",
                "text": ""
              },
              {
                "kind": "entry",
                "id": "recipe-index.b2.r12.c5"
              }
            ]
          }
        ]
      }
    ]
  }
];
