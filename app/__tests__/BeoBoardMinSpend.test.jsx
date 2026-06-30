// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
//
// Guards the BeoBoard editor's min_spend wiring. BeoBoard is a large client
// component; an RTL render is disproportionate, and the persistence contract is
// already covered by tests/js/test-beo-update-event-partial-patch.mjs (T3). Here
// we source-assert the three wiring points so they can't silently regress.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = readFileSync(path.join(process.cwd(), 'app', 'beo', 'BeoBoard.tsx'), 'utf8');

describe('BeoBoard — min_spend editor wiring', () => {
  test('BeoEvent interface carries min_spend', () => {
    expect(SRC).toMatch(/min_spend\?:\s*number\s*\|\s*null/);
  });

  test('updateEvent PATCH body forwards min_spend', () => {
    expect(SRC).toMatch(/min_spend:\s*ev\.min_spend/);
  });

  test('EventHeader commits min_spend from a numeric input', () => {
    expect(SRC).toMatch(/commit\(\{\s*min_spend/);
  });
});
