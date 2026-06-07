#!/usr/bin/env node
// Integration tests for the client-share BEO surface:
//   POST /api/beo/[id]/share-token       (PIN-gated, generates token)
//   GET  /api/beo/share/[token]          (public, returns sanitized event)
//   POST /api/beo/share/[token]/sign     (public, records signature + audit)
// Run: node --experimental-strip-types --test tests/js/test-beo-share-api.mjs

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '4242';
delete process.env.LARIAT_PIN_SECRET;

const db = await import('../../lib/db.ts');
const shareTokenRoute = await import('../../app/api/beo/[id]/share-token/route.js');
const shareReadRoute = await import('../../app/api/beo/share/[token]/route.js');
const signRoute = await import('../../app/api/beo/share/[token]/sign/route.js');

db.setDbPathForTest(':memory:');
const conn = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  process.env.LARIAT_PIN = ORIGINAL_PIN;
  if (ORIGINAL_SECRET !== undefined) process.env.LARIAT_PIN_SECRET = ORIGINAL_SECRET;
});

beforeEach(() => {
  conn.exec(
    `DELETE FROM beo_signatures;
     DELETE FROM beo_line_items;
     DELETE FROM beo_courses;
     DELETE FROM beo_events;
     DELETE FROM audit_events;`,
  );
});

const PIN_COOKIE = 'lariat_pin_ok=1';

function makeReq({ method = 'GET', path = '/', body, withPin = false, extraHeaders = {} } = {}) {
  const headers = { 'content-type': 'application/json', ...extraHeaders };
  if (withPin) headers.cookie = PIN_COOKIE;
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, init);
}

function seedEvent({ title = 'Hendricks Wedding', date = '2026-06-15', location = 'default' } = {}) {
  const r = conn
    .prepare(
      `INSERT INTO beo_events (title, event_date, event_time, contact_name, guest_count, notes, tax_rate, service_fee_pct, location_id)
       VALUES (?, ?, '5:00pm', 'Sarah Hendricks', 80, 'No nuts please.', 0.0675, 20, ?)`,
    )
    .run(title, date, location);
  return Number(r.lastInsertRowid);
}

function seedLine(eventId, name, qty, unit_cost) {
  conn
    .prepare(
      `INSERT INTO beo_line_items (event_id, item_name, quantity, unit_cost, category)
       VALUES (?, ?, ?, ?, 'entree')`,
    )
    .run(eventId, name, qty, unit_cost);
}

function setShareLifecycle(eventId, { expiresAt = null, revokedAt = null } = {}) {
  conn
    .prepare(
      `UPDATE beo_events
          SET share_expires_at = ?,
              share_revoked_at = ?
        WHERE id = ?`,
    )
    .run(expiresAt, revokedAt, eventId);
}

// ── POST /api/beo/[id]/share-token ─────────────────────────────────

