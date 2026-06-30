// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
//
// Guards the operator estimate route's food-cost + min-spend wiring. The page is
// an async server component that hits the DB, so RTL rendering is impractical;
// we assert on source structure (same idiom as BeoSharePageChrome.test.jsx). The
// render contract itself is covered by EstimateDocument.test.jsx.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PAGE = readFileSync(
  path.join(process.cwd(), 'app', 'beo', '[id]', 'estimate', 'page.jsx'),
  'utf8',
);

describe('operator estimate route — food-cost + min-spend wiring', () => {
  test('imports computeLineFoodCosts from lib/beoFoodCost', () => {
    expect(PAGE).toMatch(/import\s*\{[^}]*computeLineFoodCosts[^}]*\}\s*from\s*['"][^'"]*beoFoodCost['"]/);
  });

  test('the beo_events SELECT includes location_id and min_spend', () => {
    const eventSelect = (PAGE.match(/SELECT([\s\S]*?)FROM beo_events/) || [])[1] || '';
    expect(eventSelect).toMatch(/\blocation_id\b/);
    expect(eventSelect).toMatch(/\bmin_spend\b/);
  });

  test('computes food costs and passes foodCosts + minSpend to EstimateDocument', () => {
    expect(PAGE).toMatch(/computeLineFoodCosts\s*\(\s*lineItems/);
    expect(PAGE).toMatch(/foodCosts=\{/);
    expect(PAGE).toMatch(/minSpend=\{/);
  });

  test('only the operator register receives the overlay (no client-route change)', () => {
    expect(PAGE).toMatch(/register="operator"/);
  });
});
