/**
 * Reusable rollup tile shell for /management.
 *
 * Read-only at-a-glance card. Each tile composes one already-shipped
 * compute helper (or a tiny inline read) and surfaces a single signal
 * a GM should change a decision over today.
 *
 * No business logic lives here — color rules and values are decided
 * by the page that mounts the tile.
 */

import Link from 'next/link';

/**
 * @param {{
 *   label: string,
 *   value: React.ReactNode,
 *   color?: string,                // CSS var like 'var(--green)'
 *   sub?: React.ReactNode,         // small caption under the value
 *   href?: string,                 // optional drilldown
 *   note?: React.ReactNode,        // optional warning row (e.g. amber empty-state)
 * }} props
 */
export default function RollupTile({ label, value, color, sub, href, note }) {
  const borderColor = color ?? 'var(--muted)';
  const valueColor = color ?? 'inherit';

  const inner = (
    <div className="card" style={{ borderColor, height: '100%' }}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color: valueColor }}>{value}</div>
      {sub != null ? (
        <div style={{ fontSize: 12, marginTop: 6 }}>{sub}</div>
      ) : null}
      {note != null ? (
        <div style={{ fontSize: 11, marginTop: 6, color: 'var(--yellow)' }}>{note}</div>
      ) : null}
    </div>
  );

  if (href) {
    return (
      <Link href={href} style={{ textDecoration: 'none', color: 'inherit' }}>
        {inner}
      </Link>
    );
  }
  return inner;
}
