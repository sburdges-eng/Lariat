'use client';
import React from 'react';
import Link from 'next/link';

const TABS = [
  { k: 'ads', l: 'Ad checklist' },
  { k: 'tickets', l: 'Tickets' },
  { k: 'news', l: 'Newsletter' },
  { k: 'dayof', l: 'Day of event' },
];

export default function PlaybookHeader({ show, activeTab }) {
  if (!show) return null;
  return (
    <header style={{ marginBottom: 18 }}>
      <div className="row-meta" style={{ letterSpacing: '.18em' }}>
        SHOW MARKETING · PLAYBOOK
      </div>
      <h1 className="serif" style={{ fontSize: 38, lineHeight: 1.1 }}>
        {show.band_name}
      </h1>
      <div className="row-meta">
        {show.show_date} · <Link href="/booking">switch show</Link>
      </div>
      <nav className="toggles" style={{ marginTop: 14 }}>
        {TABS.map((t) => (
          <Link
            key={t.k}
            className={`btn sm ${activeTab === t.k ? 'primary' : ''}`}
            href={`/playbook?show=${show.id}&tab=${t.k}`}
          >
            {t.l}
          </Link>
        ))}
      </nav>
    </header>
  );
}