describe('POST /api/beo/[id]/share-token', () => {
  it('returns 401 without a PIN cookie', async () => {
    const id = seedEvent();
    const res = await shareTokenRoute.POST(
      makeReq({ method: 'POST', path: `/api/beo/${id}/share-token` }),
      { params: { id: String(id) } },
    );
    assert.equal(res.status, 401);
  });

  it('rejects a non-integer event id', async () => {
    const res = await shareTokenRoute.POST(
      makeReq({ method: 'POST', path: '/api/beo/abc/share-token', withPin: true }),
      { params: { id: 'abc' } },
    );
    assert.equal(res.status, 400);
  });

  it('returns 404 for unknown event', async () => {
    const res = await shareTokenRoute.POST(
      makeReq({ method: 'POST', path: '/api/beo/9999/share-token', withPin: true }),
      { params: { id: '9999' } },
    );
    assert.equal(res.status, 404);
  });

  it('does not mint a token for a BEO in another location', async () => {
    const id = seedEvent({ location: 'west' });
    const res = await shareTokenRoute.POST(
      makeReq({ method: 'POST', path: `/api/beo/${id}/share-token?location=default`, withPin: true }),
      { params: { id: String(id) } },
    );

    assert.equal(res.status, 404);
    const stored = conn.prepare('SELECT share_token FROM beo_events WHERE id = ?').get(id);
    assert.equal(stored.share_token, null);
    const audits = conn
      .prepare(`SELECT * FROM audit_events WHERE entity = 'beo_event' AND entity_id = ?`)
      .all(id);
    assert.equal(audits.length, 0);
  });

  it('generates a token, persists it, returns share_url + created:true', async () => {
    const id = seedEvent();
    const res = await shareTokenRoute.POST(
      makeReq({ method: 'POST', path: `/api/beo/${id}/share-token`, withPin: true }),
      { params: { id: String(id) } },
    );
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.event_id, id);
    assert.equal(j.created, true);
    assert.match(j.token, /^[0-9a-f]{32}$/);
    assert.ok(j.share_url.endsWith(`/beo/share/${j.token}`));

    const stored = conn.prepare('SELECT share_token FROM beo_events WHERE id = ?').get(id);
    assert.equal(stored.share_token, j.token);

    const audit = conn
      .prepare(`SELECT * FROM audit_events WHERE entity = 'beo_event' AND entity_id = ?`)
      .all(id);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, 'update');
    assert.equal(audit[0].note, 'share_token generated');
  });

  it('is idempotent — second call returns the same token with created:false', async () => {
    const id = seedEvent();
    const req1 = makeReq({ method: 'POST', path: `/api/beo/${id}/share-token`, withPin: true });
    const r1 = await shareTokenRoute.POST(req1, { params: { id: String(id) } });
    const j1 = await r1.json();

    const req2 = makeReq({ method: 'POST', path: `/api/beo/${id}/share-token`, withPin: true });
    const r2 = await shareTokenRoute.POST(req2, { params: { id: String(id) } });
    const j2 = await r2.json();

    assert.equal(j2.token, j1.token);
    assert.equal(j2.created, false);

    const audits = conn
      .prepare(`SELECT * FROM audit_events WHERE entity = 'beo_event' AND entity_id = ?`)
      .all(id);
    assert.equal(audits.length, 1, 'no second audit row on idempotent re-call');
  });

  it('mints a fresh token when the stored token is revoked', async () => {
    const id = seedEvent();
    const r1 = await shareTokenRoute.POST(
      makeReq({ method: 'POST', path: `/api/beo/${id}/share-token`, withPin: true }),
      { params: { id: String(id) } },
    );
    const j1 = await r1.json();
    setShareLifecycle(id, { revokedAt: '2026-01-02T12:00:00.000Z' });

    const r2 = await shareTokenRoute.POST(
      makeReq({ method: 'POST', path: `/api/beo/${id}/share-token`, withPin: true }),
      { params: { id: String(id) } },
    );
    const j2 = await r2.json();

    assert.equal(r2.status, 200);
    assert.equal(j2.created, true);
    assert.notEqual(j2.token, j1.token);
    const stored = conn
      .prepare('SELECT share_token, share_revoked_at FROM beo_events WHERE id = ?')
      .get(id);
    assert.equal(stored.share_token, j2.token);
    assert.equal(stored.share_revoked_at, null);
  });

  it('mints a fresh token when expiry is only millisecond-future inside the current second', async () => {
    const originalNow = Date.now;
    Date.now = () => Date.parse('2026-01-01T00:00:00.100Z');
    try {
      const id = seedEvent();
      const r1 = await shareTokenRoute.POST(
        makeReq({ method: 'POST', path: `/api/beo/${id}/share-token`, withPin: true }),
        { params: { id: String(id) } },
      );
      const j1 = await r1.json();
      setShareLifecycle(id, { expiresAt: '2026-01-01T00:00:00.900Z' });

      const r2 = await shareTokenRoute.POST(
        makeReq({ method: 'POST', path: `/api/beo/${id}/share-token`, withPin: true }),
        { params: { id: String(id) } },
      );
      const j2 = await r2.json();

      assert.equal(r2.status, 200);
      assert.equal(j2.created, true);
      assert.notEqual(j2.token, j1.token);
    } finally {
      Date.now = originalNow;
    }
  });
});

