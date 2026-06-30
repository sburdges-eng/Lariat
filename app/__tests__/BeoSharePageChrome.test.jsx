// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
//
// Guards the guest-facing BEO share route's chrome + notFound handling. The page
// is an async server component that hits the DB and calls notFound(), so RTL
// rendering is impractical; we assert on source structure (same technique the
// retired BeoSharePagePaper.test.jsx used, repurposed to the EstimateDocument
// design that superseded the .paper share sheet).
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PAGE = readFileSync(
  path.join(process.cwd(), 'app', 'beo', 'share', '[token]', 'page.jsx'),
  'utf8',
);

describe('BEO share page — guest chrome + notFound legibility', () => {
  test('GuestChrome is rendered in BOTH the notFound and success paths', () => {
    // Both returns must emit <GuestChrome /> so an expired/invalid link never
    // renders inside the operator cockpit shell (sidebar/strip/command visible
    // on the dark body).
    const renders = PAGE.match(/<GuestChrome\s*\/>/g) || [];
    expect(renders.length).toBeGreaterThanOrEqual(2);
  });

  test('GuestChrome hides cockpit chrome and paints the heritage cream body', () => {
    expect(PAGE).toMatch(/\.sidebar[^}]*display:\s*none/);
    expect(PAGE).toMatch(/body\s*\{\s*background:\s*#F4F0E8/i);
  });

  test('GuestChrome also hides the floorplan FAB + overlay (guest cannot surface it)', () => {
    // The floorplan trigger is a position:fixed FAB outside the cockpit shell,
    // and a guest could press "M" to open the .floorplan-scrim over the estimate.
    expect(PAGE).toMatch(/\.floorplan-trigger/);
    expect(PAGE).toMatch(/\.floorplan-scrim/);
  });

  test('notFound text uses legible literals, not the dark-flippable global tokens', () => {
    // Under the Service Ledger :root palette var(--ink)/var(--muted) resolve to
    // light bone and would go invisible on the cream body GuestChrome sets, so
    // the notFound notice must color its text with explicit dark literals.
    const notFoundBlock = PAGE.slice(
      PAGE.indexOf('function notFound'),
      PAGE.indexOf('export default'),
    );
    expect(notFoundBlock).not.toMatch(/color:\s*'var\(--ink/);
    expect(notFoundBlock).not.toMatch(/color:\s*'var\(--muted/);
    expect(notFoundBlock).toMatch(/#1A1814/); // heritage ink literal
  });

  test('the document render wires EstimateDocument as the client register', () => {
    expect(PAGE).toMatch(/<EstimateDocument/);
    expect(PAGE).toMatch(/register="client"/);
  });
});
