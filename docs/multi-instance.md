# Multi-instance Lariat — scope and roadmap

## Status: foundation stub

Today Lariat is a single-machine local-first app. This document describes the
direction for running multiple Lariat instances on the same LAN (e.g. a hub box
plus iPad terminals, an upstairs/downstairs split, or a backup laptop in case
the primary dies). The current commit lands only the smallest piece of that
arc: **mDNS advertising + identity-confirmation HTTP route**. Everything else
listed below is deliberately *not* built yet.

## What is built (this commit)

- `lib/mdnsDiscovery.ts` — `advertise({port, hostname, locationId})` and
  `discover({timeoutMs})`. Service type `_lariat._tcp`. TXT record carries
  `version`, `location_id`, `started_at`. Graceful no-op on hosts without
  IPv4 multicast.
- `app/api/discover/route.js` — `GET` returns the local instance identity
  (`name`, `version`, `location_id`, `started_at`). Not PIN-gated; this is
  the call a peer makes immediately after seeing us via mDNS to confirm
  we're really Lariat.
- `scripts/start-mdns.mjs` — standalone responder. `npm run mdns:advertise`
  publishes; `npm run mdns:discover` lists peers and exits.
- `tests/js/test-mdns-discovery.mjs` — handle shape, no-throw contract,
  `/api/discover` shape. Cross-host discovery is **not** tested — it would
  require real multicast in CI.

## What is deliberately NOT built

The next agent should pick up from here. Each item below is its own scoped
phase; do not bundle.

1. **Hub election & failover.** When N Lariat instances are on the LAN, one
   should be the authoritative hub (writes go here, others mirror). The
   `started_at` TXT field already gives a tie-breaker. Election protocol +
   automatic failover when the hub disappears = future work.
2. **Cross-host sync of `data/lariat.db`.** Today each instance has its own
   SQLite file. A real multi-instance Lariat needs a sync layer — likely
   change-feed-based (write log per location, replicated via HTTP between
   hub and tablets). Conflict policy will need explicit thought because
   HACCP records are append-only but financial tables are DELETE+INSERT.
3. **Auth between peers.** `/api/discover` is intentionally unauthenticated
   so peers can find us. Anything beyond identity (sync endpoints,
   bidirectional commands) needs a shared secret or per-instance keypair.
   The mDNS TXT record is a reasonable place to advertise a public key
   fingerprint when we get there.
4. **Wiring into the dev/prod server.** Right now `npm run dev` does NOT
   start the mDNS responder — operators run it separately. Eventually we'll
   want a `next.config.mjs` hook (or a parent process supervisor) that
   brings the responder up alongside the HTTP server, with a single
   coordinated shutdown.
5. **launchd/systemd unit.** For the production single-machine deploy, the
   responder should restart on crash and come up at boot. A `.plist` for
   macOS lives in `ops/` for the rest of Lariat — add an mDNS sibling there
   when we promote this from stub to feature.
6. **UI surface.** A `/management/peers` page that lists discovered Lariat
   instances on the LAN, their version, their location, and a "claim as
   hub" button. None of this exists yet.

## Why mDNS first

iPads and other Lariat tablets shouldn't need an operator to type IP
addresses. mDNS (Bonjour) is the standard way to solve this on a LAN, it
works without any central server, and Apple devices natively understand it.
The alternative — a manual settings screen — pushes setup burden onto
already-busy kitchen managers and breaks every time DHCP hands out a new
address. Foundation primitive: get advertising right, build features on top.

## Service type and TXT record

```
_lariat._tcp
  version     = "<package.json version>"   e.g. "0.1.0"
  location_id = "<operator location key>"  e.g. "default", "upstairs"
  started_at  = "<ISO 8601 timestamp>"     e.g. "2026-05-01T12:34:56.789Z"
```

`_lariat._tcp` is the project-specific service name (RFC 6335). Future
sub-services (e.g. a dedicated sync endpoint that's not the public HTTP
port) can use subtypes like `_lariat._tcp,_sync` rather than registering
new top-level types.
