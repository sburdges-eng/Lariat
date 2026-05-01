/**
 * mDNS hub discovery — foundation stub.
 *
 * Lariat is local-first. As soon as a deployment grows past a single laptop
 * (multiple iPad terminals, a back-of-house hub plus a service tablet, an
 * upstairs/downstairs split), peers need to find each other on the LAN
 * without anyone typing IP addresses into a settings screen.
 *
 * This module is the smallest defensible primitive for that:
 *   - advertise() publishes a `_lariat._tcp` service via mDNS
 *   - discover() listens for peers and returns what it sees
 *
 * It does NOT do sync, failover, or any cross-host coordination — those
 * arrive in later phases. Today this is just "you are reachable" + "who
 * else is reachable". See docs/multi-instance.md for the longer arc.
 *
 * Defensive posture: Lariat must keep running standalone. If the
 * `bonjour-service` package can't load, or the host has no IPv4 multicast
 * (Docker without --net=host, locked-down corporate networks, …), this
 * module logs a single warning and degrades to no-ops. It must never
 * throw on import or on advertise/discover failure.
 *
 * Service type: `_lariat._tcp` — RFC 6335 service-name conventions.
 * TXT record fields:
 *   version     — Lariat package.json version (string)
 *   location_id — operator-scoped location key (e.g. "default", "main",
 *                 "upstairs"). Lets a peer know which floor/site it's
 *                 looking at when several Lariat instances co-exist.
 *   started_at  — ISO 8601 timestamp of when this instance came up.
 *                 Used by future failover logic to break ties and detect
 *                 stale advertisements.
 */

export interface AdvertiseOptions {
  port: number;
  hostname?: string;
  locationId?: string;
  /** Optional override; falls back to the value read from package.json. */
  version?: string;
}

export interface AdvertiseHandle {
  /** True if the responder is actively advertising on the network. */
  readonly active: boolean;
  /** Stop the responder and release the multicast socket. Idempotent. */
  stop(): Promise<void>;
}

export interface DiscoveredInstance {
  name: string;
  host: string;
  addresses: string[];
  port: number;
  txt: {
    version?: string;
    location_id?: string;
    started_at?: string;
  };
}

export interface DiscoverOptions {
  /** How long to listen for peers before resolving. Default 2000 ms. */
  timeoutMs?: number;
}

export const LARIAT_SERVICE_TYPE = 'lariat'; // bonjour-service prepends `_` and `._tcp`
export const LARIAT_SERVICE_NAME = 'Lariat';

let warned = false;

function warnOnce(reason: string, err?: unknown): void {
  if (warned) return;
  warned = true;
  // eslint-disable-next-line no-console
  console.warn(
    `[mdnsDiscovery] disabled: ${reason}` +
      (err instanceof Error ? ` (${err.message})` : '')
  );
}

