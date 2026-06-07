#!/usr/bin/env node
// Source guard for the canonical money formatter.
//
// Run: node --test tests/js/test-format-money-source.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const MONEY_SOURCE_FILES = [
  'app/analytics/page.jsx',
  'app/analytics/AnalyticsCharts.jsx',
  'app/bar/page.jsx',
  'app/booking/BookingCalendar.jsx',
  'app/costing/_components/AbcTile.jsx',
  'app/menu-engineering/page.tsx',
  'app/menu-engineering/margin-deltas/page.jsx',
  'app/specials/saved/page.jsx',
  'app/labor/page.jsx',
  'app/labor/tip-pool/TipPoolBoard.jsx',
  'app/labor/wage-notices/WageNoticesBoard.jsx',
  'app/command/page.jsx',
  'app/beo/BeoBoard.jsx',
  'app/beo/share/[token]/page.jsx',
  'app/shows/tonight/_components/TonightLiveClient.jsx',
  'app/shows/[id]/box-office/BoxOfficeBoard.jsx',
  'app/shows/[id]/settlement/page.jsx',
  'app/menu-engineering/components/ComponentEditor.jsx',
  'app/management/page.jsx',
  'app/api/specials/route.js',
];

const INLINE_DOLLAR_NUMBER_FORMAT =
  /\$\$[{][^\n}]*(?:toFixed|toLocaleString)\(/;
const LOCAL_MONEY_HELPER =
  /\b(?:function|const)\s+(?:fmtUSD|fmtUsd|USD|fmtMoney|fmtRate|dollars|fmtPrice)\b/;

function readSource(relativePath) {
  return fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('money-format source guard', () => {
  for (const file of MONEY_SOURCE_FILES) {
    it(`${file} uses lib/formatMoney instead of local dollar formatting`, () => {
      const source = readSource(file);
      assert.doesNotMatch(source, INLINE_DOLLAR_NUMBER_FORMAT);
      assert.doesNotMatch(source, LOCAL_MONEY_HELPER);
    });
  }

  it('keeps aggregate KPIs at whole-dollar precision', () => {
    const analytics = readSource('app/analytics/page.jsx');
    const menuEngineering = readSource('app/menu-engineering/page.tsx');
    const management = readSource('app/management/page.jsx');

    assert.match(
      analytics,
      /formatDollars\(dailyCurrentTotal,\s*{\s*decimals:\s*0\s*}\)/,
    );
    assert.match(
      analytics,
      /formatDollars\(totalSpend,\s*{\s*decimals:\s*0\s*}\)/,
    );
    assert.match(
      management,
      /formatDollars\(variance\.theoretical_cogs \?\? 0,\s*{\s*decimals:\s*0\s*}\)/,
    );
    assert.match(
      management,
      /formatDollars\(variance\.actual_cogs \?\? 0,\s*{\s*decimals:\s*0\s*}\)/,
    );
    assert.match(
      menuEngineering,
      /formatDollars\(d\.net_sales,\s*{\s*decimals:\s*0\s*}\)/,
    );
  });
});
