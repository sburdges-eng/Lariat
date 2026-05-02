// Cloud Bridge — stub interface for future WAN sync.
//
// This module defines the contract between Lariat (local-first,
// better-sqlite3 / WAL) and a future cloud peer. It is a STUB:
// push/pull throw a sentinel error; status() returns an empty
// state. The point is to land the surface so the next PR can
// fill in a real backend without redesigning callers.
//
// See docs/cloud-bridge-design.md for the full scoping doc:
// what this is, what this is not, why a bridge instead of direct
// DB replication, and the per-table allow/deny list.

/**
 * Sentinel thrown by stub implementations of push/pull. Callers
 * (future API routes) should wrap calls in try/catch and degrade
 * gracefully — the bridge is best-effort by design.
 */
export const CLOUD_BRIDGE_NOT_IMPLEMENTED = 'cloud bridge: not implemented yet';

export interface CloudBridge {
  /**
   * Push a batch of rows for `table` up to the cloud peer. Per-table
   * opt-in: see the design doc for the allow/deny list. Returns the
   * count the peer accepted vs. rejected (e.g., schema drift, dup).
   */
  pushSnapshot(
    table: string,
    rows: unknown[],
    opts: { locationId: string },
  ): Promise<{ accepted: number; rejected: number }>;

  /**
   * Pull rows for `table` modified at or after `since` (RFC 3339
   * timestamp). Used by sibling-venue read-only snapshots and corp
   * consolidation views. Pull is lower-priority than push; it is
   * stubbed first so callers can be written, but the first real
   * implementation will likely cover push only.
   */
  pullSnapshot(
    table: string,
    opts: { locationId: string; since: string },
  ): Promise<unknown[]>;

  /**
   * Liveness / config probe. Safe to call without an API key — used
   * by the GET /api/cloud-bridge/status endpoint as an "is the
   * bridge configured?" check. Empty fields mean "no activity yet",
   * not an error.
   */
  status(): Promise<{
    lastPushAt: string | null;
    lastPullAt: string | null;
    queueDepth: number;
    lastError: string | null;
  }>;
}

export interface CloudBridgeOptions {
  /** API key for the cloud peer. Defaults to env LARIAT_CLOUD_API_KEY. */
  apiKey?: string;
  /** Base URL for the cloud peer. Defaults to env LARIAT_CLOUD_BASE_URL. */
  baseUrl?: string;
}

/**
 * Default stub implementation. push/pull throw the sentinel error
 * so failures are loud during development. status() returns an
 * empty state — there is no real activity to report.
 *
 * The configured fields (apiKey, baseUrl) are captured so a future
 * implementation can swap this constructor for a real one without
 * changing call sites.
 */
class StubCloudBridge implements CloudBridge {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string | undefined;

  constructor(opts: CloudBridgeOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.LARIAT_CLOUD_API_KEY;
    this.baseUrl = opts.baseUrl ?? process.env.LARIAT_CLOUD_BASE_URL;
  }

  async pushSnapshot(
    _table: string,
    _rows: unknown[],
    _opts: { locationId: string },
  ): Promise<{ accepted: number; rejected: number }> {
    throw new Error(CLOUD_BRIDGE_NOT_IMPLEMENTED);
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
    return Boolean(this.apiKey && this.baseUrl);
  }
}

/**
 * Construct a CloudBridge handle. In stub mode, always returns the
 * stub implementation. Future PRs replace this factory body to
 * return a real client when config is present, and the stub
 * otherwise — call sites do not change.
 */
export function createCloudBridge(opts: CloudBridgeOptions = {}): CloudBridge {
  return new StubCloudBridge(opts);
}

/**
 * Convenience: report config presence without instantiating a real
 * client elsewhere. Used by the status route.
 */
export function isCloudBridgeConfigured(opts: CloudBridgeOptions = {}): boolean {
  const apiKey = opts.apiKey ?? process.env.LARIAT_CLOUD_API_KEY;
  const baseUrl = opts.baseUrl ?? process.env.LARIAT_CLOUD_BASE_URL;
  return Boolean(apiKey && baseUrl);
}
