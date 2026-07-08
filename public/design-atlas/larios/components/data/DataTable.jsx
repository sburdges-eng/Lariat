import React from 'react';

/**
 * DataTable — a dense grid. Sticky mono uppercase header with a solid bottom
 * hairline, barely-perceptible zebra striping, right-aligned numeric columns
 * with tabular figures. Ported from the .data-table primitive + the grid
 * conventions in the shipping boards.
 *
 * columns: [{ key, label, align?: 'left'|'right', mono?: boolean, width? }]
 * rows:    array of objects keyed by column.key (values are ReactNodes)
 */
export function DataTable({ columns = [], rows = [], zebra = true, style, ...rest }) {
  return (
    <div style={{ overflow: 'auto', border: '1px solid var(--hair)', borderRadius: 'var(--radius-sm)', ...style }} {...rest}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                  textAlign: c.align || 'left',
                  padding: '8px 12px',
                  fontFamily: 'var(--mono)',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '.12em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                  background: 'var(--panel-2)',
                  borderBottom: '1px solid var(--hair)',
                  whiteSpace: 'nowrap',
                  width: c.width,
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.id ?? i}
              style={{ background: zebra && i % 2 ? 'var(--panel-2)' : 'var(--panel)' }}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  style={{
                    textAlign: c.align || 'left',
                    padding: '8px 12px',
                    color: 'var(--text)',
                    borderBottom: '1px solid var(--hair)',
                    fontFamily: c.mono || c.align === 'right' ? 'var(--mono)' : 'var(--sans)',
                    fontVariantNumeric: c.mono || c.align === 'right' ? 'tabular-nums' : 'normal',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
