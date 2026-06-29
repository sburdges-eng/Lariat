# Catering Estimate — Heritage Render (Increment 1)

**Date:** 2026-06-29
**Branch:** `feat/catering-estimate-heritage`
**Status:** Spec — awaiting review

## Goal

Promote the validated Estimate Builder prototype to a real surface by rendering an existing
BEO event as a heritage-branded ("1885") catering estimate document. One shared presentational
component, `EstimateDocument`, is rendered in two places: a new **operator** route
(`/beo/[id]/estimate`) and the existing **client** share route (`/beo/share/[token]`), which is
re-skinned from its current warm-bone `.paper` styling to the heritage design. No new editor and no
new data model — `BeoBoard` already edits `beo_events` + `beo_line_items`, and a BEO event already
*is* the estimate (line items carry `unit_cost` × `quantity`, plus event-level `tax_rate` and
`service_fee_pct`).

## Non-goals (this increment)

- **Operator food-cost overlay** — deferred to increment 2 (needs a validated line-item→recipe→
  `recipe_costs` join; the client view never shows it anyway).
- **F&B-minimum / over-under meter** — `beo_events` has no `min_spend` column; would require a
  schema migration + version bump. Deferred.
- **Interactive editing / add-line / live recalc** — `BeoBoard` owns editing. This surface is
  read-only presentation.
- **New DB tables or columns, PDF-export button** — browser print already works; we only ensure
  print CSS. No `dish_components`/`vendor_prices` reads this round.
- **New webfonts (Playfair/Source Serif)** — reuse the app's existing `--display` / `--sans` /
  `--mono`; heritage feel comes from the bands + wordmark.

## User-facing surface

### Component — `app/beo/_components/EstimateDocument.jsx`

Pure, presentational. No data fetching, no DB access. Renders the heritage estimate from props.

```js
EstimateDocument({
  event,        // { id, title, event_date, event_time, contact_name, guest_count, notes,
                //   tax_rate, service_fee_pct, status }
  sections,     // [ { label, items: [ { id, item_name, category, unit_cost, quantity,
                //     course_label?, line_total } ] } ]  (grouped + ordered by caller)
  totals,       // { subtotal, serviceFee, tax, total }  (from computeEstimateTotals)
  courses,      // [ { id, course_label, fire_at, notes } ]  (optional schedule block)
  signatures,   // [ { id, signed_name, signed_at } ]
  register,     // 'client' | 'operator'
  signSlot,     // optional React node (the client SignForm); rendered only when provided
}) => JSX
```

- Layout (heritage register): wordmark masthead → "Catering Estimate" title + quote meta →
  Prepared-For / Event-Details → menu grouped into **brass section bands** (one per `sections[]`
  entry) with a navy column-header band → subtotal / service / tax → navy **Estimated Total** band →
  terms → signature block (`signSlot` + prior signatures).
- `register==='operator'` may show operator-only nodes (`data-print="false"`); none are required this
  round, but the prop + the gating CSS hook (`.estimate-doc.client [data-print="false"]{display:none}`)
  are established now so increment 2 (food-cost) drops in without re-plumbing.

### Helper — `lib/beoEstimate.ts`

```ts
export function computeEstimateTotals(
  event: { tax_rate?: number; service_fee_pct?: number },
  lineItems: Array<{ unit_cost?: number; quantity?: number }>,
): { subtotal: number; serviceFee: number; tax: number; total: number }

export function groupLineItemsBySection(
  lineItems: Array<LineItem>,
  courses: Array<{ id: number; course_label: string }>,
): Array<{ label: string; items: LineItem[] }>
```

`computeEstimateTotals` is the single source of the math currently duplicated inline in the share
page. `groupLineItemsBySection` groups by `category` (fallback: course label, then `"Menu"`),
preserving `sort_order`.

### Route — `app/beo/[id]/estimate/page.jsx` (operator)

- Server component, `export const dynamic = 'force-dynamic'`, gated like other operator surfaces
  (`hasPinCookie()` → redirect/login-pin if absent).
- Loads the event + line items + courses + signatures by `id` (existing prepared-statement shapes),
  computes totals + sections via `lib/beoEstimate`, renders `EstimateDocument register="operator"`
  inside the app shell, with a "Copy client link" action (reads existing `share_token`).
- Unknown/!exists id → `notFound()`.

### Route — `app/beo/share/[token]/page.jsx` (client, refactor)

- Same data loads as today. Replace the hand-rolled `.paper` JSX (header/menu/totals) with
  `EstimateDocument register="client"` + `signSlot={<SignForm token={token} />}`.
- Preserve exactly: token-shape validation, `notFound()` for bad/missing token, chrome-hide `<style>`,
  `SignForm` POST flow, and the signatures list.

### Styling — `styles/estimate.css` (new), imported by `EstimateDocument`

All rules scoped under `.estimate-doc` (navy `#1F2D3D`, brass `#A8772F`, cream `#F4F0E8`, ink, slate).
Scoping guarantees no regression to other `.paper` consumers. Includes a `@media print` block that
forces band background colors (`print-color-adjust: exact`) and hides `[data-print="false"]`.

## Data model deltas

**None.** Reuses `beo_events`, `beo_line_items`, `beo_courses`, `beo_signatures` as-is. No migration,
no `schema_version` bump (so `check-schema-version-bump` stays green).

## Invariants

1. **Totals math is preserved to the cent**: `subtotal = Σ(unit_cost × quantity)`,
   `serviceFee = subtotal × service_fee_pct/100`, `tax = subtotal × tax_rate`,
   `total = subtotal + serviceFee + tax`. The refactored share page must produce identical numbers to
   the current implementation for the same event.
2. **Register gating**: with `register==='client'`, no `[data-print="false"]` node is visible
   (enforced by CSS + asserted in tests) — operator-only data can never leak to a client.
3. **Style isolation**: every new rule is under `.estimate-doc`; no edits to global `.paper` / token
   behavior; other pages render unchanged.
4. **Share-route contract unchanged**: identical auth, `notFound`, and sign-flow behavior.
5. **No DB writes** from either route (read-only render; signing stays in the existing `SignForm` API).

## Open questions

1. **Wordmark asset** — is there an existing Lariat logo file (e.g. `public/…`) to reuse, or do we
   inline the SVG approximation from the prototype? (Locate during T1; default to inline SVG.)
2. **Section order** — `category` values are freeform operator text. Use a known-order list
   (Passed → Buffet → Family → Desserts → Boards → Bar & Fees) with unknown categories appended
   alphabetically? (Proposed: yes.)
3. **Bar & fees lines** — items like "Open Bar"/"Booking Fee" have no per-unit price; render with an
   em-dash qty as the prototype does. Confirm they live in their own section band.
4. **`/beo/[id]/estimate` gating** — confirm the exact existing operator-gate pattern (PIN cookie
   helper + redirect target) to mirror it precisely.
