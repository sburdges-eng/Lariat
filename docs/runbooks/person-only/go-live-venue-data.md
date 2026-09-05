# Go-live: decide and verify the data the venue runs on

**Why only you:** which database is the venue's truth is a custody decision;
the real venue DB (if newer than what's on this Mac) is on the unmounted SSD.
**When:** before service starts 2026-09-02.
**Takes:** 5 minutes to decide; longer only if the SSD DB must be installed.

## Where things stand (as of 2026-09-02 morning)

- The server is running against `~/Library/Application Support/Lariat/data/lariat.db`
  — the hand-seeded DB from 2026-08-30 (real BEOs + your PIN imported).
- That DB has **no events dated today or later** (8 BEO events, latest
  2026-07-03) and **zero inventory counts**.
- A verified backup + passed restore drill exists at
  `backups/2026-09-02T11-11-34-266Z` (repo root).
- The SSD is not mounted (`test -d ~/Dev` fails), so no newer DB is reachable.

## Steps

Pick one:

1. **Run on this DB (fastest).** Sign off that its contents are the starting
   point, then enter today's BEO events by hand on the BEO board. Take an
   opening inventory count if counts are expected on day one.
2. **Install the real venue DB.** Mount the SSD (`test -d ~/Dev` must pass),
   locate the authoritative `lariat.db`, copy it to `<repo>/data/lariat.db`,
   **stop the running server first** (two writers on one WAL corrupt it), then
   `bash scripts/install-prod-data.sh` and restart with `npm run start`.

## Done when

The BEO board shows today's real events and you've said which DB is truth.
