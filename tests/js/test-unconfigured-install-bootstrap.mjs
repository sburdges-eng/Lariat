#!/usr/bin/env node
// The complement to test-unconfigured-install-fails-closed.mjs.
//
// That suite proves the door is shut. This one proves an operator can still
// get through it — which nothing asserted when pinRequiredForPic() was
// flipped to fail closed, and which is the half that decides whether the
// change is a security fix or a lockout.
//
// THE BOOTSTRAP IS OUT OF BAND, AND WAS ALREADY
//
// /login-pin?setup=1 renders a dead-end card ("Set a manager PIN, then
// reopen Lariat") with no way to set one, and middleware sends every page in
// SENSITIVE_PREFIXES there whenever LARIAT_PIN is unset. So a fresh install
// has always required the operator to set LARIAT_PIN in .env.local and
// restart. The flip did not take away a working first-run wizard, because
// there was not one.
//
// What the flip did close is /api/auth/manager-pins, which sits outside the
// middleware matcher and so was curl-able with no credential at all while
// pinRequiredForPic() returned pinConfigured(). Creating manager accounts on
// an un-set-up install is exactly the authority that should not be
// anonymous, and the last case here pins it shut.
//
// Run: node --experimental-strip-types --test tests/js/test-unconfigured-install-bootstrap.mjs

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_SECRET = process.env.LARIAT_PIN_SECRET;

const OPERATOR_PIN = '4242';
process.env.LARIAT_PIN = OPERATOR_PIN;
delete process.env.LARIAT_PIN_SECRET;

const db = await import('../../lib/db.ts');
db.setDbPathForTest(':memory:');
const conn = db.getDb();

const pin = await import('../../lib/pin.ts');
const pinRoute = await import('../../app/api/auth/pin/route.ts');
const managerPinRoute = await import('../../app/api/auth/manager-pins/route.js');

after(() => {
  db.setDbPathForTest(null);
  if (ORIGINAL_PIN === undefined) delete process.env.LARIAT_PIN;
  else process.env.LARIAT_PIN = ORIGINAL_PIN;
  if (ORIGINAL_SECRET === undefined) delete process.env.LARIAT_PIN_SECRET;
  else process.env.LARIAT_PIN_SECRET = ORIGINAL_SECRET;
});

beforeEach(() => {
  process.env.LARIAT_PIN = OPERATOR_PIN;
  delete process.env.LARIAT_PIN_SECRET;
  conn.exec('DELETE FROM manager_pin_users; DELETE FROM audit_events;');
});

function jsonReq(path, body, { method = 'POST', cookie = null } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Pull the lariat_pin_ok cookie out of a Set-Cookie response header. */
function pinCookieFrom(res) {
  const raw = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')];
  const line = raw.filter(Boolean).find((c) => c.startsWith('lariat_pin_ok='));
  assert.ok(line, `no lariat_pin_ok cookie in Set-Cookie: ${JSON.stringify(raw)}`);
  return line.split(';')[0];
}

describe('the credential exchange stays reachable without a credential', () => {
  // The chicken-and-egg case. /api/auth/pin is the route that hands out the
  // cookie, so gating it on the cookie would lock every operator out
  // permanently. It is on the ALLOWLIST in test-pin-gate-coverage.mjs for
  // this reason; this asserts the behaviour rather than the listing.
  it('accepts the operator PIN with no cookie and returns one', async () => {
    const res = await pinRoute.POST(jsonReq('/api/auth/pin', { pin: OPERATOR_PIN }));
    assert.equal(res.status, 200, 'operator cannot sign in — install is bricked');
    assert.ok(pinCookieFrom(res).startsWith('lariat_pin_ok='));
  });

  it('still rejects a wrong PIN', async () => {
    const res = await pinRoute.POST(jsonReq('/api/auth/pin', { pin: '9999' }));
    assert.notEqual(res.status, 200);
  });
});

describe('the cookie it returns actually opens the gate', () => {
  it('satisfies requirePin end to end', async () => {
    const signIn = await pinRoute.POST(jsonReq('/api/auth/pin', { pin: OPERATOR_PIN }));
    const cookie = pinCookieFrom(signIn);

    const req = new Request('http://localhost/api/anything', {
      headers: { cookie },
    });
    assert.equal(
      await pin.requirePin(req),
      null,
      'the cookie handed out by /api/auth/pin does not satisfy requirePin — ' +
        'sign-in succeeds but every gated surface stays shut',
    );
  });
});

describe('creating manager accounts is no longer anonymous', () => {
  const NEW_MANAGER = { name: 'Lunch Manager', pin: '1111' };

  it('refuses to create a manager PIN user without a credential', async () => {
    const res = await managerPinRoute.POST(jsonReq('/api/auth/manager-pins', NEW_MANAGER));
    assert.equal(
      res.status,
      401,
      'anyone on the network could mint themselves a manager account',
    );
  });

  it('refuses on an install with nothing configured at all', async () => {
    // The case that actually demonstrates the flip. With LARIAT_PIN set the
    // one above passes either way, because pinConfigured() was already true.
    // Here nothing is configured — no env override, no manager users — which
    // is precisely when pinRequiredForPic() used to return false and this
    // route, sitting outside the middleware matcher, answered anonymously.
    delete process.env.LARIAT_PIN;
    try {
      assert.equal(pin.pinConfigured(), false, 'test setup: install should read as unconfigured');
      const res = await managerPinRoute.POST(jsonReq('/api/auth/manager-pins', NEW_MANAGER));
      assert.equal(
        res.status,
        401,
        'a fresh install let an anonymous caller create a manager account',
      );
    } finally {
      process.env.LARIAT_PIN = OPERATOR_PIN;
    }
  });

  it('creates one for a signed-in operator', async () => {
    const signIn = await pinRoute.POST(jsonReq('/api/auth/pin', { pin: OPERATOR_PIN }));
    const cookie = pinCookieFrom(signIn);

    const res = await managerPinRoute.POST(
      jsonReq('/api/auth/manager-pins', NEW_MANAGER, { cookie }),
    );
    assert.notEqual(res.status, 401, 'signed-in operator cannot add a manager');
    assert.ok(res.status < 400, `manager create failed with ${res.status}`);
  });
});
