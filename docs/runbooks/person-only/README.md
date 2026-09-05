# Person-only runbooks

Steps only Sean can close — a human at the venue Mac, a live decision, or a
physical action. One file per step; agents add a runbook here whenever they
hit an owner gate (see `AGENTS.md` § Person-only operations). In Claude Code,
`/person-only` builds the live queue; `/person-only <slug>` walks one step.

Template: **Why only you** / **When** / **Takes** / **Steps** / **Done when**.

| Slug | Step | Status |
| --- | --- | --- |
| [go-live-venue-data](go-live-venue-data.md) | Decide + verify the data the venue runs on | **OPEN — decide before service 2026-09-02** |
| [go-live-pin-login](go-live-pin-login.md) | One real manager PIN login on the serving Mac | DONE 2026-09-02 — verified, incl. `LARIAT_PIN` fix |
| [go-live-print-pack](go-live-print-pack.md) | Print the paper fallback + outage card | **OPEN** — printing deferred 2026-09-02; PDFs staged, print when ready |
