# Cloud Bridge — Backend Decision

Status: **decided — Cloudflare Worker (D1) + per-location HMAC. Ed25519 migration tracked against Item 13.**

This document operationalizes the seam described in
[`docs/cloud-bridge-design.md`](./cloud-bridge-design.md). It does **not**
pre-decide. The operator picks the backend tier and authentication model;
this doc lays out the trade-offs, fixes the wire contract that holds either
way, and names the follow-on work each path unlocks.

Read this alongside:

- [`docs/cloud-bridge-design.md`](./cloud-bridge-design.md) — what the
  bridge is, what it isn't, the per-table allow/deny list rationale.
- [`lib/cloudBridgeQueue.ts`](../lib/cloudBridgeQueue.ts) — the durable
  outbox (allow-list, claim/ack/nack, dead-letter) the drainer reads from.
- [`lib/cloudBridge.ts`](../lib/cloudBridge.ts) — the `CloudBridge`
  interface; `pushSnapshot` currently throws `CLOUD_BRIDGE_NOT_IMPLEMENTED`.
- [`docs/multi-instance.md`](./multi-instance.md) — LAN peer discovery and
  the planned per-instance Ed25519 keypair (Item 13) this doc references.

---

## 1. What's already landed

Re-stated so the decision context is clear:

- **Outbox queue** (`lib/cloudBridgeQueue.ts`, PR #156). SQLite-backed
  FIFO keyed on `(table_name, location_id)`. Functions: `enqueue`,
  `claim`, `ack`, `nack`, `depth`, `deadLetterDepth`, `sweepStaleClaims`.
- **Allow-list** (canonical, enforced at enqueue):
  - `settlement_summaries` — end-of-night totals, coarse, no PII.
  - `beo_events` — banquet/event ops, already shared with sales/corp.
  - `spend_monthly` — monthly aggregate, no PII.
- **Deny-list** (explicit, never crosses the bridge):
  - `sales_lines` — per-transaction PII (staff/time/item linkage).
  - `sales_depletion_runs` — depletion ingest provenance, internal-only.
  - All temp-log / sick-worker / wage-action surfaces.
- **Retry budget**: `DEFAULT_MAX_ATTEMPTS = 5`, then dead-letter (still
  on disk for diagnostics, never re-claimed).
- **Sentinel**: `CLOUD_BRIDGE_NOT_IMPLEMENTED` on the bridge stub;
  `isCloudBridgeConfigured()` reports config presence without throwing.

What's **not** landed and is gated on this decision:

- The drainer (Item 8) that calls `claim` → `POST` → `ack`/`nack`.
- A real `pushSnapshot` body (Item 7) that replaces the sentinel.
- The cloud peer itself.

---

## 2. Options

Two serious candidates. Both can host the same wire contract (§5) and
the same auth model (§4); they differ on ops posture, blast radius, and
cost model.

### Option A — Cloudflare Worker (D1 + R2)

**Architecture sketch.**

```
[Lariat venue]                       [Cloudflare edge]
  outbox queue ──→ drainer ──HTTPS──→ Worker ──→ D1 (rows)
                                            └──→ R2 (large bodies, future)
```

- One Worker route per environment (`api.lariat.example/v1/snapshot`).
- D1 holds the canonical replicated rows, keyed
  `(location_id, table, batch_id)`. Idempotency dedup runs against D1.
- R2 is reserved for any future pre-staged blob the bridge needs to
  spool (e.g. a daily PDF settlement). Not used in the initial three
  tables.

**Pros.**

- Zero ops. No hosts to patch, no certs to rotate.
- Edge POPs — Lariat venues across geographies all hit a near peer.
- Cheap idle. Per-invocation pricing maps onto our bursty load
  (settlement at end-of-night, BEO writes during ops hours).
- Built-in TLS termination, DDoS posture, request logging.
- D1 transactions cover the per-batch insert cleanly.

**Cons.**

- **Row-size cap.** D1 row payload limit is small (~1 MB at the time of
  writing; verify against current Cloudflare docs before commit). For
  `settlement_summaries` and `spend_monthly` this is fine; for any
  future table that ships a wide JSON blob we'd have to split into R2.
- **Limited offline pre-staging.** This is the queue's job, not the
  cloud peer's — but the Worker can't help us prepare anything during
  a long WAN outage. The venue accumulates in `cloud_bridge_outbox`
  and ships when reachable. Acceptable, but worth naming.
- **Vendor lock for the bridge tier.** D1 is not portable; a swap
  later is a real rewrite of the cloud-side schema and migration.
  The wire contract (§5) is portable, so the venue side doesn't move.
- **Opaque debug surface.** Tail logs, `wrangler tail`, and the
  Cloudflare dashboard. Workable, but not as transparent as a host
  we shell into.
- **Compliance posture.** Cloudflare's data residency story is fine
  for our use case (US restaurant operators) but should be confirmed
  by whoever signs off on the agreement.

**Cost model — back-of-envelope.**

Assume 5 venues × 3 tables × ~20 batches/day = ~300 batches/day total,
~10 KB per batch. Annualized: ~110 K Worker invocations, ~1 GB writes.
Free tier likely absorbs this; paid Workers + D1 still well under
US$5/mo at this scale. Re-do this math if the table set grows.

### Option B — Self-hosted HTTPS endpoint

**Architecture sketch.**

```
[Lariat venue]                       [Lariat-owned host]
  outbox queue ──→ drainer ──HTTPS──→ Node service ──→ Postgres / SQLite
                                                  └──→ object store (optional)
```

- A small Node service (extend an existing internal service or stand
  up a new one). Single binary, single container.
- Backing store is operator's choice — Postgres if multi-region read
  patterns matter, SQLite-on-disk if not. The wire contract doesn't
  care.
- Fronted by a managed TLS termination (e.g. Caddy, an ALB, or
  fly.io's edge), or terminate in-process with autocert.

**Pros.**

- Full control. Schema evolves on our timeline; no per-row size cap;
  any future blob fits.
- Same ops muscles we already use for the venue stack — `journalctl`
  / `launchctl`, `psql` / `sqlite3`, no proprietary debug surface.
- No vendor lock for the bridge tier. The whole thing is portable.
- Pre-staging during long outages is unconstrained: if we ever want
  to ship a daily PDF or a multi-MB report alongside the rows, the
  endpoint just accepts it.

**Cons.**

- **TLS certificate lifecycle.** Renewal automation (Let's Encrypt or
  internal CA) is non-trivial to get right; an expired cert silently
  breaks the bridge. The drainer's retry budget hides this for ~5
  attempts then dead-letters; ops needs cert-expiry alerting that
  fires sooner than that.
- **Fail-over thinking.** A single host is a single point of failure
  for all venues' bridge traffic. Either accept that (the queue
  durably backs up locally during host downtime) or stand up a
  second host and a load balancer. Not free.
- **Additional ops burden.** Patches, OS upgrades, intrusion
  detection, log retention. Hours per quarter even when nothing's
  wrong.
- **No edge POPs.** Single-region latency. Acceptable for a batch
  push that runs nightly; worth naming if pull-direction sync (§
  out-of-scope here) ever becomes interactive.

**Cost model — back-of-envelope.**

A `t3.small` / Hetzner CX21 / fly.io shared-1x is ~US$5–15/mo plus
TLS (free with Let's Encrypt) plus storage. Comparable to Option A
in raw dollars; the real cost is operator-hours, not infra-dollars.

### Option summary

| Dimension              | Cloudflare Worker (A)         | Self-hosted (B)                |
|------------------------|-------------------------------|--------------------------------|
| Ops burden             | Near-zero                     | Real (TLS, patching, alerting) |
| Latency posture        | Edge POPs                     | Single region                  |
| Row-size ceiling       | Yes (~1 MB, verify)           | None                           |
| Pre-staging blobs      | R2-mediated, awkward          | Native                         |
| Vendor lock            | High (D1 schema)              | Low                            |
| Debug surface          | `wrangler tail`, dashboard    | `journalctl`, `psql`           |
| Fail-over              | Cloudflare-managed            | Operator-managed               |
| Marginal cost @ scale  | ~$0–5/mo                      | ~$5–15/mo + ops hours          |
| Time-to-first-push     | ~1 day (Worker + D1 schema)   | ~3 days (host + TLS + service) |

---

## 3. What does NOT depend on the choice

Pinning these now means Item 7 (real `pushSnapshot`) and Item 8 (drainer)
can be specced and reviewed before the operator picks a backend.

- The outbox queue, allow-list, claim/ack/nack semantics, dead-letter
  behavior, and `DEFAULT_MAX_ATTEMPTS=5` are settled.
- The wire contract (§5) is binding regardless of which side serves it.
- Idempotency lives server-side, keyed on `(location_id, batch_id)` —
  see §5.5.
- The auth model (§4) is the operator's pick, but the Ed25519 path is
  the natural alignment with Item 13 if it lands first.

---

## 4. Authentication model

Three candidates. The operator picks one.

### 4.1 mTLS client certificate

- **Strong.** Mutually authenticated, well-understood threat model.
- **Cert lifecycle is the catch.** Per-venue client certs need
  issuance (a small CA we run, or per-venue CSR-via-PIN flow), renewal
  automation, and revocation when a venue device is lost or replaced.
- Pairs well with Option B (self-hosted). Cloudflare Workers support
  mTLS via Cloudflare Access; doable but adds a control-plane step.

### 4.2 Shared-secret HMAC

- **Simple.** Per-location secret stored alongside `LARIAT_CLOUD_API_KEY`
  (which the bridge stub already reads from env / SQLite-backed config).
- Sign the request body + an idempotency-key header; verify server-side.
- Distribution is the hard part: the secret has to get to the venue
  somehow. The design doc points to the manager-PIN pairing flow at
  the iPad, which is acceptable, but rotation is a real workflow.

### 4.3 Ed25519 sign-of-body (recommended, gated on Item 13)

- Item 13 of the remaining-work plan adds a per-instance Ed25519
  keypair to each Lariat instance, advertised as a fingerprint in the
  mDNS TXT record (see `docs/multi-instance.md` § "Auth between peers"
  — currently flagged as future work, not built).
- **Same identity surface as LAN peer auth.** One key per instance
  authenticates the LAN handshake AND signs cloud bridge requests. No
  parallel secret to distribute; no key-rotation drift between LAN
  and cloud surfaces.
- The cloud peer registers the instance pubkey at venue onboarding
  (a one-time exchange via the existing pairing flow), then verifies
  `Ed25519(body || idempotency-key)` per request.
- **Recommended** as the natural alignment, but **flagged as
  dependent on Item 13 landing first.** Until then, ship Option 4.2
  (HMAC) and migrate when Item 13 lands — the wire contract carries
  whichever signature scheme is in flight via a single
  `Authorization` / `X-Lariat-Signature` header.

### Auth — operator pick

**HMAC (4.2) — per-location shared secret, signing `body || idempotency-key`.**

Item 13 (per-instance Ed25519 keypair, mDNS TXT pubkey advertisement)
has not shipped — see the remaining-work plan; it is gated on PRs
\#163 and \#164 merging first. Per §4.3 above, the prescribed
fallback is HMAC now with a planned migration to Ed25519
sign-of-body once Item 13 lands. The `X-Lariat-Signature` header
carries either scheme; switching is a server-side verification
swap plus a rotation, not a wire-format break.

Secret distribution piggybacks on the existing manager-PIN pairing
flow (the design doc names it). Storage on the venue side: the
secret lands alongside `LARIAT_CLOUD_API_KEY`. Today
`lib/cloudBridge.ts` only reads that key from `process.env`; if we
want operator-rotatable secrets without a redeploy, the Item-7
implementer should add a SQLite-backed config read (the design
doc already implies this surface — make it real).

---

## 5. Wire contract (binding regardless of backend)

This contract does not change with the backend choice. Both options
serve it; the drainer reads it.

### 5.1 Endpoint

```
POST /v1/snapshot
```

`/v1/` is intentional: the wire format is versioned independently of
the local DB schema (per `docs/cloud-bridge-design.md` § "Translate").

### 5.2 Headers

```
Content-Type: application/json
Idempotency-Key: <outbox-row-id>          # numeric, from cloud_bridge_outbox.id
X-Lariat-Location: <location_id>          # also in body; header is for routing/logging
X-Lariat-Signature: <auth-scheme-output>  # HMAC hex / Ed25519 base64 / mTLS = absent
```

The idempotency key is the outbox row id, which is monotonic per
location and survives across drainer restarts. Server-side dedup is
keyed on `(X-Lariat-Location, Idempotency-Key)`.

### 5.3 Request body

```json
{
  "table": "beo_events",
  "location_id": "default",
  "batch_id": 4271,
  "rows": [
    { "...": "row payload, schema-by-table, no PII per allow-list" }
  ]
}
```

- `table` MUST be one of `beo_events`, `spend_monthly` — server rejects
  anything else as a permanent 4xx (defense-in-depth; the venue queue already
  enforces this). `settlement_summaries` was dropped 2026-07-16 (computed at
  read time, no such table; single venue, no HQ consolidation to push).
- `location_id` MUST match `X-Lariat-Location`.
- `batch_id` is the outbox row id. Equals the `Idempotency-Key`
  header — duplicating in the body simplifies signed-body
  verification and server-side audit logs.
- `rows` is a JSON array. Empty array is rejected with 4xx (the
  venue should not have enqueued an empty batch; `enqueue` already
  refuses).

### 5.4 Responses

| Status                | Meaning                                              | Drainer action                            |
|-----------------------|------------------------------------------------------|-------------------------------------------|
| `202 { batch_id }`    | Accepted, durably stored or de-duped                 | `ack(id)`                                 |
| `4xx`                 | Permanent reject (validation, allow-list, signature) | `ack(id)` — drop, do NOT retry            |
| `5xx`                 | Transient (server error, DB blip, dependency down)   | `nack(id, msg)` — retry up to 5 then DLQ  |
| Network error/timeout | Treated as 5xx-equivalent                            | `nack(id, msg)` — retry up to 5 then DLQ  |

Why `4xx → ack`: a permanent reject means this batch will NEVER
succeed — bad signature, table not on allow-list, malformed body.
Re-trying burns the retry budget and dead-letters a row that's not
recoverable anyway. The drainer ack's to drop it from the queue;
the `4xx` body should carry enough detail to populate a server-side
log row that the operator can triage. (Optional follow-on: also
write a local `audit_events` row tagged `cloud_bridge_rejected` so
venue ops sees the loss.)

Why `5xx → nack-with-retry`: a transient server problem heals on
its own; that's exactly what `DEFAULT_MAX_ATTEMPTS=5` plus
exponential backoff is sized for.

### 5.5 Idempotency

Server-side dedup on `(location_id, batch_id)`. A repeat of the
same `(location_id, batch_id)` returns `202 { batch_id }` without
re-applying — safe-replay so the drainer can recover from "I sent
it but didn't see the ack" without double-writing.

The dedup index lives on the cloud peer (D1 unique index in Option
A; a unique constraint on the bridge_batches table in Option B).
Retention: at least 7 days (covers an extended WAN outage plus
redrain). Beyond that, dedup memory can age out — by then the
venue queue has long since acked.

### 5.6 Example happy path

```
→ POST /v1/snapshot
  Idempotency-Key: 4271
  X-Lariat-Location: default
  X-Lariat-Signature: <ed25519 sig>
  { "table": "beo_events",
    "location_id": "default",
    "batch_id": 4271,
    "rows": [ { ... } ] }

← 202 Accepted
  { "batch_id": 4271 }
```

Drainer calls `ack(4271)`; the outbox row is deleted; `depth()`
decrements; the next claim picks up the next batch.

### 5.7 Example permanent reject

```
→ POST /v1/snapshot
  ... { "table": "sales_lines", ... }   # somehow got past enqueue

← 422 Unprocessable Entity
  { "error": "table not on allow-list", "table": "sales_lines" }
```

Drainer calls `ack(id)` to drop. (And we now have a real bug
upstream: the queue's allow-list should have refused this. Worth a
local `audit_events` row.)

---

## 6. Rate limits & observability

Numbers below are back-of-envelope; tighten when load shows up.

### 6.1 Per-location request budget

- ~50 batches/hour/location during ops; bursts to a few hundred
  during end-of-night settlement when the queue drains an outage.
- Server hard cap: 600 requests/hour/location — well above expected,
  protects the cloud tier from a runaway drainer loop.
- Per-batch payload soft cap: 256 KB. Hard cap: 1 MB (also the D1
  row ceiling — verify current docs). Larger batches should be split
  upstream by the drainer.

These are backend-dependent in detail (Cloudflare Workers' built-in
rate limiting vs. an in-process token bucket on a self-hosted node).
The Item-7 implementer picks per the chosen backend.

### 6.2 Cloud peer observability

The cloud peer logs per batch — never row payloads, only metadata:

```
{
  "batch_id": 4271,
  "location_id": "default",
  "table": "beo_events",
  "n_rows": 14,
  "duration_ms": 87,
  "status": "accepted" | "rejected" | "dedup",
  "reject_reason": "..."   // when status = rejected
}
```

Required gauges/counters:

- Per-location queue depth (reported by `cloud_bridge_outbox`'s
  `depth()` via a status endpoint; the cloud peer does NOT compute
  this).
- Dead-letter count (`deadLetterDepth()`), surfaced in
  `/api/cloud-bridge/status`.
- Server-side: per-location request rate, p50/p95/p99 latency,
  4xx rate, 5xx rate.
- Server-side: dedup-hit rate (a healthy bridge sees occasional
  dedup hits during recovery; a chronic high rate means the drainer
  isn't acking and something is wrong).

### 6.3 Venue-side observability

Out of scope for this doc but named so the Item-7/8 implementer
remembers: the drainer should record per-batch outcomes locally so
operators can see "where did the queue drain to" without asking the
cloud peer. The existing `audit_events` table is the natural place
(action `cloud_bridge_pushed` / `cloud_bridge_rejected` /
`cloud_bridge_dead_lettered`). Per the project audit rules, this
write goes inside the same tx that ack/nacks the outbox row.

---

## 7. Decision

### Backend tier

**Cloudflare Worker + D1 (Option A).**

Why: the load is small and bursty (5 venues × 3 allow-listed tables
× ~20 batches/day ≈ ~300 batches/day, ~10 KB each). The three
current tables — `settlement_summaries`, `beo_events`,
`spend_monthly` — are coarse aggregates well under D1's row-size
ceiling. Workers + D1 free tier likely absorbs this entirely;
paid still rounds to a few dollars/month. The real cost we're
buying down is **operator-hours**: this is a single-operator
restaurant ops codebase, and §2's Option B "real ops burden"
column (TLS lifecycle, patching, fail-over alerting) is exactly
the cost we don't want to be carrying alongside HACCP rule
modules and ingest pipelines. Vendor lock is on the cloud-side
schema only — the wire contract (§5) is portable, so the venue
side never has to move if we swap clouds later.

R2 is reserved for any future blob-shipping table (§2 names a
daily settlement PDF as the canonical example); not used in v1.

If a future allow-listed table breaks the D1 row ceiling: split
to R2 by reference (the wire contract carries a row payload that
can hold an `r2_key` instead of an inline blob — backwards
compatible with the §5.3 schema). Re-evaluate the choice if more
than one table needs the R2 path; that's the threshold where
self-hosted's "native blob" pro starts mattering.

### Auth model

**Per-location HMAC (4.2)**, signing `body || idempotency-key`,
verified server-side.

Why: Ed25519 (§4.3) is the natural alignment but is gated on Item
13 (per-instance keypair + mDNS TXT pubkey), which has not landed.
HMAC is the §4.3-prescribed fallback. The wire contract's
`X-Lariat-Signature` header carries either scheme — switching
when Item 13 ships is a server verification swap plus a rotation,
not a wire-format break.

Secret distribution: the existing manager-PIN pairing flow named
in the design doc. One secret per `location_id`, rotatable.

### Filling this in commits the project to:

- [ ] Standing up the Cloudflare Worker + D1 instance (one Worker
      route per environment, D1 unique index on
      `(location_id, batch_id)` for §5.5 dedup, retention ≥ 7
      days).
- [ ] Implementing the `/v1/snapshot` handler per §5 (with dedup
      on `(location_id, batch_id)` and per-table allow-list
      defense-in-depth — re-validate against `ALLOWED_TABLES` on
      the cloud side; the venue queue already enforces it but
      defense-in-depth is cheap).
- [ ] Per-venue HMAC-secret issuance via the existing manager-PIN
      pairing flow. Server stores per-`location_id` secret;
      drainer signs `body || idempotency-key`. Plan a rotation
      flow now even if v1 ships without one — pre-Ed25519 we will
      need it.
- [ ] Implementing Item 7 (`pushSnapshot` against the Worker,
      replacing the `CLOUD_BRIDGE_NOT_IMPLEMENTED` sentinel in
      `lib/cloudBridge.ts`). While here, add the SQLite-backed
      config read for the HMAC secret + base URL so operators can
      rotate without a redeploy (§4 "Auth — operator pick" notes
      the gap).
- [ ] Implementing Item 8 (drainer loop: `sweepStaleClaims` →
      `claim(N)` → `POST /v1/snapshot` → `ack` on 2xx, `nack` on
      5xx/network, `ack` on 4xx, with a sane backoff between
      ticks).
- [ ] **Ed25519 migration when Item 13 lands.** Server adds
      Ed25519 verification path (keyed on instance pubkey
      registered at pairing); drainer flips signing scheme; HMAC
      verification stays for one rotation window then is removed.
      Tracked against Item 13 in
      `docs/superpowers/plans/2026-05-06-lariat-remaining-work.md`.
- [ ] Per-location request-rate budgets (§6.1: 600/hr/location
      hard cap on the Worker) and the observability surfaces
      enumerated in §6.2 / §6.3.
- [ ] Updating `docs/cloud-bridge-design.md` § "Next PR's job" to
      point at this decision (replace the "likely a tiny HTTPS
      service we own; Cloudflare Worker or similar" line with the
      decided answer: Cloudflare Worker + D1, per-location HMAC).

### What this does NOT commit to:

- Pull-direction sync (still scoped out per the design doc).
- Conflict resolution (still an explicit non-goal).
- Schema-migration negotiation across the bridge (the wire format
  versions independently; cross-version negotiation is future work).
- Per-row replication or any change-feed semantics.

---

## 8. References

- [`docs/cloud-bridge-design.md`](./cloud-bridge-design.md) — what the
  bridge is, what it isn't, and why.
- [`lib/cloudBridgeQueue.ts`](../lib/cloudBridgeQueue.ts) — outbox,
  allow-list source of truth (`ALLOWED_TABLES`,
  `DEFAULT_MAX_ATTEMPTS`, `CLOUD_BRIDGE_TABLE_DENIED`).
- [`lib/cloudBridge.ts`](../lib/cloudBridge.ts) — the
  `CloudBridge` interface, `CLOUD_BRIDGE_NOT_IMPLEMENTED` sentinel,
  `isCloudBridgeConfigured()`.
- [`docs/multi-instance.md`](./multi-instance.md) — LAN peer
  discovery; planned per-instance Ed25519 keypair (Item 13) referenced
  by the auth model.
- `docs/superpowers/plans/2026-05-06-lariat-remaining-work.md` — Items
  6 (this doc), 7 (real `pushSnapshot`), 8 (drainer), 13 (Ed25519
  keypair).
