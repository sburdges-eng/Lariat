import { rankByContribution } from '../../../lib/abcRanking';

function dollars(n) {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

function tierCount(rows, tier) {
  return rows.filter((r) => r.tier === tier).length;
}

function tierShare(rows, tier) {
  const total = rows.reduce((s, r) => s + r.scoreCents, 0);
  if (total === 0) return 0;
  const tierTotal = rows
    .filter((r) => r.tier === tier)
    .reduce((s, r) => s + r.scoreCents, 0);
  return (tierTotal / total) * 100;
}

export default function AbcTile({ menuRows }) {
  const ranked = rankByContribution(menuRows);
  const topA = ranked.filter((r) => r.tier === 'A').slice(0, 5);
  const linkedTotal = ranked.filter((r) => r.tier !== 'unranked').length;

  return (
    <section className="card" style={{ padding: 16 }}>
      <div className="row-meta" style={{ marginBottom: 8 }}>
        ABC contribution
      </div>
      {linkedTotal === 0 ? (
        <p className="row-meta" style={{ color: 'var(--amber, #8a5a00)' }}>
          No costed dishes yet — wire dish_components for the menu items
          before this tile becomes useful.
        </p>
      ) : (
        <>
          <dl style={{ display: 'grid', gap: 6, margin: 0 }}>
            <TierRow tier="A" rows={ranked} />
            <TierRow tier="B" rows={ranked} />
            <TierRow tier="C" rows={ranked} />
            <TierRow tier="unranked" rows={ranked} label="unranked · no costing" />
          </dl>
          {topA.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <div className="row-meta">Top {topA.length} in tier A</div>
              <ol style={{ margin: '6px 0 0 18px', padding: 0 }}>
                {topA.map((r) => (
                  <li key={r.itemName} style={{ fontSize: 13 }}>
                    {r.itemName} · {dollars(r.contributionDollars / r.qty || 0)}{' '}
                    margin/unit · {r.qty} sold
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function TierRow({ tier, rows, label }) {
  const count = tierCount(rows, tier);
  const share = tierShare(rows, tier);
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <dt>{label ?? `Tier ${tier}`}</dt>
      <dd style={{ margin: 0 }}>
        {count} {count === 1 ? 'dish' : 'dishes'} · {share.toFixed(0)}% of margin
      </dd>
    </div>
  );
}
