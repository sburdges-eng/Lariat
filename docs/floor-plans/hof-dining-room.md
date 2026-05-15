# HOF — dining-room + bar floor plan

**Source.** Hand-drawn floor-plan sheet at
`/Users/seanburdges/Desktop/Equipment photos/IMG_4885.HEIC` (photographed
2026-05-11). This is the authoritative table-map for the room; everything
below is transcribed from that sheet.

## Zone layout (top → bottom of the photo)

```
┌─────────────────────────── STAGE ────────────────────────────┐
│                                                              │
│  41   42  43   44   45   46   47   48   49                   │
│                                                              │
│  31   32  33   34   35   36   37                             │
│                                                              │
│  21   22  23   24   25   26                                  │
│                                  CS    CM    CN              │
│                                                              │
│        ────  BAR  ────                                       │
│       ○ ○ ○ ○ ○ ○ ○ ○        ROUND                          │
│                                                              │
│  P1                                                          │
│        ┌── FRONT PATIO ─┐                                    │
│  P2    │ 11 12 13 14 15 16                                   │
│        └────────────────┘                                    │
└──────────────────────────────────────────────────────────────┘
```

## Sections

### Stage (top center)
Performance / live-music area at the back wall. No table count.

### Main dining (mid)
Three banks of numbered tables running parallel to the stage:
- **Row 4x** (back, closest to stage): tables `41 42 43 44 45 46 47 48 49` (9 tops).
- **Row 3x** (middle): tables `31 32 33 34 35 36 37` (7 tops).
- **Row 2x** (front of room): tables `21 22 23 24 25 26` (6 tops).

`CS / CM / CN` — three labelled seats abutting the right wall in the
2x row. Could be "Counter South / Middle / North" or
"Center-Stage / Middle / North"; semantics need an operator confirm.

### Bar (middle of room, vertical row)
A row of round bar stools (`○ ○ ○ ○ ○ ○ ○ ○`) running vertically through
the middle of the floor. Marked **BAR**. Adjacent label **ROUND** is
the round high-top table at the bar's end.

### Pool area (lower left)
`P1` and `P2` — two pool tables in the front-left corner.

### Front patio (lower right)
Outdoor patio with 6 tops: `11 12 13 14 15 16`.

## Table numbering convention

- **2x** = front row of indoor dining
- **3x** = middle row
- **4x** = back row (stage-adjacent)
- **1x** = patio
- **P1, P2** = pool tables
- **CS / CM / CN** = right-wall counter seats (label semantics TBD)
- **ROUND** = high-top by the bar

## Location-zone IDs (for use as `location_id` extensions)

The Lariat schema uses `location_id` for multi-venue scoping. For
within-HOF zone tagging on equipment + checks, the recommended sub-zone
keys (use `location_zone` column in the inventory CSV; treat as
informational until a true multi-zone migration ships):

| zone | use case |
|---|---|
| `kitchen` | cookline, prep, dish pit, walk-in entry |
| `bar` | bar back / under-bar coolers / glycol / kegs |
| `dining` | dining-room IoT (e.g. wired thermostats), no equipment expected |
| `patio` | patio heaters, outdoor lighting |
| `back_of_house` | water heater, hood control panel, breaker panel, fire suppression |
| `storage` | spare parts / replacement lamps / dry goods shelves |

## Update history

- **2026-05-14** — initial transcription from IMG_4885 by automated
  vision read of the operator-provided sheet. No prior digital copy
  existed.

## Followups (operator-facing)

1. Confirm `CS / CM / CN` label meaning.
2. Decide whether to migrate `location_zone` to a real DB column
   (currently informational in the inventory CSV; the `equipment.location_id`
   column already supports per-venue scoping but doesn't slice further).
3. Photograph the kitchen overhead at a high angle so the cookline /
   prep / dish-pit / walk-in arrangement can be drawn as a sister
   document to this one.
