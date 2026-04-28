import { getDb } from '../../../lib/db';
import { archiveSearch, archiveEras } from '../../../lib/showsRepo';
import ArchiveSearch from './ArchiveSearch';

export const dynamic = 'force-dynamic';

export default function ArchivePage() {
  const db = getDb();
  const rows = archiveSearch(db, 'default', {});
  const eras = archiveEras(db, 'default');

  return (
    <div className="page">
      <header style={{ marginBottom: 18 }}>
        <div className="row-meta" style={{ letterSpacing: '.18em' }}>SHOWS · ARCHIVE</div>
        <h1 className="serif" style={{ fontSize: 38, lineHeight: 1.1 }}>
          Past <em>shows</em>
        </h1>
        <div className="row-meta">{rows.length} shows on file.</div>
      </header>
      <ArchiveSearch initialRows={rows} eras={eras} />
    </div>
  );
}
