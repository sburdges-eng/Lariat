# Peer Trust DB Query Audit - 2026-06-08

## Scope

Affected subsystem: LaRi `db_query` registry and LAN peer sync observability.

Freeze-readiness impact: positive. This closes the remaining row 2.4 registered-query candidate by giving managers a vetted read path for trusted and revoked sync peers.

Determinism impact: positive. The query is literal SQL, manager-tier gated, row-capped, and returns deterministic peer rows ordered by active status, last-seen time, then creation time.

Security impact: positive. The query exposes peer fingerprints, labels, trust status, and timestamps, but does not expose full raw peer public keys. Revoked peers remain visible as `revoked` instead of being hidden or treated as trusted.

Runtime coupling introduced: no.

## Query Contract

Query name: `peer_trust_status`

Tier: manager

Location scope: none. `peer_trust` is an instance-level sync allowlist, not a venue-scoped operational table.

Returned columns:

- `fingerprint`
- `label`
- `trust_status`
- `revoked`
- `created_at`
- `last_seen_at`
- `last_seen_min`

`trust_status` is one of:

- `trusted_seen`
- `trusted_never_seen`
- `revoked`

## Verification

Pinned by `tests/js/test-db-query-tool.mjs`:

- cook-tier access is blocked with `tier_blocked`.
- manager-tier access returns trusted and revoked peers.
- full `pubkey_hex` values are not present in the table output.
- revoked peers remain explicitly marked as revoked.
- every registered query still prepares against the real schema.

## Invariants

- SQL stays literal in `lib/dbQueryRegistry.ts`; no LLM-composed SQL.
- Manager PIN is required through the existing `runDbQuery` tier gate.
- Query output is read-only and does not mutate `peer_trust.last_seen_at`.
- No runtime cloud dependency is introduced.
