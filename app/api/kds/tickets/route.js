// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
// Lariat <-> KDS tickets endpoint (v1).
//
// Spec: ~/Dev/Lariat-KDS/docs/lariat-kds-protocol.md §2.
// Wire shape (binding — Swift parser at Sources/LariatKDSCore/TicketParser.swift
// fails closed on drift):
//   { tickets: [ { id, order_number, placed_at, destination?,
//                  lines[]: { id, item_name, quantity, station, modifiers? } } ] }
//
// PUBLIC endpoint by design — the iPad may not have a PIN cookie when it
// first connects. KDS protocol §2 treats 404 as "endpoint not yet enabled";
// we return 200 always (with an empty array if the kitchen hasn't punched
// any tickets), so the Swift client can cleanly distinguish "no work yet"
// from "wrong server".
//
// NOTE: do NOT pull from `sales_lines` — those are POS-after-the-fact rows,
// not active tickets, and conflating them would teach the KDS the wrong
// shape.
//
// SWAP POINT: when Toast Partner ingest lands, swap the SELECT in GET()
// for a query against the live ticket store (likely lib/toastTickets.ts).
// Wire shape MUST stay identical.
//
// Until then, FOH/expo punches tickets via the form at /kds/punch (POSTs
// here), the iPad polls and renders them.

import { getDb } from '../../../../lib/db';
import { DEFAULT_LOCATION_ID, locationFromBody, locationFromRequest } from '../../../../lib/location';
// File audit (lib/auditLog.mjs) — KDS tickets are operational, not HACCP-
// regulated, and use TEXT (UUIDv7) ids which audit_events.entity_id (INTEGER)
// can't carry. Same posture as specials/saved.
import { logAuditAction } from '../../../../lib/auditLog.mjs';
import { withIdempotency } from '../../../../lib/idempotency';
import { uuidv7 } from '../../../../lib/uuid';
import { json } from '../../../../lib/routeHelpers';

export const dynamic = 'force-dynamic';

const MAX_ORDER_NUMBER = 32;
const MAX_DESTINATION = 64;
const MAX_ITEM_NAME = 200;
const MAX_STATION = 32;
const MAX_MODIFIERS = 500;

/**
 * Wire-shaped ticket line (protocol §2): `modifiers` is absent, not null.
 * @typedef {{ id: string, item_name: string, quantity: number, station: string, modifiers?: string }} WireLine
 */
/**
 * Wire-shaped ticket (protocol §2): `destination` is absent, not null.
 * @typedef {{ id: string, order_number: string, placed_at: string, destination?: string, lines: WireLine[] }} WireTicket
 */

/**
 * @param {unknown} s
 * @param {number} max
 * @returns {string | null}
 */
const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

// ── GET /api/kds/tickets ──────────────────────────────────────────

/** @param {Request} req */
export async function GET(req) {
  try {
    const locationId = locationFromRequest(req) || DEFAULT_LOCATION_ID;
    const db = getDb();

    // Nullability per lib/db.ts kds_tickets: only `destination` is nullable.
    const tickets = /** @type {{ id: string, order_number: string, placed_at: string, destination: string | null }[]} */ (db
      .prepare(
        `SELECT id, order_number, placed_at, destination
           FROM kds_tickets
          WHERE location_id = ? AND bumped_at IS NULL
          ORDER BY placed_at ASC, id ASC`,
      )
      .all(locationId));

    if (tickets.length === 0) {
      return json({ tickets: [] }, { status: 200 });
    }

    // One extra round-trip for the lines, then group in memory.
    // Avoids JSON_GROUP_ARRAY because we need protocol-shaped objects with
    // optional fields (destination/modifiers) absent rather than null.
    const ids = tickets.map((t) => t.id);
    const placeholders = ids.map(() => '?').join(',');
    // Nullability per lib/db.ts kds_ticket_lines: only `modifiers` is nullable.
    const lines = /** @type {{ id: string, ticket_id: string, item_name: string, quantity: number, station: string, modifiers: string | null, sort_order: number }[]} */ (db
      .prepare(
        `SELECT id, ticket_id, item_name, quantity, station, modifiers, sort_order
           FROM kds_ticket_lines
          WHERE ticket_id IN (${placeholders})
          ORDER BY ticket_id, sort_order, id`,
      )
      .all(...ids));

    /** @type {Map<string, WireLine[]>} */
    const linesByTicket = new Map();
    for (const l of lines) {
      const arr = linesByTicket.get(l.ticket_id) ?? [];
      /** @type {WireLine} */
      const obj = {
        id: l.id,
        item_name: l.item_name,
        quantity: l.quantity,
        station: l.station,
      };
      if (l.modifiers !== null && l.modifiers !== undefined) {
        obj.modifiers = l.modifiers;
      }
      arr.push(obj);
      linesByTicket.set(l.ticket_id, arr);
    }

    const out = tickets.map((t) => {
      /** @type {WireTicket} */
      const obj = {
        id: t.id,
        order_number: t.order_number,
        placed_at: t.placed_at,
        lines: linesByTicket.get(t.id) ?? [],
      };
      if (t.destination !== null && t.destination !== undefined) {
        obj.destination = t.destination;
      }
      return obj;
    });

    return json({ tickets: out }, { status: 200 });
  } catch (err) {
    console.error('GET /api/kds/tickets failed:', err);
    return json({ error: 'Failed to load tickets' }, { status: 500 });
  }
}

