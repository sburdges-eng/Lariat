// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { render, screen } from '@testing-library/react';
import BrandStamp from '../_components/BrandStamp.jsx';

describe('BrandStamp', () => {
  test('renders an accessible mark labelled "Lariat" by default', () => {
    render(<BrandStamp />);
    const mark = screen.getByRole('img', { name: 'Lariat' });
    expect(mark).toBeInTheDocument();
    expect(mark.tagName.toLowerCase()).toBe('svg');
  });

  test('honors a custom label', () => {
    render(<BrandStamp label="The Lariat" />);
    expect(screen.getByRole('img', { name: 'The Lariat' })).toBeInTheDocument();
  });

  test('decorative variant exposes no accessible name', () => {
    const { container } = render(<BrandStamp decorative />);
    // No img role — purely presentational beside visible wordmark text.
    expect(screen.queryByRole('img')).toBeNull();
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('aria-label')).toBeNull();
  });

  test('passes through className for inline/sidebar sizing', () => {
    const { container } = render(<BrandStamp className="logo" decorative />);
    expect(container.querySelector('svg.logo')).not.toBeNull();
  });
});
