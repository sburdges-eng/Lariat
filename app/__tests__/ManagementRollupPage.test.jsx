// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
//
// Guards /management's location-scoped drilldown links. The page is an
// async server component that opens a real DB handle at render time, so
// RTL rendering is impractical (same idiom as OperatorEstimateWiring.test.jsx
// and tests/js/test-management-rollup.mjs's "tile wiring" checks); we assert
// on source structure instead.
//
// Regression: four links whose destination page reads `searchParams.location`
// server-side (menu-engineering, food-safety ×2, management/cloud-bridge)
// were wired as bare path strings instead of going through the file's own
// `locHref()` helper — the same helper every OTHER location-scoped tile in
// this file already uses (price-shocks, depletion-exceptions, labor/certs,
// receiving-matches). A manager viewing a non-default location who tapped
// "Menu items costed" or "Cleaning logged today" (both of which show
// location-scoped counts on THIS page) would silently land on the DEFAULT
// location's data instead of the site they were just looking at — the same
// class of cross-site data leak PR review #96 flagged for this page (see
// tests/js/test-management-rollup.mjs's "location scoping" suite).
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PAGE = readFileSync(
  path.join(process.cwd(), 'app', 'management', 'page.jsx'),
  'utf8',
);

describe('/management — location-scoped drilldown links', () => {
  test('"Menu items costed" tile (location-scoped coverage data) uses locHref', () => {
    expect(PAGE).toMatch(/label="Menu items costed"/);
    expect(PAGE).toMatch(/href=\{locHref\('\/menu-engineering'\)\}/);
    expect(PAGE).not.toMatch(/href="\/menu-engineering"/);
  });

  test('both tiles linking to /food-safety use locHref (Unverified rules + Cleaning today)', () => {
    const scopedFoodSafetyHrefs = PAGE.match(/href=\{locHref\('\/food-safety'\)\}/g) || [];
    expect(scopedFoodSafetyHrefs.length).toBe(2);
    expect(PAGE).not.toMatch(/href="\/food-safety"/);
  });

  test('"Cloud bridge" more-tools link (destination reads ?location=) uses locHref', () => {
    expect(PAGE).toMatch(
      /<Link href=\{locHref\('\/management\/cloud-bridge'\)\}>Cloud bridge<\/Link>/,
    );
    expect(PAGE).not.toMatch(/<Link href="\/management\/cloud-bridge">/);
  });

  test('receiving-matches links keep passing loc explicitly (pre-existing, still covered by tests/js/test-management-rollup.mjs)', () => {
    const receivingHrefs = PAGE.match(/href=\{locHref\('\/management\/receiving-matches', loc\)\}/g) || [];
    expect(receivingHrefs.length).toBe(2);
  });
});
