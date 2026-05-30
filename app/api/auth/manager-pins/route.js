// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts.
// Manager PIN users: editable local manager credentials beside LARIAT_PIN.

import { json } from '../../../../lib/routeHelpers';
import { getDb } from '../../../../lib/db';
import { requirePin } from '../../../../lib/pin';
import { locationFromBody, locationFromRequest } from '../../../../lib/location';
import {
  createManagerPinUser,
  disableManagerPinUser,
  listManagerPinUsers,
  updateManagerPinUser,
} from '../../../../lib/managerPins.ts';
import { postAuditEvent } from '../../../../lib/auditEvents';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  try {
    const location = locationFromRequest(req);
    const users = listManagerPinUsers({ locationId: location, includeDisabled: true });
    return json({ users }, { status: 200 });
  } catch (err) {
    console.error('GET /api/auth/manager-pins failed:', err);
    return json({ error: 'could not load PIN users' }, { status: 500 });
  }
}

export async function POST(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body is not valid JSON' }, { status: 422 });
  }

  try {
    const location = locationFromBody(body);
    const user = getDb().transaction(() => {
      const created = createManagerPinUser({
        name: body?.name,
        pin: body?.pin,
        role: body?.role,
        locationId: location,
      });
      audit('insert', created, location);
      return created;
    })();
    return json({ user }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'could not save PIN user' }, { status: 422 });
  }
}

export async function PATCH(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body is not valid JSON' }, { status: 422 });
  }

  try {
    const location = locationFromBody(body);
    const user = getDb().transaction(() => {
      const updated = updateManagerPinUser({
        id: body?.id,
        name: body?.name,
        pin: body?.pin,
        role: body?.role,
        isActive: body?.is_active,
        locationId: location,
      });
      audit('update', updated, location);
      return updated;
    })();
    return json({ user }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'could not update PIN user' }, { status: 422 });
  }
}

export async function DELETE(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body is not valid JSON' }, { status: 422 });
  }

  try {
    const location = locationFromBody(body);
    const user = getDb().transaction(() => {
      const disabled = disableManagerPinUser(body?.id, location);
      audit('update', disabled, location);
      return disabled;
    })();
    return json({ user }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'could not disable PIN user' }, { status: 422 });
  }
}

function audit(action, user, location) {
  postAuditEvent({
    entity: 'manager_pin_user',
    entity_id: user.id,
    action,
    actor_cook_id: null,
    actor_source: 'manager_ui',
    location_id: location,
    payload: {
      name: user.name,
      role: user.role,
      is_active: user.is_active,
    },
  });
}