// ── GET /api/beo/share/[token] ─────────────────────────────────────

describe('GET /api/beo/share/[token]', () => {
  it('returns 404 for a malformed token (no DB hit)', async () => {
    const res = await shareReadRoute.GET(makeReq({ path: '/api/beo/share/garbage' }), {
      params: { token: 'garbage' },
    });
    assert.equal(res.status, 404);
  });

  it('returns 404 for an unknown but well-formed token', async () => {
    const res = await shareReadRoute.GET(makeReq({ path: '/api/beo/share/' + '0'.repeat(32) }), {
      params: { token: '0'.repeat(32) },
    });
    assert.equal(res.status, 404);
  });

  it('returns sanitized event + line_items + courses for a valid token', async () => {
    const id = seedEvent();
    seedLine(id, 'Smoked Brisket', 80, 14.5);
    seedLine(id, 'Charred Carrots', 80, 6);
    const otherId = seedEvent({ title: 'West Patio Rehearsal', location: 'west' });
    seedLine(otherId, 'West Patio Salmon', 20, 12);

    const tokRes = await shareTokenRoute.POST(
      makeReq({ method: 'POST', path: `/api/beo/${id}/share-token`, withPin: true }),
      { params: { id: String(id) } },
    );
    const { token } = await tokRes.json();

    const res = await shareReadRoute.GET(makeReq({ path: `/api/beo/share/${token}` }), {
      params: { token },
    });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.event.title, 'Hendricks Wedding');
    assert.equal(j.event.guest_count, 80);
    assert.equal(j.event.location_id, undefined, 'location_id is stripped from public view');
    assert.equal(j.line_items.length, 2);
    assert.equal(j.line_items[0].item_name, 'Smoked Brisket');
    assert.equal(
      j.line_items.some((row) => row.item_name === 'West Patio Salmon'),
      false,
      'public token must return only the linked BEO line items',
    );
    assert.ok('unit_cost' in j.line_items[0], 'prices are visible — this is a client-facing invoice');
    assert.equal(j.line_items[0].prep_notes, undefined, 'kitchen prep_notes is not in the SELECT');
    assert.equal(Array.isArray(j.courses), true);
    assert.equal(Array.isArray(j.signatures), true);
    assert.equal(j.signatures.length, 0);
  });

  it('returns 404 for an expired share token', async () => {
    const id = seedEvent();
    const tokRes = await shareTokenRoute.POST(
      makeReq({ method: 'POST', path: `/api/beo/${id}/share-token`, withPin: true }),
      { params: { id: String(id) } },
    );
    const { token } = await tokRes.json();
    setShareLifecycle(id, { expiresAt: '2026-01-01T00:00:00.000Z' });

    const res = await shareReadRoute.GET(makeReq({ path: `/api/beo/share/${token}` }), {
      params: { token },
    });

    assert.equal(res.status, 404);
  });

  it('returns 404 for a revoked share token', async () => {
    const id = seedEvent();
    const tokRes = await shareTokenRoute.POST(
      makeReq({ method: 'POST', path: `/api/beo/${id}/share-token`, withPin: true }),
      { params: { id: String(id) } },
    );
    const { token } = await tokRes.json();
    setShareLifecycle(id, { revokedAt: '2026-01-02T12:00:00.000Z' });

    const res = await shareReadRoute.GET(makeReq({ path: `/api/beo/share/${token}` }), {
      params: { token },
    });

    assert.equal(res.status, 404);
  });
});

// ── POST /api/beo/share/[token]/sign ───────────────────────────────

