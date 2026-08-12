// August 2026 daily / weekly / monthly cleaning checklists.
// Sourced from ops/cleaning/{daily,weekly,monthly-maintenance}.md
// and dated for this month so /day-plan can materialize due rows.

export interface AugustChecklistItem {
  key: string;
  title: string;
  detail?: string;
  due_time?: string;
  link_href?: string;
  link_label?: string;
}

/** Every-close daily side work for August. */
export const AUGUST_DAILY: AugustChecklistItem[] = [
  {
    key: 'aug-daily-line',
    title: 'Daily — line close',
    detail: 'Restock, flip, wrap, wipe boards, sanitize, filter oil, grease trays.',
    due_time: '23:30',
    link_href: '/food-safety/cleaning',
    link_label: 'Cleaning',
  },
  {
    key: 'aug-daily-house',
    title: 'Daily — house close',
    detail: 'Equip off, dishes, sweep/mop, gas + hood off, trash + rag buckets.',
    due_time: '23:45',
    link_href: '/food-safety/cleaning',
    link_label: 'Cleaning',
  },
];

/** Wed→Sun weekly jobs keyed by weekday short label (Sun…Sat). */
export const AUGUST_WEEKLY_BY_DOW: Record<string, AugustChecklistItem[]> = {
  Wed: [
    {
      key: 'aug-weekly-wed',
      title: 'Weekly Wed — under equip + walls + walk-ins',
      detail: 'Scrub underneath equipment · wipe walls · clean walk-ins.',
      due_time: '22:00',
      link_href: '/food-safety/cleaning',
      link_label: 'Cleaning',
    },
  ],
  Thu: [
    {
      key: 'aug-weekly-thu',
      title: 'Weekly Thu — shed + tools + table bottoms',
      detail: 'Organize shed · wipe scales / Robot Coupe · wipe prep table bottoms.',
      due_time: '22:00',
      link_href: '/food-safety/cleaning',
      link_label: 'Cleaning',
    },
  ],
  Fri: [
    {
      key: 'aug-weekly-fri',
      title: 'Weekly Fri — screens + cords + lamps',
      detail: 'Wipe screens, cords, and heat lamps.',
      due_time: '22:00',
      link_href: '/food-safety/cleaning',
      link_label: 'Cleaning',
    },
  ],
  Sat: [
    {
      key: 'aug-weekly-sat',
      title: 'Weekly Sat — spices + shelves + reach-ins',
      detail: 'Organize spices and shelves · clean reach-ins.',
      due_time: '22:00',
      link_href: '/food-safety/cleaning',
      link_label: 'Cleaning',
    },
  ],
  Sun: [
    {
      key: 'aug-weekly-sun',
      title: 'Weekly Sun — cast iron + hoods + fryer boil-out',
      detail: 'Soak cast iron · soak hoods · drip pans · boil out fryers.',
      due_time: '21:00',
      link_href: '/food-safety/cleaning',
      link_label: 'Cleaning',
    },
  ],
};

/** Monthly deep clean — target Sun Aug 16, makeup Sun Aug 23. */
export const AUGUST_MONTHLY_DATES = ['2026-08-16', '2026-08-23'] as const;

export const AUGUST_MONTHLY: AugustChecklistItem[] = [
  {
    key: 'aug-monthly-floors',
    title: 'Monthly — floors (walk-in, freezer, shed)',
    detail: 'Sweep, degrease, scrub.',
    due_time: '20:00',
    link_href: '/food-safety/cleaning',
    link_label: 'Cleaning',
  },
  {
    key: 'aug-monthly-stainless',
    title: 'Monthly — polish stainless',
    detail: 'Hoods, tables, reach-ins, lowboys, ice machine.',
    due_time: '20:30',
    link_href: '/food-safety/cleaning',
    link_label: 'Cleaning',
  },
  {
    key: 'aug-monthly-storage',
    title: 'Monthly — containers + lexans',
    detail: 'Clean and consolidate qt cups, spices, hotel pans.',
    due_time: '21:00',
    link_href: '/food-safety/cleaning',
    link_label: 'Cleaning',
  },
  {
    key: 'aug-monthly-gear',
    title: 'Monthly — coils, Toast, ice machine, hoods',
    detail: 'Wipe coils/cords/monitors · sanitize ice machine · hood deep clean. Log on Equipment.',
    due_time: '21:30',
    link_href: '/equipment',
    link_label: 'Equipment',
  },
  {
    key: 'aug-monthly-loft',
    title: 'Monthly — event loft / storage',
    detail: 'Organize loft above lockers / walk-in.',
    due_time: '22:00',
    link_href: '/food-safety/cleaning',
    link_label: 'Cleaning',
  },
];

export function isAugust2026(isoDate: string): boolean {
  return typeof isoDate === 'string' && isoDate.startsWith('2026-08-');
}

/** Checklist rows that should appear on a given August shift date. */
export function augustChecklistForDate(
  isoDate: string,
  weekdayShort: string,
): Array<AugustChecklistItem & { daypart: 'side_work' | 'maintenance'; cadence: 'daily' | 'weekly' | 'monthly' }> {
  if (!isAugust2026(isoDate)) return [];

  const out: Array<
    AugustChecklistItem & {
      daypart: 'side_work' | 'maintenance';
      cadence: 'daily' | 'weekly' | 'monthly';
    }
  > = [];

  for (const item of AUGUST_DAILY) {
    out.push({ ...item, daypart: 'side_work', cadence: 'daily' });
  }

  const weekly = AUGUST_WEEKLY_BY_DOW[weekdayShort] || [];
  for (const item of weekly) {
    out.push({ ...item, daypart: 'side_work', cadence: 'weekly' });
  }

  if ((AUGUST_MONTHLY_DATES as readonly string[]).includes(isoDate)) {
    for (const item of AUGUST_MONTHLY) {
      out.push({
        ...item,
        daypart: item.link_href === '/equipment' ? 'maintenance' : 'side_work',
        cadence: 'monthly',
      });
    }
  }

  return out;
}
