// Client-side fetch wrapper that injects an `idempotency-key` header
// at the moment a mutation is FIRST issued. The key MUST be generated
// before the first send so the original request and any service-worker
// replay carry the same key — that's what lets the server-side
// withIdempotency() wrapper recognize replays.
//
// Per the spec at docs/superpowers/specs/2026-05-02-sw-replay-idempotency-design.md
//
// Usage:
//
//   import { clientFetch } from '@/lib/clientFetch';
//
//   const res = await clientFetch('/api/temp-log', {
//     method: 'POST',
//     headers: { 'content-type': 'application/json' },
//     body: JSON.stringify(payload),
//     idempotent: true,        // <-- opt-in
//   });
//
// `idempotent: true` is opt-in to keep this safe to roll out
// incrementally. Surfaces that haven't migrated yet (curl scripts,
// un-retrofitted UIs) keep working unchanged.

export interface ClientFetchInit extends RequestInit {
  /**
   * If true, generate a UUID-shaped `idempotency-key` header at
   * fetch-initiation. The key persists through any service-worker
   * replay so a single mutation that was retried gets deduped on
   * the server.
   *
   * If the caller already set an `idempotency-key` header explicitly,
   * we respect it — useful for tests that want a deterministic key.
   */
  idempotent?: boolean;
}

/**
 * Generate a UUIDv7-or-v4 string. Prefers `crypto.randomUUID` (v4)
 * which is available in iOS 14+, the deployment target. Falls back to
 * a 32-char alphanumeric polyfill for older environments — accepted
 * by the server-side `KEY_PATTERN` (16+ chars [A-Za-z0-9_-]).
 */
function makeKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to polyfill
  }
  // Polyfill: 32 hex chars from getRandomValues, fallback to Math.random.
  const bytes = new Uint8Array(16);
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
  } catch {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < 16; i++) out += bytes[i]!.toString(16).padStart(2, '0');
  return out;
}

export async function clientFetch(
  url: string,
  init: ClientFetchInit = {},
): Promise<Response> {
  const { idempotent, ...rest } = init;
  const headers = new Headers(rest.headers);

  if (idempotent && !headers.has('idempotency-key')) {
    headers.set('idempotency-key', makeKey());
  }

  return fetch(url, { ...rest, headers });
}