// ── POST /api/kds/tickets ─────────────────────────────────────────

/** @param {Request} req */
export async function POST(req) {
  return withIdempotency(req, () => kdsTicketsPostHandler(req));
}

/** @param {Request} req */
async function kdsTicketsPostHandler(req) {
  try {
    const body = await req.json();

    const orderNumber = clip(body.order_number, MAX_ORDER_NUMBER);
    if (!orderNumber) {
      return json({ error: 'order_number required' }, { status: 400 });
    }
    const destination = clip(body.destination, MAX_DESTINATION);

    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      return json({ error: 'at least one line is required' }, { status: 400 });
    }

    // Pre-validate every line shape so we fail fast before opening the tx.
    /** @type {{ itemName: string, quantity: number, station: string, modifiers: string | null }[]} */
    const validatedLines = [];
    for (let i = 0; i < body.lines.length; i++) {
      const raw = body.lines[i];
      const itemName = clip(raw?.item_name, MAX_ITEM_NAME);
      if (!itemName) {
        return json({ error: `lines[${i}].item_name required` }, { status: 400 });
      }
      const quantity = Number(raw?.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) {
        return json(
          { error: `lines[${i}].quantity must be an integer >= 1` },
          { status: 400 },
        );
      }
      const station = clip(raw?.station, MAX_STATION);
      if (!station) {
        return json({ error: `lines[${i}].station required` }, { status: 400 });
      }
      // Protocol §2: station is a lowercased slug.
      const stationSlug = station.toLowerCase();
      const modifiers = typeof raw?.modifiers === 'string'
        ? raw.modifiers.trim().slice(0, MAX_MODIFIERS) || null
        : null;
      validatedLines.push({ itemName, quantity, station: stationSlug, modifiers });
    }

    const locationId = locationFromBody(body);
    const cookId = clip(body.cook_id, 64);
    // placed_at: caller-supplied or 'now'. Always normalize to canonical
    // ISO-8601 so the Swift parser's strict ISO8601 decoder doesn't reject it.
    const rawPlaced = clip(body.placed_at, 40);
    let placedAt;
    if (rawPlaced) {
      const ms = Date.parse(rawPlaced);
      if (!Number.isFinite(ms)) {
        return json({ error: 'placed_at must be an ISO-8601 timestamp' }, { status: 400 });
      }
      placedAt = new Date(ms).toISOString();
    } else {
      placedAt = new Date().toISOString();
    }

    const ticketId = uuidv7();

    const db = getDb();
    const performWrite = db.transaction(() => {
      db.prepare(
        `INSERT INTO kds_tickets
           (id, location_id, order_number, placed_at, destination, created_by_cook_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(ticketId, locationId, orderNumber, placedAt, destination, cookId);

      const insertLine = db.prepare(
        `INSERT INTO kds_ticket_lines
           (id, ticket_id, sort_order, item_name, quantity, station, modifiers)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      /** @type {WireLine[]} */
      const linesOut = [];
      for (let i = 0; i < validatedLines.length; i++) {
        // noUncheckedIndexedAccess: i < length, so the element exists.
        const v = /** @type {(typeof validatedLines)[number]} */ (validatedLines[i]);
        const lineId = uuidv7();
        insertLine.run(lineId, ticketId, i, v.itemName, v.quantity, v.station, v.modifiers);
        /** @type {WireLine} */
        const lineObj = {
          id: lineId,
          item_name: v.itemName,
          quantity: v.quantity,
          station: v.station,
        };
        if (v.modifiers) lineObj.modifiers = v.modifiers;
        linesOut.push(lineObj);
      }

      logAuditAction({
        action: 'kds_tickets.create',
        ticket_id: ticketId,
        location_id: locationId,
        order_number: orderNumber,
        destination,
        line_count: validatedLines.length,
        cook_id: cookId,
      });

      return linesOut;
    });

    const linesOut = performWrite();

    /** @type {WireTicket} */
    const ticketOut = {
      id: ticketId,
      order_number: orderNumber,
      placed_at: placedAt,
      lines: linesOut,
    };
    if (destination) ticketOut.destination = destination;

    return json({ ok: true, ticket: ticketOut }, { status: 200 });
  } catch (err) {
    console.error('POST /api/kds/tickets failed:', err);
    return json({ error: 'Failed to punch ticket' }, { status: 500 });
  }
}
