// /management/peers — read-only board of Lariat instances on the LAN.
//
// PIN gate: `/management/*` is in middleware.js SENSITIVE_PREFIXES, so the
// browser cannot reach this page without a valid `lariat_pin_ok` cookie.
// Same gate that protects the rest of /management — no route-local re-check
// needed (see the audit-log/performance-reviews precedents).
//
// Server component: we call `loadPeersAndHub({timeoutMs: 2000})` directly so
// the first paint already has the peer list (no flash of "loading…"). The
// HTTP route at `/api/peers` is the same composition; the client uses it
// for refresh and the 30-second auto-poll.
//
// `force-dynamic` because `loadPeersAndHub` does multicast IO; we must not
// statically optimize this at build time.

import PeersBoard from './PeersBoard';
import { loadPeersAndHub } from '../../../lib/peers';

export const dynamic = 'force-dynamic';

export default async function PeersPage() {
  const { peers, hub } = await loadPeersAndHub({ timeoutMs: 2000 });
  return <PeersBoard initialPeers={peers} initialHub={hub} />;
}
