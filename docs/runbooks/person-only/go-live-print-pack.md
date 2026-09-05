# Go-live: print the paper fallback + outage card

**Why only you:** printing and taping paper to a wall is a physical act.
**When:** before service starts 2026-09-02.
**Takes:** 5 minutes.

## Why it matters

Nothing supervises the server — a reboot, logout, or closed terminal kills
every board mid-service. Paper is the only fallback that cannot go down.

## Steps

1. Open `docs/boh/print/lariat-ops-packet.html` in a browser and print it.
   Put the packet on the line.
2. Open `docs/boh/print/outage-card.html` and print it. Fill in the Mac's IP
   (`ipconfig getifaddr en0`) and the on-call phone number with a pen. Tape it
   to the serving Mac.

## Done when

Both are printed, the card's blanks are filled in, and the card is on the Mac.
