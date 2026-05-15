// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { getDb } from '../../lib/db';
import { getShowById, nextUpcoming } from '../../lib/showsRepo';
import PlaybookHeader from './PlaybookHeader';
import AdsTab from './tabs/AdsTab';
import TicketsTab from './tabs/TicketsTab';
import NewsTab from './tabs/NewsTab';
import DayOfTab from './tabs/DayOfTab';

export const dynamic = 'force-dynamic';

const TABS = { ads: AdsTab, tickets: TicketsTab, news: NewsTab, dayof: DayOfTab };

export default function PlaybookPage({ searchParams }) {
  const sp = searchParams ?? {};
  const requestedId = Number(sp.show);
  const tab = TABS[sp.tab] ? sp.tab : 'ads';

  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  let show = Number.isFinite(requestedId) && requestedId > 0
    ? getShowById(db, 'default', requestedId)
    : null;
  if (!show) show = nextUpcoming(db, 'default', { today });

  if (!show) {
    return (
      <div className="page">
        <div className="card" style={{ padding: 18 }}>
          <div className="serif" style={{ fontSize: 22, marginBottom: 6 }}>
            No upcoming shows
          </div>
          <div className="row-meta">
            Nothing on the books yet — pull fresh after Lauren updates the booking sheet.
          </div>
        </div>
      </div>
    );
  }

  const TabComp = TABS[tab];
  return (
    <div className="page">
      <PlaybookHeader show={show} activeTab={tab} />
      <TabComp show={show} />
    </div>
  );
}
