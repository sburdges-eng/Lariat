import { getDb } from '../../lib/db';
import { upcomingShows, pipelineCounts } from '../../lib/showsRepo';
import BookingCalendar from './BookingCalendar';
import BookingPipeline from './BookingPipeline';

export const dynamic = 'force-dynamic';

export default function BookingPage() {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const rows = upcomingShows(db, 'default', { today, weeks: 5 });
  const counts = pipelineCounts(db, 'default', { today, weeks: 52 });

  return (
    <div className="page">
      <header style={{ marginBottom: 18 }}>
        <div className="row-meta" style={{ letterSpacing: '.18em' }}>BOOKING</div>
        <h1 className="serif" style={{ fontSize: 38, lineHeight: 1.1 }}>
          The <em>calendar</em>
        </h1>
        <div className="row-meta">Five weeks ahead — click an artist to open the playbook.</div>
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
