// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';

// UnmappedCallout — shared warning band for the cascade panels. Renders when
// any of: unmapped items, an engine error, unapplied on-hand count lines, or
// manifest warnings exist. Always visible alongside row data — never an
// alternative state. No silent drops (AGENTS.md #4).
//
// Props:
//   unmapped         — array of { menu_item, reason }
//   error            — optional engine error string
//   onHandUnapplied  — array of { ingredient, unit, on_hand, reason }
//   manifestWarnings — array of { recipe, sub_slug?, issue }

export default function UnmappedCallout({ unmapped = [], error, onHandUnapplied = [], manifestWarnings = [] }) {
  const hasUnmapped = Array.isArray(unmapped) && unmapped.length > 0;
  const hasError = Boolean(error);
  const hasUnapplied = Array.isArray(onHandUnapplied) && onHandUnapplied.length > 0;
  const hasWarnings = Array.isArray(manifestWarnings) && manifestWarnings.length > 0;

  if (!hasUnmapped && !hasError && !hasUnapplied && !hasWarnings) return null;

  return (
    <div data-testid="event-cascade-unmapped" className="beo-unmapped-callout">
      {hasError && (
        <div className="beo-unmapped-error">
          <strong>Engine error:</strong> {error}
        </div>
      )}
      {hasUnmapped && (
        <>
          <div className="beo-unmapped-heading">
            Unmapped items — not included in cascade output:
          </div>
          <ul className="beo-unmapped-list">
            {unmapped.map((item, i) => (
              <li key={`${item.menu_item}-${i}`} className="beo-unmapped-item">
                <strong>{item.menu_item}</strong>
                {item.reason ? <span className="beo-unmapped-reason"> — {item.reason}</span> : null}
              </li>
            ))}
          </ul>
        </>
      )}
      {hasUnapplied && (
        <>
          <div className="beo-unmapped-heading">
            Stock not applied — counted on-hand that matched no order-guide item:
          </div>
          <ul className="beo-unmapped-list">
            {onHandUnapplied.map((row, i) => (
              <li key={`${row.ingredient}-${row.unit}-${i}`} className="beo-unmapped-item">
                <strong>{row.ingredient}</strong>
                <span className="beo-unmapped-reason"> — {row.on_hand} {row.unit}{row.reason ? ` (${row.reason})` : ''}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {hasWarnings && (
        <>
          <div className="beo-unmapped-heading">
            Recipe warnings:
          </div>
          <ul className="beo-unmapped-list">
            {manifestWarnings.map((w, i) => (
              <li key={`${w.recipe}-${i}`} className="beo-unmapped-item">
                <strong>{w.recipe}</strong>
                {w.issue ? <span className="beo-unmapped-reason"> — {w.issue}</span> : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
