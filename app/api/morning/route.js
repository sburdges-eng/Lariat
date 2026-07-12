// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
import { todayISO } from '../../../lib/db';
import { locationFromRequest } from '../../../lib/location';
import { buildMorningDigest } from '../../../lib/morningDigest';
import { withIdempotency } from '../../../lib/idempotency';

export const dynamic = 'force-dynamic';

/** @param {Request} req */
function resolveDigestRequest(req) {
  const url = new URL(req.url);
  const dateParam = url.searchParams.get('date');
  const today =
    typeof dateParam === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? dateParam
      : todayISO();
  const loc = locationFromRequest(req);
  return buildMorningDigest(loc, today);
}

/** @param {Request} req */
export async function GET(req) {
  try {
    const digest = resolveDigestRequest(req);
    return Response.json(digest, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('GET /api/morning failed:', err);
    return Response.json({ error: 'Could not load morning digest' }, { status: 500 });
  }
}

/** @param {Request} req */
export async function POST(req) {
  // Replaying a queued POST would double-post the digest to Slack.
  return withIdempotency(req, () => morningPostHandler(req));
}

/** @param {Request} req */
async function morningPostHandler(req) {
  try {
    const webhookUrl = process.env.LARIAT_MORNING_SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      return Response.json({ error: 'Morning digest webhook is not configured' }, { status: 503 });
    }

    const digest = resolveDigestRequest(req);
    const slackRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ text: digest.webhook.text }),
    });

    if (!slackRes.ok) {
      return Response.json({ error: 'Morning digest webhook delivery failed' }, { status: 502 });
    }

    return Response.json(
      {
        delivered: true,
        shift_date: digest.shift_date,
        location_id: digest.location_id,
        webhook: digest.webhook,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (err) {
    console.error('POST /api/morning failed:', err);
    return Response.json({ error: 'Could not send morning digest webhook' }, { status: 500 });
  }
}
