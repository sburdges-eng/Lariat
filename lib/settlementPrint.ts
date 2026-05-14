// Pure HTML renderer for the print-ready settlement summary.
//
// The route at app/api/shows/[id]/settlement/pdf serves the output of
// renderSettlementHtml() with content-type text/html. The operator hits
// the browser's "Save as PDF" from the print dialog (auto-opened by the
// inline script at the bottom of the document).
//
// This keeps the local-first stance: no headless-browser dep, no PDF
// library, no external service. The operator chooses paper size and
// destination.

import type { SettlementSummary } from './settlementRepo.ts';

const SOURCE_LABELS: Record<string, string> = {
  dice: 'DICE',
  walkup: 'Walk-up',
  comp: 'Comp',
  will_call: 'Will call',
  guestlist: 'Guest list',
};

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dollars(cents: number): string {
  const n = Number(cents) || 0;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n) / 100;
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}$${formatted}`;
}

function moneyRow(label: string, cents: number, opts?: { strong?: boolean }): string {
  const weight = opts?.strong ? 'strong' : 'normal';
  return `<div class="row row-${weight}"><span class="label">${escapeHtml(label)}</span><span class="value">${dollars(cents)}</span></div>`;
}

function numberRow(label: string, value: number): string {
  return `<div class="row row-normal"><span class="label">${escapeHtml(label)}</span><span class="value">${Number(value) || 0}</span></div>`;
}

function ticketSourceRows(summary: SettlementSummary): string {
  const entries = Object.entries(summary.ticketing.bySource).filter(
    ([, v]) => v.qty > 0,
  );
  if (entries.length === 0) return '<div class="row-meta">No ticket lines yet.</div>';
  return entries
    .map(
      ([source, v]) =>
        `<div class="row row-normal"><span class="label">${escapeHtml(
          SOURCE_LABELS[source] ?? source,
        )}</span><span class="value">${v.qty} · ${dollars(v.grossCents)}</span></div>`,
    )
    .join('');
}

function costsOffTopRows(summary: SettlementSummary): string {
  const items = summary.deal.costsOffTop;
  if (!items || items.length === 0) {
    return '<div class="row-meta">No costs off top.</div>';
  }
  return items
    .map((c) => moneyRow(c.label, c.cents))
    .concat([moneyRow('Total costs off top', summary.costsOffTopCents, { strong: true })])
    .join('');
}

const STYLE = `
  :root {
    --ink: #1c160e;
    --paper: #fffdf7;
    --muted: #6b5e44;
    --line: #cfc6b0;
    --amber: #8a5a00;
    --panel-2: #f7f2e8;
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: var(--ink);
    background: var(--paper);
    margin: 0;
    padding: 24px;
    line-height: 1.4;
  }
  header.sheet-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    border-bottom: 1px solid var(--line);
    padding-bottom: 12px;
    margin-bottom: 18px;
  }
  header.sheet-header h1 {
    font-size: 22px;
    margin: 0;
  }
  header.sheet-header .meta {
    color: var(--muted);
    font-size: 13px;
  }
  .grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
    margin-bottom: 18px;
  }
  .card {
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 14px;
    background: white;
    page-break-inside: avoid;
  }
  .card.feature { background: var(--panel-2); }
  .card h2 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin: 0 0 10px 0;
  }
  .row { display: flex; justify-content: space-between; padding: 3px 0; }
  .row-strong { font-weight: 700; border-top: 1px solid var(--line); margin-top: 4px; padding-top: 6px; }
  .row-meta { color: var(--muted); font-size: 13px; margin-top: 8px; }
  .big-money { font-size: 38px; font-weight: 700; line-height: 1; margin: 6px 0; }
  .footer {
    margin-top: 24px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: 12px;
    display: flex;
    justify-content: space-between;
  }
  .warning { color: var(--amber); }
  @media print {
    body { padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
    .card { break-inside: avoid; }
  }
  @page { size: letter; margin: 0.5in; }
`;

const AUTO_PRINT_SCRIPT = `
  // Auto-open the print dialog on load. Wrapped in a timeout so the
  // browser can lay out the document first.
  if (typeof window !== 'undefined') {
    window.addEventListener('load', function () {
      setTimeout(function () { window.print(); }, 250);
    });
  }
`;

export function renderSettlementHtml(summary: SettlementSummary): string {
  const bandName = escapeHtml(summary.show.bandName);
  const date = escapeHtml(summary.show.date);
  const locationId = escapeHtml(summary.show.locationId);
  const computedAt = escapeHtml(summary.computedAt);

  const vsPct =
    summary.deal.vsPctAfterCosts == null
      ? '—'
      : `${(summary.deal.vsPctAfterCosts * 100).toFixed(0)}%`;

  const toastWarning =
    summary.toast.rowsFound === 0
      ? `<div class="row-meta warning">No Toast rows for ${date} yet — settlement may be incomplete.</div>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Settlement — ${bandName} — ${date}</title>
<style>${STYLE}</style>
</head>
<body>
<header class="sheet-header">
  <h1>${bandName}</h1>
  <div class="meta">${date} · ${locationId}</div>
</header>

<div class="grid-2">
  <section class="card">
    <h2>Tickets</h2>
    ${moneyRow('Gross', summary.ticketing.grossCents)}
    ${moneyRow('Fees', summary.ticketing.feesCents)}
    ${moneyRow('Net', summary.ticketing.netCents, { strong: true })}
    <div class="row-meta">${ticketSourceRows(summary)}</div>
  </section>

  <section class="card">
    <h2>Toast</h2>
    ${moneyRow('Net sales', summary.toast.totalCents)}
    ${numberRow('Orders', summary.toast.ordersCount)}
    ${numberRow('Guests', summary.toast.guestsCount)}
    ${toastWarning}
  </section>
</div>

<div class="grid-2">
  <section class="card">
    <h2>Deal terms</h2>
    ${moneyRow('Guarantee', summary.deal.guaranteeCents)}
    <div class="row row-normal"><span class="label">vs % after costs</span><span class="value">${vsPct}</span></div>
    ${moneyRow('Buyout', summary.deal.buyoutCents)}
  </section>

  <section class="card">
    <h2>Costs off top</h2>
    ${costsOffTopRows(summary)}
  </section>
</div>

<div class="grid-2">
  <section class="card">
    <h2>Talent payout</h2>
    ${moneyRow('Guarantee', summary.talent.guaranteeCents)}
    ${moneyRow('vs bonus', summary.talent.vsBonusCents)}
    ${moneyRow('Buyout', summary.talent.buyoutCents)}
    ${moneyRow('Total', summary.talent.totalCents, { strong: true })}
  </section>

  <section class="card feature">
    <h2>Net to door</h2>
    <div class="big-money">${dollars(summary.netDoorCents)}</div>
    <div class="row-meta">tickets net − costs off top − talent payout</div>
  </section>
</div>

<footer class="footer">
  <div>Computed ${computedAt}</div>
  <div>Lariat settlement · ${bandName}</div>
</footer>

<script>${AUTO_PRINT_SCRIPT}</script>
</body>
</html>`;
}
