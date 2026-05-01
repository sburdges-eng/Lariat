// Stub implementation of the Lariat <-> KDS tickets contract (v1).
//
// Spec: ~/Dev/Lariat-KDS/docs/lariat-kds-protocol.md §2.
// Returns the protocol-defined shape:
//   { tickets: [ { id, order_number, placed_at, destination?, lines[]: { id, item_name, quantity, station, modifiers? } } ] }
//
// PUBLIC endpoint by design — the Swift app's discover probe is also
// public, and the iPad may not have the PIN cookie when it first
// connects. KDS protocol §2 treats 404 as "endpoint not yet enabled";
// we deliberately return 200 with synthetic data so the Swift client
// can be pointed at a real Lariat instance and exercise its parser.
//
// NOTE: do NOT pull from `sales_lines` — those are POS-after-the-fact
// rows, not active tickets, and conflating them would teach the KDS
// the wrong shape.
//
// SWAP POINT: when Toast Partner ingest lands, replace the synthetic
// `STUB_TICKETS` array below with a query against the live ticket
// store (likely `lib/toastTickets.ts` or similar). The route's
// response shape MUST stay identical — the Swift parser at
// Sources/LariatKDSCore/TicketParser.swift is the binding contract.
//
// Uses Response.json shape rather than next/server's NextResponse so
// the route function is loadable from the Node test runner — same
// pattern as /api/shows/[id]/settlement/route.js.

function json(body, init) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
}

// Synthetic ticket fixtures, mirrored from Lariat-KDS MockTicketSource so
// the Swift app sees a familiar shape during integration. Timestamps are
// computed at request time so the UI's age-coloring exercises real
// "minutes ago" math instead of always rendering the same stale ticket.
function buildStubTickets(now = new Date()) {
  const minutesAgo = (m) => new Date(now.getTime() - m * 60_000).toISOString();

  return [
    {
      id: 'tkt_stub_1042',
      order_number: '1042',
      placed_at: minutesAgo(2),
      destination: 'T12',
      lines: [
        {
          id: 'ln_1042_1',
          item_name: 'Smoked Brisket',
          quantity: 2,
          station: 'grill',
          modifiers: 'no pickle; sub fries',
        },
        {
          id: 'ln_1042_2',
          item_name: 'Mac & Cheese',
          quantity: 1,
          station: 'sides',
        },
      ],
    },
    {
      id: 'tkt_stub_1043',
      order_number: '1043',
      placed_at: minutesAgo(5),
      destination: 'Bar',
      lines: [
        {
          id: 'ln_1043_1',
          item_name: 'Old Fashioned',
          quantity: 1,
          station: 'bar',
          modifiers: 'rye',
        },
      ],
    },
    {
      id: 'tkt_stub_1044',
      order_number: '1044',
      placed_at: minutesAgo(9),
      destination: 'Togo',
      lines: [
        {
          id: 'ln_1044_1',
          item_name: 'Pulled Pork Sandwich',
          quantity: 1,
          station: 'grill',
        },
        {
          id: 'ln_1044_2',
          item_name: 'Collard Greens',
          quantity: 1,
          station: 'sides',
        },
      ],
    },
    {
      id: 'tkt_stub_1045',
      order_number: '1045',
      placed_at: minutesAgo(14),
      lines: [
        {
          id: 'ln_1045_1',
          item_name: 'Half Rack Ribs',
          quantity: 1,
          station: 'grill',
          modifiers: 'extra sauce on side',
        },
        {
          id: 'ln_1045_2',
          item_name: 'Cornbread',
          quantity: 2,
          station: 'sides',
        },
      ],
    },
  ];
}

export async function GET() {
  return json({ tickets: buildStubTickets() }, { status: 200 });
}

// Exported for the Node test runner so it can call GET() directly.
export { buildStubTickets };
