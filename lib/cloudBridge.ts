// Cloud Bridge — interface + stub-or-real factory for WAN sync.
//
// This module owns the public CloudBridge surface. push/pull historically
// threw a sentinel error; as of the Item-7 wire-in, pushSnapshot delegates
// to lib/cloudBridgePush.ts::pushBatch when the bridge is configured
// (LARIAT_CLOUD_BRIDGE_URL + LARIAT_CLOUD_BRIDGE_SECRET). When not
// configured, the sentinel still throws — that's how callers that haven't
// migrated to the queue-based path detect "bridge is dormant on this
// host."
//
// The production push path is the queue (lib/cloudBridgeQueue.ts) drained
// by Item 8's drainer loop. pushSnapshot here is a thin direct-push
// affordance: it synthesizes an OutboxBatch with a Date.now() id and
// calls pushBatch. Server-side dedup on (location_id, batch_id) per §5.5
// of docs/cloud-bridge-backend-decision.md keeps the contract honest.
//
// See docs/cloud-bridge-design.md (scope) and
// docs/cloud-bridge-backend-decision.md (wire contract).

import { pushBatch } from './cloudBridgePush';
import type { OutboxBatch } from './cloudBridgeQueue';

/**
 * Sentinel thrown when the bridge is unconfigured (env vars absent).
 * Kept exported for back-compat: pre-Item-7 callers wrap their calls
 * and degrade gracefully on this string. Once a caller has migrated
 * to checking isCloudBridgeConfigured() up front, it never sees this
 * error — but legacy code paths still do.
 */
export const CLOUD_BRIDGE_NOT_IMPLEMENTED = 'cloud bridge: not implemented yet';

export interface CloudBridge {
  /**
   * Push a batch of rows for `table` up to the cloud peer. Per-table
   * opt-in: see the design doc for the allow/deny list. Returns the
   * count the peer accepted vs. rejected (e.g., schema drift, dup).
   *
   * Direct-push only. Production code uses the queue+drainer path —
   * cloudBridgeQueue.enqueue() then the Item-8 drainer.
   */
  pushSnapshot(
    table: string,
    rows: unknown[],
    opts: { locationId: string },
  ): Promise<{ accepted: number; rejected: number }>;

  /**
   * Pull rows for `table` modified at or after `since` (RFC 3339
   * timestamp). Used by sibling-venue read-only snapshots and corp
   * consolidation views. Still stubbed — push is the v1 priority per
   * the design doc.
   */
  pullSnapshot(
    table: string,
    opts: { locationId: string; since: string },
  ): Promise<unknown[]>;

  /**
   * Liveness / config probe. Safe to call without a secret — used by
   * the GET /api/cloud-bridge/status endpoint. Empty fields mean "no
   * activity yet", not an error.
   */
  status(): Promise<{
    lastPushAt: string | null;
    lastPullAt: string | null;
    queueDepth: number;
    lastError: string | null;
  }>;
}

export interface CloudBridgeOptions {
  /** Per-location HMAC secret. Defaults to env LARIAT_CLOUD_BRIDGE_SECRET. */
  secret?: string;
  /** Cloud peer base URL. Defaults to env LARIAT_CLOUD_BRIDGE_URL. */
  baseUrl?: string;
}

/**
 * Default implementation: real client when configured, sentinel-throwing
 * stub otherwise. status()/pullSnapshot() stay stubbed in v1 — push is
 * the only direction the wire contract serves today.
 */
class CloudBridgeImpl implements CloudBridge {
  private readonly secret: string | undefined;
  private readonly baseUrl: string | undefined;

  constructor(opts: CloudBridgeOptions = {}) {
    this.secret = opts.secret ?? process.env.LARIAT_CLOUD_BRIDGE_SECRET;
    this.baseUrl = opts.baseUrl ?? process.env.LARIAT_CLOUD_BRIDGE_URL;
  }

  async pushSnapshot(
    table: string,
    rows: unknown[],
    opts: { locationId: string },
  ): Promise<{ accepted: number; rejected: number }> {
    if (!this.secret || !this.baseUrl) {
      throw new Error(CLOUD_BRIDGE_NOT_IMPLEMENTED);
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      // Server would 4xx anyway per §5.3 ("empty rows → 4xx"); short-circuit.
      return { accepted: 0, rejected: 0 };
    }

    // Synthesize an OutboxBatch shape for the pushBatch wire contract.
    // The id doubles as the Idempotency-Key + body batch_id; Date.now()
    // is monotonic-enough for direct-push (the production drain path
    // uses real outbox row ids).
    const batch: OutboxBatch = {
      id: Date.now(),
      table,
      locationId: opts.locationId,
      rows,
      attempts: 0,
      enqueuedAt: new Date().toISOString(),
    };

    const result = await pushBatch(batch, {
      url: this.baseUrl,
      secret: this.secret,
    });

    if (result.ok) {
      return { accepted: rows.length, rejected: 0 };
    }
    if (result.permanent) {
      // Permanent rejects (bad signature, table not allow-listed,
      // malformed body) — surface as rejected; caller doesn't retry.
      return { accepted: 0, rejected: rows.length };
    }
    // Transient — caller's retry policy decides. Throwing matches the
    // pre-Item-7 sentinel-on-failure contract.
    throw new Error(result.reason ?? 'cloud bridge: transient push failure');
  }

  async pullSnapshot(
    _table: string,
    _opts: { locationId: string; since: string },
  ): Promise<unknown[]> {
    throw new Error(CLOUD_BRIDGE_NOT_IMPLEMENTED);
  }

  async status(): Promise<{
    lastPushAt: string | null;
    lastPullAt: string | null;
    queueDepth: number;
    lastError: string | null;
  }> {
    return {
      lastPushAt: null,
      lastPullAt: null,
      queueDepth: 0,
      lastError: null,
    };
  }

  /** Internal: lets the status route report whether config is present. */
  isConfigured(): boolean {
    return Boolean(this.secret && this.baseUrl);
  }
}

/**
 * Construct a CloudBridge handle. Always returns the same impl —
 * configured-vs-not is decided at call time by reading the env vars.
 */
export function createCloudBridge(opts: CloudBridgeOptions = {}): CloudBridge {
  return new CloudBridgeImpl(opts);
}

/**
 * Convenience: report config presence without instantiating a client
 * elsewhere. Used by the status route.
 */
export function isCloudBridgeConfigured(opts: CloudBridgeOptions = {}): boolean {
  const secret = opts.secret ?? process.env.LARIAT_CLOUD_BRIDGE_SECRET;
  const baseUrl = opts.baseUrl ?? process.env.LARIAT_CLOUD_BRIDGE_URL;
  return Boolean(secret && baseUrl);
}