describe('POST /api/beo/share/[token]/sign', () => {
  async function freshToken() {
    const id = seedEvent();
    const r = await shareTokenRoute.POST(
      makeReq({ method: 'POST', path: `/api/beo/${id}/share-token`, withPin: true }),
      { params: { id: String(id) } },
    );
    const j = await r.json();
    return { id, token: j.token };
  }

  it('rejects malformed tokens with 404', async () => {
    const res = await signRoute.POST(
      makeReq({ method: 'POST', path: '/api/beo/share/bad/sign', body: { signed_name: 'X' } }),
      { params: { token: 'bad' } },
    );
    assert.equal(res.status, 404);
  });

  it('rejects unknown tokens with 404', async () => {
    const tok = '0'.repeat(32);
    const res = await signRoute.POST(
      makeReq({ method: 'POST', path: `/api/beo/share/${tok}/sign`, body: { signed_name: 'X' } }),
      { params: { token: tok } },
    );
    assert.equal(res.status, 404);
  });

  it('400s on empty signed_name', async () => {
    const { token } = await freshToken();
    const res = await signRoute.POST(
      makeReq({ method: 'POST', path: `/api/beo/share/${token}/sign`, body: { signed_name: '   ' } }),
      { params: { token } },
    );
    assert.equal(res.status, 400);
  });

  it('rejects expired tokens without inserting a signature', async () => {
    const { id, token } = await freshToken();
    setShareLifecycle(id, { expiresAt: '2026-01-01T00:00:00.000Z' });

    const res = await signRoute.POST(
      makeReq({
        method: 'POST',
        path: `/api/beo/share/${token}/sign`,
        body: { signed_name: 'Sarah Hendricks' },
      }),
      { params: { token } },
    );

    assert.equal(res.status, 404);
    const count = conn.prepare(`SELECT COUNT(*) AS n FROM beo_signatures WHERE event_id = ?`).get(id);
    assert.equal(count.n, 0);
  });

  it('rejects revoked tokens without inserting a signature', async () => {
    const { id, token } = await freshToken();
    setShareLifecycle(id, { revokedAt: '2026-01-02T12:00:00.000Z' });

    const res = await signRoute.POST(
      makeReq({
        method: 'POST',
        path: `/api/beo/share/${token}/sign`,
        body: { signed_name: 'Sarah Hendricks' },
      }),
      { params: { token } },
    );

    assert.equal(res.status, 404);
    const count = conn.prepare(`SELECT COUNT(*) AS n FROM beo_signatures WHERE event_id = ?`).get(id);
    assert.equal(count.n, 0);
  });

  it('records the signature row + audit event inside a single transaction', async () => {
    const { id, token } = await freshToken();
    const res = await signRoute.POST(
      makeReq({
        method: 'POST',
        path: `/api/beo/share/${token}/sign`,
        body: { signed_name: '  Sarah Hendricks  ' },
        extraHeaders: { 'user-agent': 'Mozilla/5.0 test', 'x-forwarded-for': '203.0.113.99' },
      }),
      { params: { token } },
    );
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.ok(j.signature_id > 0);
    assert.equal(j.signed_name, 'Sarah Hendricks');

    const sigRow = conn.prepare(`SELECT * FROM beo_signatures WHERE id = ?`).get(j.signature_id);
    assert.equal(sigRow.event_id, id);
    assert.equal(sigRow.signed_name, 'Sarah Hendricks');
    assert.equal(sigRow.ip_addr, '203.0.113.99');
    assert.equal(sigRow.user_agent, 'Mozilla/5.0 test');

    const audit = conn
      .prepare(`SELECT * FROM audit_events WHERE entity = 'beo_signature' AND entity_id = ?`)
      .get(j.signature_id);
    assert.ok(audit, 'audit_events row must exist');
    assert.equal(audit.action, 'insert');
    assert.equal(audit.actor_source, 'beo_client_share');
  });

  it('allows multiple signatures on the same event (co-signers)', async () => {
    const { id, token } = await freshToken();

    for (const name of ['Sarah Hendricks', 'Tom Hendricks']) {
      const r = await signRoute.POST(
        makeReq({
          method: 'POST',
          path: `/api/beo/share/${token}/sign`,
          body: { signed_name: name },
        }),
        { params: { token } },
      );
      assert.equal(r.status, 200);
    }

    const sigs = conn.prepare(`SELECT * FROM beo_signatures WHERE event_id = ?`).all(id);
    assert.equal(sigs.length, 2);
  });
});
