# Lariat Native — Edge-Server Blocker Log

**Living document.** Authoritative scope for the Phase D thin Next.js edge server.
Each entry is a surface that genuinely cannot be native (requires a public URL,
external client, or other capability a macOS/iPad app can't provide). The
`swift-port` agent appends here when it hits a hard blocker, then continues with
the rest of its feature — it does **not** force the blocker into Swift.

## Format

Append one entry per blocker:

```
### <surface> — <date discovered>
- **Web source:** <route(s) / file(s)>
- **Why it can't be native:** <reason>
- **What the edge server must keep:** <minimal residual responsibility>
- **Found by:** <pilot / wave / area>
```

---

## Blockers

### Guest BEO share-and-sign — 2026-06-30 (seed)
- **Web source:** `app/beo/share/[token]/`, the `SignForm`, `actor_source = beo_client_share`.
- **Why it can't be native:** an external client opens a public URL on their own
  phone/browser and e-signs. A macOS/iPad app cannot be the thing a guest opens
  via a link.
- **What the edge server must keep:** the tokenized public share route + the
  sign-and-confirm POST + its audited write.

### PWA / remote browser access — 2026-06-30 (seed)
- **Web source:** `app/install/`, PWA manifest/service worker, general remote
  browser access to the cockpit.
- **Why it can't be native:** remote/off-device access over a URL and installable
  web app are inherently web-server capabilities.
- **What the edge server must keep:** whichever read/remote surfaces are decided
  in scope at Phase D (TBD — narrow to the minimum actually used remotely).

### Cross-host sync transport (peers / cloud-bridge / sync_feed) — 2026-07-02
- **Web source:** `lib/peers.ts`, `lib/peerTrust.ts`, `lib/cloudBridge*.ts`,
  `app/management/{peers,cloud-bridge}`.
- **Why it can't be native:** the mDNS/HTTP peer transport, keypair trust, and
  cloud-bridge push/queue/replay require an HTTP server surface that listens
  for other hosts; the macOS/iPad app has no server surface. This is why the
  A5 `resolveMatch` port deliberately omits the web route's `appendOp`
  (`sync_feed`) call — the op log is the transport's input, and the transport
  stays on the edge.
- **What the edge server must keep:** the transport itself plus the
  `/management/peers` and `/management/cloud-bridge` admin pages, until a
  native read-only sync-status board lands (logged as a follow-up).
- **Found by:** A5 management-writes wave.
