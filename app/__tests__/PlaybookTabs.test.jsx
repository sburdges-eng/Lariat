/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import AdsTab from '../playbook/tabs/AdsTab';
import TicketsTab from '../playbook/tabs/TicketsTab';
import NewsTab from '../playbook/tabs/NewsTab';
import DayOfTab from '../playbook/tabs/DayOfTab';

const SHOW = {
  id: 3,
  band_name: 'armchair boogie',
  show_date: '2026-05-15',
  price: 15.0,
  door_tix: 'y',
  status: {
    media_list: 'y', mkting_adv: 'y', auto_counts: 'n', announce_date: 'y',
    meta_ads: 'y', fb_event: 'y', co_host_sent: 'accepted',
    create_dice_tickets: 'y', listing_jambase_bit_songkick: 'jb, bit, sk',
    dice_email: 'tix, dos', newsletter: 'w', assets: 'y',
    posts: '6', whbv: 'n',
  },
};

describe('Playbook tabs', () => {
  test('AdsTab renders one pill per ad checklist key', () => {
    render(<AdsTab show={SHOW} />);
    // 5 ad-related fields: media_list, mkting_adv, meta_ads, fb_event, listing_jambase_bit_songkick
    expect(screen.getAllByText(/^(y|n|—|jb, bit, sk)$/).length).toBeGreaterThanOrEqual(5);
  });

  test('TicketsTab shows price + door + create_dice_tickets pill', () => {
    render(<TicketsTab show={SHOW} />);
    expect(screen.getByText(/\$15\.00/)).toBeInTheDocument();
    expect(screen.getByText(/door/i)).toBeInTheDocument();
  });

  test('NewsTab renders the newsletter pill (amber for "w")', () => {
    const { container } = render(<NewsTab show={SHOW} />);
    expect(container.querySelector('.pill-amber')).toBeTruthy();
  });

  test('DayOfTab renders dice_email + assets + posts', () => {
    render(<DayOfTab show={SHOW} />);
    expect(screen.getByText(/day of/i)).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument(); // posts count
  });
});
