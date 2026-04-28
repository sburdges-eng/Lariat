import Link from 'next/link';
import StatusPill from '../../../playbook/StatusPill';

export default function ShowHeader({ show, locationId }) {
  const locQuery = locationId && locationId !== 'default' ? `?location=${locationId}` : '';
  const statusEntries =
    show?.status && typeof show.status === 'object'
      ? Object.entries(show.status).filter(([, v]) => v && String(v).trim())
      : [];

  return (
    <header style={{ marginBottom: 18 }}>
      <div className="row-meta" style={{ letterSpacing: '.18em' }}>
        EVENT OPS · SHOW {show.id}
      </div>
      <h1 className="serif" style={{ fontSize: 38, lineHeight: 1.1 }}>
        {show.band_name}
      </h1>
      <div className="row-meta">
        {show.show_date} · <Link href={`/booking${locQuery}`}>switch show</Link>
        {' · '}
        <Link href={`/playbook?show=${show.id}${locQuery ? '&' + locQuery.slice(1) : ''}`}>
          marketing playbook
        </Link>
      </div>
      {statusEntries.length > 0 && (
        <div className="toggles" style={{ marginTop: 10, gap: 6, flexWrap: 'wrap' }}>
          {statusEntries.slice(0, 6).map(([col, val]) => (
            <StatusPill key={col} column={col} value={val} />
          ))}
        </div>
      )}
    </header>
  );
}
