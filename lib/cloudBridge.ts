// Cloud Bridge — interface + stub-or-real factory for WAN sync.
//
// This module owns the public CloudBridge surface: pullSnapshot (still a
// future direction — v1 is push-only per the wire contract) plus status and
// config probes used by GET /api/cloud-bridge/status.
//
// The push path is the queue: lib/cloudBridgeQueue.ts::enqueue writes to the
// cloud_bridge_outbox table and Item 8's drainer loop drains it via
// lib/cloudBridgePush.ts::pushBatch, using the outbox row id (monotonic per
// location) as the batch_id. There is intentionally NO direct-push method
// here: the retired pushSnapshot affordance minted a non-monotonic Date.now()
// batch_id that could collide under server-side dedup on (location_id,
// batch_id) per §5.5. Use the queue.
//
// See docs/cloud-bridge-design.md (scope) and
// docs/cloud-bridge-backend-decision.md (wire contract).

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
   * Pull rows for `table` modified at or after `since` (RFC 3339
   * timestamp). Used by sibling-venue read-only snapshots and corp
   * consolidation views. Still stubbed — push is the v1 priority per
   * the design doc.
   */
  pullSnapshot(
    _table: string,
    _opts: { locationId: string; since: string },
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
