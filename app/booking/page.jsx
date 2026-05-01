import Link from 'next/link';
import { getDb } from '../../lib/db';
import { upcomingShows, pipelineCounts, nextUpcoming } from '../../lib/showsRepo';
import BookingCalendar from './BookingCalendar';
import BookingPipeline from './BookingPipeline';

export const dynamic = 'force-dynamic';

export default function BookingPage() {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const rows = upcomingShows(db, 'default', { today, weeks: 5 });
  const counts = pipelineCounts(db, 'default', { today, weeks: 52 });
  const next = nextUpcoming(db, 'default', { today });

  return (
    <div className="page">
      <header style={{ marginBottom: 18 }}>
        <div className="row-meta" style={{ letterSpacing: '.18em' }}>BOOKING</div>
        <h1 className="serif" style={{ fontSize: 38, lineHeight: 1.1 }}>
          The <em>calendar</em>
        </h1>
        <div className="row-meta">Five weeks ahead — click an artist to open the playbook.</div>
        {next && (
          <div className="toggles" style={{ marginTop: 12, gap: 6 }}>
            <span className="row-meta" style={{ alignSelf: 'center' }}>
              Next show ({next.band_name}):
            </span>
            <Link className="btn sm" href={`/shows/${next.id}/stage`}>
              Stage
            </Link>
            <Link className="btn sm" href={`/shows/${next.id}/sound`}>
              Sound
            </Link>
            <Link className="btn sm" href={`/shows/${next.id}/box-office`}>
              Box office
            </Link>
            <Link className="btn sm" href={`/shows/${next.id}/settlement`}>
              Settlement
            </Link>
          </div>
        )}
      </header>
      <section style={{ marginBottom: 24 }}>
        <div className="sec-head">
          <div className="sec-title">Booking pipeline</div>
          <div className="sec-sub">live count by stage</div>
        </div>
        <BookingPipeline counts={counts} />
      </section>
      <section>
        <div className="sec-head">
          <div className="sec-title">Five weeks ahead</div>
          <div className="sec-sub">{rows.length} confirmed shows</div>
        </div>
        <BookingCalendar rows={rows} />
      </section>
    </div>
  );
}