function readPackageVersion(): string {
  try {
    // Read synchronously without taking a hard dependency on `import.meta` quirks.
    // We resolve relative to cwd so dev/build/test all see the same value.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('../package.json') as { version?: string };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

type BonjourCtor = new () => {
  publish: (opts: {
    name: string;
    type: string;
    port: number;
    host?: string;
    txt: Record<string, string>;
  }) => { stop?: (cb?: () => void) => void };
  find: (
    opts: { type: string },
    onUp: (svc: BonjourFoundService) => void
  ) => { stop?: () => void };
  destroy: (cb?: () => void) => void;
};

interface BonjourFoundService {
  name?: string;
  host?: string;
  addresses?: string[];
  port?: number;
  txt?: Record<string, string>;
}

async function loadBonjour(): Promise<BonjourCtor | null> {
  try {
    // Dynamic import keeps this module importable in environments where
    // `bonjour-service` may not be installed (CI, edge runtime, etc.).
    const mod = (await import('bonjour-service')) as {
      Bonjour?: BonjourCtor;
      default?: BonjourCtor;
    };
    return mod.Bonjour ?? mod.default ?? null;
  } catch (err) {
    warnOnce('bonjour-service is not installed or failed to load', err);
    return null;
  }
}

const NOOP_HANDLE: AdvertiseHandle = {
  active: false,
  async stop() {
    /* no-op */
  },
};

/**
 * Publish a `_lariat._tcp` advertisement on the LAN.
 *
 * Returns a handle even on failure — callers don't need to branch on null.
 * The handle's `active` flag tells you whether anyone is actually listening.
 */
export async function advertise(
  options: AdvertiseOptions
): Promise<AdvertiseHandle> {
  const Bonjour = await loadBonjour();
  if (!Bonjour) return NOOP_HANDLE;

  const version = options.version ?? readPackageVersion();
  const locationId = options.locationId ?? 'default';
  const startedAt = new Date().toISOString();

  let bonjour: InstanceType<BonjourCtor>;
  try {
    bonjour = new Bonjour();
  } catch (err) {
    warnOnce('Bonjour responder could not start (multicast unavailable?)', err);
    return NOOP_HANDLE;
  }

  let service: ReturnType<InstanceType<BonjourCtor>['publish']>;
  try {
    service = bonjour.publish({
      name: LARIAT_SERVICE_NAME,
      type: LARIAT_SERVICE_TYPE,
      port: options.port,
      host: options.hostname,
      txt: {
        version,
        location_id: locationId,
        started_at: startedAt,
      },
    });
  } catch (err) {
    warnOnce('Bonjour publish failed', err);
    try {
      bonjour.destroy();
    } catch {
      /* ignore */
    }
    return NOOP_HANDLE;
  }

  let active = true;

  return {
    get active() {
      return active;
    },
    async stop() {
      if (!active) return;
      active = false;
      await new Promise<void>(resolve => {
        try {
          if (typeof service.stop === 'function') {
            service.stop(() => resolve());
          } else {
            resolve();
          }
        } catch {
          resolve();
        }
      });
      try {
        bonjour.destroy();
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * Listen for `_lariat._tcp` peers for `timeoutMs` and return what we saw.
 *
 * Always resolves — never rejects. An empty array means "no peers found"
 * OR "mdns is unavailable on this host"; callers that need to distinguish
 * those should check `advertise()`'s handle.active for symmetry.
 */
export async function discover(
  options: DiscoverOptions = {}
): Promise<DiscoveredInstance[]> {
  const timeoutMs = options.timeoutMs ?? 2000;
  const Bonjour = await loadBonjour();
  if (!Bonjour) return [];

  let bonjour: InstanceType<BonjourCtor>;
  try {
    bonjour = new Bonjour();
  } catch (err) {
    warnOnce('Bonjour browser could not start (multicast unavailable?)', err);
    return [];
  }

  const found = new Map<string, DiscoveredInstance>();
  let browser: ReturnType<InstanceType<BonjourCtor>['find']> | null = null;

  try {
    browser = bonjour.find({ type: LARIAT_SERVICE_TYPE }, svc => {
      const name = typeof svc.name === 'string' ? svc.name : '';
      if (!name) return;
      const txt = (svc.txt ?? {}) as Record<string, string>;
      found.set(name, {
        name,
        host: typeof svc.host === 'string' ? svc.host : '',
        addresses: Array.isArray(svc.addresses) ? svc.addresses : [],
        port: typeof svc.port === 'number' ? svc.port : 0,
        txt: {
          version: txt['version'],
          location_id: txt['location_id'],
          started_at: txt['started_at'],
        },
      });
    });
  } catch (err) {
    warnOnce('Bonjour find failed', err);
    try {
      bonjour.destroy();
    } catch {
      /* ignore */
    }
    return [];
  }

  await new Promise<void>(resolve => setTimeout(resolve, timeoutMs));

  try {
    if (browser && typeof browser.stop === 'function') browser.stop();
  } catch {
    /* ignore */
  }
  await new Promise<void>(resolve => {
    try {
      bonjour.destroy(() => resolve());
    } catch {
      resolve();
    }
  });

  return Array.from(found.values());
}
