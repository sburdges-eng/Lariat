# Test coverage — how to read the number

`npm run coverage` prints a line/branch/function percentage for the `tests/js`
suites. That number is real, and it is narrower than it looks. Read this before
quoting it anywhere.

## The number

At the time coverage was first instrumented (2026-07-28):

| Metric | Value | Floor |
| --- | --- | --- |
| Line | 85.39% | 85% |
| Branch | 81.66% | 81% |
| Function | 87.83% | 87% |

Floors live in `scripts/coverage-sweep.mjs` and ratchet — raise them as coverage
improves, never lower one silently. `npm run coverage -- --check` enforces them,
and CI runs it that way.

## The caveat that matters

**Node only instruments files it actually loads.** A module no test ever imports
does not show up as 0% — it does not show up at all. It is missing from the
denominator rather than dragging it down. So the headline percentage means
*"coverage of the files that get exercised"*, not *"coverage of the codebase"*,
and it flatters the untested parts of the tree by omitting them entirely.

The sweep therefore also prints loaded-file counts against what is on disk,
which is the number that tells you where the holes are:

| Tree | Files loaded | Files on disk |
| --- | --- | --- |
| `lib/` | 154 | 159 |
| `app/` | 135 | 364 |

So the same 85% is two different claims:

- **For `lib/`, it is a fair summary.** Nearly every module is exercised, so the
  percentage describes the layer.
- **For `app/`, it is not.** Roughly two-thirds of the app layer never executes
  in any test — mostly pages and components. Those files contribute nothing to
  the percentage in either direction.

This puts a number on something the project already believed. `CLAUDE.md` §7
records that the UI layer has consistently weaker coverage and more, and worse,
bugs than the API and lib layers, and that review attention should be weighted
accordingly. 135 of 364 is the measurement behind that instinct.

## What this means in practice

- Do not quote the headline number as codebase coverage. Quote it with the
  denominator, or quote the loaded-file counts instead.
- A coverage percentage going **up** can mean tests improved, or it can mean a
  well-tested file was added while the untested two-thirds stayed dark. Check
  the loaded-file counts before reading it as progress.
- The way to make the number honest is to raise `app/` file loading, not to
  raise the percentage. Adding a test that imports a page for the first time
  will usually push the percentage *down*, and that is an improvement.

## Exclusions

Four suites are excluded from the sweep, each with its reason in
`scripts/coverage-sweep.mjs`: three start a real mDNS responder, and one needs
an off-tree training snapshot. All four still run in `npm run verify`.
