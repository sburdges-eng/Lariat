// @ts-check
import { getDb } from '../../lib/db';
import { getShowById, nextUpcoming } from '../../lib/showsRepo';
import PlaybookHeader from './PlaybookHeader';
import AdsTab from './tabs/AdsTab';
import TicketsTab from './tabs/TicketsTab';
import NewsTab from './tabs/NewsTab';
import DayOfTab from './tabs/DayOfTab';

/** @typedef {Record<string, string | string[] | undefined>} PageSearchParams */

export const dynamic = 'force-dynamic';

/** @type {Record<string, import('react').ComponentType<{ show: import('../../lib/showsRepo.ts').ShowRow }>>} */
const TABS = { ads: AdsTab, tickets: TicketsTab, news: NewsTab, dayof: DayOfTab };

/** @param {{ searchParams: Promise<PageSearchParams> }} props */
export default async function PlaybookPage({ searchParams }) {
  // Next 16 app router: searchParams is a Promise. Reading it synchronously
  // (pre-fix) meant `sp` was the Promise itself — `sp.show` / `sp.tab` were
  // always undefined, so the tab-switcher and "switch show" links in
  // PlaybookHeader silently did nothing: the page always fell back to the
  // Ads tab for whatever nextUpcoming() picked, regardless of the URL.
  const sp = (await searchParams) || {};
  const requestedId = typeof sp.show === 'string' ? Number(sp.show) : NaN;
  const requestedTab = typeof sp.tab === 'string' ? sp.tab : '';
  const tab = Object.prototype.hasOwnProperty.call(TABS, requestedTab) ? requestedTab : 'ads';

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

  // TABS[tab] is always defined here (tab is validated against
  // Object.hasOwnProperty(TABS, ...) above); the `?? AdsTab` fallback only
  // exists to satisfy noUncheckedIndexedAccess.
  const TabComp = TABS[tab] ?? AdsTab;
  return (
    <div className="page">
      <PlaybookHeader show={show} activeTab={tab} />
      <TabComp show={show} />
    </div>
  );
}
