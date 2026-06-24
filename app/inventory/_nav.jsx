'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/inventory/counts', label: 'Counts' },
  { href: '/inventory/log', label: 'Log' },
  { href: '/inventory/par', label: 'Par' },
  { href: '/inventory/waste', label: 'Waste' },
];

export default function InventoryNav() {
  const path = usePathname() || '';
  return (
    <nav
      aria-label="Inventory sections"
      className="tab-strip"
      style={{
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        margin: '0 0 16px',
        paddingBottom: 8,
        borderBottom: '1px solid var(--border, #2a2a2a)',
      }}
    >
      {TABS.map(t => {
        const active = path === t.href || path.startsWith(t.href + '/');
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={active ? 'btn primary' : 'btn'}
            style={{ textDecoration: 'none' }}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
