# Cooler & Station Layout Diagrams

How to read these:

- **Food-safety order** — in the walk-in, product is stacked top-to-bottom in the
  order: RTE → seafood → whole cuts → ground → poultry. If you find raw
  chicken above lettuce, you fix it before anything else.
- **Color coding** — the diagrams use muted color only where it aids safety:
  cold-chain items read in a cool neutral, hot-hold in a warm neutral, RTE
  (ready-to-eat) gets the accent. No decorative color, no gradients.
- **Station layout diagrams** reproduce the actual grid layout from the paper
  diagrams in `data/imports/drive-kitchen-ops-20260421/`, not an idealized
  version — so what's on the iPad matches what's on the line.

---

## The diagrams

| File                                                                 | What it shows                                            | Source                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------- |
| [kitchen-floor-plan.svg](kitchen-floor-plan.svg)                     | Overhead — stations, walk-ins, lowboys, flow             | composed from Setups.docx                |
| [walk-in-cooler.svg](walk-in-cooler.svg)                             | Shelf layout, food-safety top-to-bottom order            | HACCP standard + Lariat convention       |
| [walk-in-freezer.svg](walk-in-freezer.svg)                           | Freezer shelf layout                                     | standard + Lariat convention             |
| [fryer-lowboy-top.svg](fryer-lowboy-top.svg)                         | Top-station pan layout — 6 cells                         | `FRYER_LOWBOY TOP STATION.xlsx`          |
| [fryer-freezer.svg](fryer-freezer.svg)                               | Fry freezer — 3 rows × 2 cols                            | `FRYRER_FREEZER DIAGRAM.xlsx`            |
| [grill-lowboy.svg](grill-lowboy.svg)                                 | Grill/saute lowboy + roll top                            | `GRILL SET-UP.xlsx` narrative            |
| [salad-lowboy.svg](salad-lowboy.svg)                                 | Salad top-well + cold prep positions                     | `SALAD SET UP.xlsx`                      |

---

## Editing

These are hand-drawn SVG files — open in any vector editor (or a text editor).
When the layout changes in the kitchen, update the SVG and commit with a note
in [../INDEX.md](../INDEX.md)'s change log.
