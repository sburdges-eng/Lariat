// Cloud-bridge canonical wire serialization (B.5 / PROTECTED_CONTRACTS §11.4).
//
// The bytes the cloud-bridge HMAC signs must be reproducible by any second
// producer (the Swift native encoder — see docs/superpowers/specs/
// 2026-07-16-cloud-bridge-envelope-contract-and-parity-harness.md, C.3 step 5).
// V8's JSON.stringify is not a portable contract, so the signed body is defined
// by THIS rule instead:
//
//   1. Object keys are sorted ascending (code-unit order), recursively.
//      Integer-like keys (e.g. "10", "9") are rejected: JS engines reorder them
//      numerically, silently diverging from a lexicographic Swift twin.
//   2. No insignificant whitespace.
//   3. Scalars follow JSON.stringify: strings escape " \ and C0 controls, the
//      forward slash is NOT escaped, non-ASCII is emitted raw (UTF-8).
//   4. Numbers must be integers. A non-integer / non-finite number throws — the
//      pushable tables carry money as integer cents, so this cannot happen in
//      practice; the guard keeps cross-language number parity provably exact and
//      fails loud (§14/§18) rather than sign a body a second producer can't match.
//
// The web side leans on V8's JSON.stringify for scalar encoding (it IS the
// reference); the Swift twin reproduces the same rule byte-for-byte.
//
// This module is DB-free on purpose so lib/cloudBridgePush.ts stays DB-free.

/** Error-message prefix when a value outside the canonical-safe set reaches the serializer. */
export const CLOUD_BRIDGE_CANONICAL_UNSUPPORTED = 'cloud bridge: value not canonical-serializable';

/**
 * Per-table cloud-bridge wire-contract version, stamped into the signed body as
 * `schema_version`. Bump a table's number ONLY when that table's pushed row
 * shape changes. Deliberately NOT the global DB SCHEMA_VERSION (which bumps on
 * any migration): a per-table version tells a future receiver which table
 * drifted and does not couple the wire contract to internal storage evolution.
 * A receiver selects its decode/validate path from this only AFTER verifying the
 * HMAC (parse-before-verify). Every ALLOWED_TABLES entry must have one —
 * enforced by tests/js/test-cloud-bridge-envelope-coverage.mjs.
 */
export const TABLE_WIRE_VERSION: Readonly<Record<string, number>> = {
  beo_events: 1,
  spend_monthly: 1,
};

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      // Integer-like keys are re-ordered numerically by JS engines regardless of
      // insertion order, which would silently diverge from a lexicographic Swift
      // twin and break HMAC byte-parity. Refuse them (fail-loud) rather than emit
      // unmatchable bytes.
      if (/^(0|[1-9]\d*)$/.test(key)) {
        throw new Error(`${CLOUD_BRIDGE_CANONICAL_UNSUPPORTED}: integer-like object key '${key}'`);
      }
      out[key] = sortDeep(src[key]);
    }
    return out;
  }
  if (typeof value === 'number' && !Number.isInteger(value)) {
    throw new Error(`${CLOUD_BRIDGE_CANONICAL_UNSUPPORTED}: non-integer number ${value}`);
  }
  return value;
}

/**
 * Serialize `body` to the canonical signed-envelope string. Deterministic and
 * portable: same input → same bytes on any conforming producer. Rebuilding
 * objects with sorted string-key insertion order and handing them to
 * JSON.stringify preserves that order. Integer-like keys are rejected fail-loud
 * to prevent silent HMAC divergence from a lexicographic Swift twin.
 */
export function canonicalize(body: unknown): string {
  return JSON.stringify(sortDeep(body));
}
