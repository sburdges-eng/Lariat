// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
// /management/cloud-bridge — dead-letter triage for the cloud bridge.
//
// PIN gate: `/management/*` is in middleware.js SENSITIVE_PREFIXES, so
// the browser cannot reach this page without a valid `lariat_pin_ok`
// cookie. The sibling API routes re-check the PIN in-route — same
// posture as /api/cloud-bridge/status.
//
// Server component: read queued depth + dead-letter rows directly from
// SQLite so first paint is already populated. The client board uses
// /api/cloud-bridge/dead-letters for refresh + auctions + drop.
//
// `force-dynamic` because the queue depth changes constantly; never
// statically optimize.

import {
  listDeadLetters,
  deadLetterDepth,
  depth,
} from '../../../lib/cloudBridgeQueue';
import { isCloudBridgeConfigured } from '../../../lib/cloudBridge';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';

import CloudBridgeBoard from './CloudBridgeBoard';

export const dynamic = 'force-dynamic';

export default function CloudBridgeTriagePage({ searchParams }) {
  const locParam = searchParams?.location;
  const location =
    typeof locParam === 'string' && locParam.trim()
      ? locParam.trim()
      : DEFAULT_LOCATION_ID;

  // Each read is wrapped — a degraded queue (e.g., schema not yet
  // migrated on a fresh checkout) shouldn't blank the page; the board
  // can still render the "configured" state and an empty list.
  let initialQueuedDepth = 0;
  let initialDeadLetterTotal = 0;
  let initialDeadLetters = [];
  let initialError = null;
  try {
    initialQueuedDepth = depth();
    initialDeadLetterTotal = deadLetterDepth();
    initialDeadLetters = listDeadLetters({ locationId: location });
  } catch (err) {
    initialError = err instanceof Error ? err.message : 'Failed to read queue';
  }

  return (
    <CloudBridgeBoard
      configured={isCloudBridgeConfigured()}
      location={location}
      initialQueuedDepth={initialQueuedDepth}
      initialDeadLetterTotal={initialDeadLetterTotal}
      initialDeadLetters={initialDeadLetters}
      initialError={initialError}
    />
  );
}
