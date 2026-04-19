#!/usr/bin/env node
// TDD tests for scripts/lib/toast_csv.mjs
// Run: node --test tests/js/test-toast-csv.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { parseToastDateCsv, parseToastDayCsv, parseToastTimeCsv } =
  await import('../../scripts/lib/toast_csv.mjs');

// ── Shared helpers ──────────────────────────────────────────────────

const DATE_HEADER = 'Date,Net Sales,Orders,Guests,Group,Date Range';
const DAY_HEADER  = 'Day,Net Sales,Orders,Guests,Group,Date Range';
const TIME_HEADER = 'Time,Net Sales,Orders,Guests,Group,Date Range';

const DR = 'Apr 6| 2020 - Apr 17| 2026';

// ── parseToastDateCsv ───────────────────────────────────────────────

describe('parseToastDateCsv — happy path', () => {
  const input = [
    DATE_HEADER,
    `04/06/2020,0,0,0,1,${DR},`,
    `04/07/2020,719644.32,16817,32303,1,${DR},`,
    `04/08/2020,9.99,2,3,2,${DR},`,
  ].join('\n');

  it('returns { rows, rejects } with no rejects', () => {
    const result = parseToastDateCsv(input);
    assert.ok(result && typeof result === 'object');
    assert.ok(Array.isArray(result.rows));
    assert.ok(Array.isArray(result.rejects));
    assert.strictEqual(result.rejects.length, 0);
    assert.strictEqual(result.rows.length, 3);
  });

  it('parses fields correctly on first row', () => {
    const { rows } = parseToastDateCsv(input);
    const r = rows[0];
    assert.strictEqual(r.shift_date, '2020-04-06');
    assert.strictEqual(r.net_sales, 0);
    assert.strictEqual(r.orders, 0);
    assert.strictEqual(r.guests, 0);
    assert.strictEqual(r.comparison_group, 1);
    assert.strictEqual(r.date_range, DR);
  });

  it('parses second row with real numbers', () => {
    const { rows } = parseToastDateCsv(input);
    const r = rows[1];
    assert.strictEqual(r.shift_date, '2020-04-07');
    assert.strictEqual(r.net_sales, 719644.32);
    assert.strictEqual(r.orders, 16817);
    assert.strictEqual(r.guests, 32303);
    assert.strictEqual(r.comparison_group, 1);
  });

  it('group 2 row is preserved with comparison_group === 2', () => {
    const { rows } = parseToastDateCsv(input);
    assert.strictEqual(rows[2].comparison_group, 2);
  });
});

describe('parseToastDateCsv — header handling', () => {
  it('throws on wrong header (includes expected and received)', () => {
    const bad = 'Date,Net Sales,Orders,Guests,Group\n04/06/2020,0,0,0,1,';
    assert.throws(() => parseToastDateCsv(bad), (err) => {
      assert.ok(err instanceof Error, 'must be an Error');
      assert.ok(err.message.includes(DATE_HEADER), `missing expected header in: ${err.message}`);
      assert.ok(err.message.includes('Date,Net Sales,Orders,Guests,Group'),
        `missing received header in: ${err.message}`);
      return true;
    });
  });

  it('throws on completely wrong header', () => {
    assert.throws(() => parseToastDateCsv('Foo,Bar\n1,2'), (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes(DATE_HEADER));
      return true;
    });
  });

  it('tolerates leading blank lines before the header', () => {
    const input = `\n\n${DATE_HEADER}\n04/06/2020,100,1,1,1,${DR},\n`;
    const { rows, rejects } = parseToastDateCsv(input);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rejects.length, 0);
  });
});

describe('parseToastDateCsv — trailing empty field', () => {
  it('parses rows with trailing comma without rejecting', () => {
    const input = `${DATE_HEADER}\n04/06/2020,100.50,5,8,1,${DR},`;
    const { rows, rejects } = parseToastDateCsv(input);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rejects.length, 0);
    assert.strictEqual(rows[0].net_sales, 100.50);
  });
});

describe('parseToastDateCsv — rejects', () => {
  it('rejects invalid calendar date (13/40/2025)', () => {
    const input = `${DATE_HEADER}\n13/40/2025,100,1,1,1,${DR},`;
    const { rows, rejects } = parseToastDateCsv(input);
    assert.strictEqual(rows.length, 0);
    assert.strictEqual(rejects.length, 1);
    assert.ok(rejects[0].reason, 'reject must have a reason');
    assert.ok(typeof rejects[0].line_number === 'number');
    assert.ok(typeof rejects[0].raw_line === 'string');
  });

  it('rejects non-numeric net_sales (abc)', () => {
    const input = `${DATE_HEADER}\n04/06/2020,abc,1,1,1,${DR},`;
    const { rows, rejects } = parseToastDateCsv(input);
    assert.strictEqual(rows.length, 0);
    assert.strictEqual(rejects.length, 1);
    assert.ok(/net_sales/i.test(rejects[0].reason));
  });

  it('rejects comparison_group = 3', () => {
    const input = `${DATE_HEADER}\n04/06/2020,100,1,1,3,${DR},`;
    const { rows, rejects } = parseToastDateCsv(input);
    assert.strictEqual(rows.length, 0);
    assert.strictEqual(rejects.length, 1);
    assert.ok(/comparison_group/i.test(rejects[0].reason));
  });

  it('valid rows before/after a reject survive', () => {
    const input = [
      DATE_HEADER,
      `04/06/2020,100,5,5,1,${DR},`,
      `13/40/2025,50,1,1,1,${DR},`,
      `04/08/2020,200,3,3,2,${DR},`,
    ].join('\n');
    const { rows, rejects } = parseToastDateCsv(input);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rejects.length, 1);
  });

  it('negative net_sales is rejected', () => {
    const input = `${DATE_HEADER}\n04/06/2020,-1,1,1,1,${DR},`;
    const { rows, rejects } = parseToastDateCsv(input);
    assert.strictEqual(rows.length, 0);
    assert.strictEqual(rejects.length, 1);
  });
});

describe('parseToastDateCsv — blank lines', () => {
  it('blank lines inside the file are skipped, not rejected', () => {
    const input = [
      DATE_HEADER,
      `04/06/2020,100,5,5,1,${DR},`,
      '',
      `04/07/2020,200,3,3,1,${DR},`,
      '',
    ].join('\n');
    const { rows, rejects } = parseToastDateCsv(input);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rejects.length, 0);
  });
});

describe('parseToastDateCsv — return shape', () => {
  it('always returns { rows, rejects } (never null)', () => {
    const input = `${DATE_HEADER}\n04/06/2020,0,0,0,1,${DR},`;
    const result = parseToastDateCsv(input);
    assert.notStrictEqual(result, null);
    assert.notStrictEqual(result, undefined);
    assert.ok('rows' in result);
    assert.ok('rejects' in result);
  });
});

// ── parseToastDayCsv ────────────────────────────────────────────────

describe('parseToastDayCsv — happy path', () => {
  const input = [
    DAY_HEADER,
    `Sun,719644.32,16817,32303,1,${DR},`,
    `Mon,137488.77,3874,9210,1,${DR},`,
    `Tue,9.99,2,3,2,${DR},`,
  ].join('\n');

  it('returns { rows, rejects } with no rejects', () => {
    const result = parseToastDayCsv(input);
    assert.ok(Array.isArray(result.rows));
    assert.ok(Array.isArray(result.rejects));
    assert.strictEqual(result.rejects.length, 0);
    assert.strictEqual(result.rows.length, 3);
  });

  it('parses fields correctly', () => {
    const { rows } = parseToastDayCsv(input);
    const r = rows[0];
    assert.strictEqual(r.day_of_week, 'Sun');
    assert.strictEqual(r.net_sales, 719644.32);
    assert.strictEqual(r.orders, 16817);
    assert.strictEqual(r.guests, 32303);
    assert.strictEqual(r.comparison_group, 1);
    assert.strictEqual(r.date_range, DR);
  });

  it('group 2 row is preserved', () => {
    const { rows } = parseToastDayCsv(input);
    assert.strictEqual(rows[2].comparison_group, 2);
    assert.strictEqual(rows[2].day_of_week, 'Tue');
  });
});

describe('parseToastDayCsv — header handling', () => {
  it('throws on wrong header', () => {
    assert.throws(() => parseToastDayCsv(DATE_HEADER + '\nSun,0,0,0,1,' + DR), (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes(DAY_HEADER));
      return true;
    });
  });

  it('tolerates leading blank lines before header', () => {
    const input = `\n\n${DAY_HEADER}\nSun,100,1,1,1,${DR},\n`;
    const { rows } = parseToastDayCsv(input);
    assert.strictEqual(rows.length, 1);
  });
});

describe('parseToastDayCsv — rejects', () => {
  it('rejects unknown day_of_week (Funday)', () => {
    const input = `${DAY_HEADER}\nFunday,100,5,5,1,${DR},`;
    const { rows, rejects } = parseToastDayCsv(input);
    assert.strictEqual(rows.length, 0);
    assert.strictEqual(rejects.length, 1);
    assert.ok(/day/i.test(rejects[0].reason));
  });

  it('rejects negative net_sales', () => {
    const input = `${DAY_HEADER}\nSun,-5,1,1,1,${DR},`;
    const { rows, rejects } = parseToastDayCsv(input);
    assert.strictEqual(rows.length, 0);
    assert.strictEqual(rejects.length, 1);
  });

  it('rejects comparison_group not 1 or 2', () => {
    const input = `${DAY_HEADER}\nSun,100,1,1,3,${DR},`;
    const { rows, rejects } = parseToastDayCsv(input);
    assert.strictEqual(rows.length, 0);
    assert.strictEqual(rejects.length, 1);
  });
});

describe('parseToastDayCsv — blank lines', () => {
  it('blank lines are skipped, not rejected', () => {
    const input = [DAY_HEADER, `Sun,100,5,5,1,${DR},`, '', `Mon,200,3,3,1,${DR},`].join('\n');
    const { rows, rejects } = parseToastDayCsv(input);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rejects.length, 0);
  });
});

describe('parseToastDayCsv — return shape', () => {
  it('always returns { rows, rejects }', () => {
    const result = parseToastDayCsv(`${DAY_HEADER}\nSun,0,0,0,1,${DR},`);
    assert.ok('rows' in result && 'rejects' in result);
  });
});

// ── parseToastTimeCsv ───────────────────────────────────────────────

describe('parseToastTimeCsv — happy path', () => {
  const input = [
    TIME_HEADER,
    `12:00 AM,130430.31,5039,5051,1,${DR},`,
    `1:00 PM,9564.06,698,701,1,${DR},`,
    `11:00 PM,99.00,10,12,2,${DR},`,
  ].join('\n');

  it('returns { rows, rejects } with no rejects', () => {
    const result = parseToastTimeCsv(input);
    assert.ok(Array.isArray(result.rows));
    assert.ok(Array.isArray(result.rejects));
    assert.strictEqual(result.rejects.length, 0);
    assert.strictEqual(result.rows.length, 3);
  });

  it('parses fields correctly on first row', () => {
    const { rows } = parseToastTimeCsv(input);
    const r = rows[0];
    assert.strictEqual(r.hour_24, 0);
    assert.strictEqual(r.label, '12:00 AM');
    assert.strictEqual(r.net_sales, 130430.31);
    assert.strictEqual(r.orders, 5039);
    assert.strictEqual(r.guests, 5051);
    assert.strictEqual(r.comparison_group, 1);
    assert.strictEqual(r.date_range, DR);
  });

  it('group 2 row is preserved', () => {
    const { rows } = parseToastTimeCsv(input);
    assert.strictEqual(rows[2].comparison_group, 2);
  });
});

describe('parseToastTimeCsv — hour boundary cases', () => {
  const cases = [
    { label: '12:00 AM', hour_24: 0 },
    { label: '1:00 AM',  hour_24: 1 },
    { label: '11:00 AM', hour_24: 11 },
    { label: '12:00 PM', hour_24: 12 },
    { label: '1:00 PM',  hour_24: 13 },
    { label: '11:00 PM', hour_24: 23 },
  ];

  for (const { label, hour_24 } of cases) {
    it(`"${label}" → hour_24 === ${hour_24}`, () => {
      const input = `${TIME_HEADER}\n${label},100,5,5,1,${DR},`;
      const { rows, rejects } = parseToastTimeCsv(input);
      assert.strictEqual(rejects.length, 0, `unexpected reject: ${JSON.stringify(rejects)}`);
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].hour_24, hour_24);
      assert.strictEqual(rows[0].label, label, 'label must be preserved verbatim');
    });
  }
});

describe('parseToastTimeCsv — header handling', () => {
  it('throws on wrong header', () => {
    assert.throws(() => parseToastTimeCsv(DATE_HEADER + '\n12:00 AM,0,0,0,1,' + DR), (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes(TIME_HEADER));
      return true;
    });
  });

  it('tolerates leading blank lines before header', () => {
    const input = `\n\n${TIME_HEADER}\n12:00 AM,100,1,1,1,${DR},\n`;
    const { rows } = parseToastTimeCsv(input);
    assert.strictEqual(rows.length, 1);
  });
});

describe('parseToastTimeCsv — rejects', () => {
  it('rejects label "25:00 AM" (H out of range)', () => {
    const input = `${TIME_HEADER}\n25:00 AM,100,5,5,1,${DR},`;
    const { rows, rejects } = parseToastTimeCsv(input);
    assert.strictEqual(rows.length, 0);
    assert.strictEqual(rejects.length, 1);
    assert.ok(/label|hour|time/i.test(rejects[0].reason));
  });

  it('rejects orders = "3.5" (not an integer)', () => {
    const input = `${TIME_HEADER}\n12:00 AM,100,3.5,5,1,${DR},`;
    const { rows, rejects } = parseToastTimeCsv(input);
    assert.strictEqual(rows.length, 0);
    assert.strictEqual(rejects.length, 1);
    assert.ok(/orders/i.test(rejects[0].reason));
  });

  it('rejects negative net_sales', () => {
    const input = `${TIME_HEADER}\n12:00 AM,-1,5,5,1,${DR},`;
    const { rows, rejects } = parseToastTimeCsv(input);
    assert.strictEqual(rows.length, 0);
    assert.strictEqual(rejects.length, 1);
  });

  it('rejects comparison_group not 1 or 2', () => {
    const input = `${TIME_HEADER}\n12:00 AM,100,5,5,3,${DR},`;
    const { rows, rejects } = parseToastTimeCsv(input);
    assert.strictEqual(rows.length, 0);
    assert.strictEqual(rejects.length, 1);
  });
});

describe('parseToastTimeCsv — blank lines', () => {
  it('blank lines are skipped, not rejected', () => {
    const input = [
      TIME_HEADER,
      `12:00 AM,100,5,5,1,${DR},`,
      '',
      `1:00 AM,200,3,3,1,${DR},`,
    ].join('\n');
    const { rows, rejects } = parseToastTimeCsv(input);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rejects.length, 0);
  });
});

describe('parseToastTimeCsv — trailing comma', () => {
  it('parses row with trailing comma without rejecting', () => {
    const input = `${TIME_HEADER}\n12:00 AM,130430.31,5039,5051,1,${DR},`;
    const { rows, rejects } = parseToastTimeCsv(input);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rejects.length, 0);
  });
});

describe('parseToastTimeCsv — return shape', () => {
  it('always returns { rows, rejects }', () => {
    const result = parseToastTimeCsv(`${TIME_HEADER}\n12:00 AM,0,0,0,1,${DR},`);
    assert.ok('rows' in result && 'rejects' in result);
  });
});

// ── Group 1 & 2 mixed — all three parsers ──────────────────────────

describe('group 1 and 2 mixed — date parser', () => {
  it('both groups survive; comparison_group carries through', () => {
    const input = [
      DATE_HEADER,
      `04/06/2020,100,5,5,1,${DR},`,
      `04/06/2020,50,3,3,2,${DR},`,
    ].join('\n');
    const { rows, rejects } = parseToastDateCsv(input);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rejects.length, 0);
    assert.strictEqual(rows[0].comparison_group, 1);
    assert.strictEqual(rows[1].comparison_group, 2);
  });
});

describe('group 1 and 2 mixed — day parser', () => {
  it('both groups survive', () => {
    const input = [
      DAY_HEADER,
      `Sun,719644.32,16817,32303,1,${DR},`,
      `Sun,319572.09,8490,17724,2,${DR},`,
    ].join('\n');
    const { rows, rejects } = parseToastDayCsv(input);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rejects.length, 0);
    assert.strictEqual(rows[0].comparison_group, 1);
    assert.strictEqual(rows[1].comparison_group, 2);
  });
});

describe('group 1 and 2 mixed — time parser', () => {
  it('both groups survive', () => {
    const input = [
      TIME_HEADER,
      `12:00 AM,130430.31,5039,5051,1,${DR},`,
      `12:00 AM,23739.51,2129,2136,2,${DR},`,
    ].join('\n');
    const { rows, rejects } = parseToastTimeCsv(input);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rejects.length, 0);
    assert.strictEqual(rows[0].comparison_group, 1);
    assert.strictEqual(rows[1].comparison_group, 2);
  });
});

// ── BOM stripping ──────────────────────────────────────────────────

describe('BOM stripping — date variant', () => {
  it('parses normally when input starts with \\uFEFF', () => {
    const input = `\uFEFF${DATE_HEADER}\n04/06/2020,100,1,1,1,${DR},`;
    const { rows, rejects } = parseToastDateCsv(input);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rejects.length, 0);
    assert.strictEqual(rows[0].shift_date, '2020-04-06');
  });
});

describe('BOM stripping — day variant', () => {
  it('parses normally when input starts with \\uFEFF', () => {
    const input = `\uFEFF${DAY_HEADER}\nSun,100,1,1,1,${DR},`;
    const { rows, rejects } = parseToastDayCsv(input);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rejects.length, 0);
    assert.strictEqual(rows[0].day_of_week, 'Sun');
  });
});

describe('BOM stripping — time variant', () => {
  it('parses normally when input starts with \\uFEFF', () => {
    const input = `\uFEFF${TIME_HEADER}\n12:00 AM,100,1,1,1,${DR},`;
    const { rows, rejects } = parseToastTimeCsv(input);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rejects.length, 0);
    assert.strictEqual(rows[0].hour_24, 0);
  });
});

describe('BOM stripping — mismatched header still throws', () => {
  it('throws header mismatch when BOM precedes a wrong header', () => {
    const bad = `\uFEFFDate,Net Sales,Orders,Guests,Group\n04/06/2020,0,0,0,1,`;
    assert.throws(() => parseToastDateCsv(bad), (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes(DATE_HEADER));
      return true;
    });
  });
});

// ── CRLF smoke test ────────────────────────────────────────────────

describe('CRLF line endings — date variant', () => {
  it('parses CRLF input identically to LF', () => {
    const lf   = [DATE_HEADER, `04/06/2020,100,5,5,1,${DR},`, `04/07/2020,200,3,3,2,${DR},`].join('\n');
    const crlf = [DATE_HEADER, `04/06/2020,100,5,5,1,${DR},`, `04/07/2020,200,3,3,2,${DR},`].join('\r\n');
    const lfResult   = parseToastDateCsv(lf);
    const crlfResult = parseToastDateCsv(crlf);
    assert.deepStrictEqual(crlfResult.rows,    lfResult.rows);
    assert.deepStrictEqual(crlfResult.rejects, lfResult.rejects);
  });
});

// ── RejectInfo shape ───────────────────────────────────────────────

describe('RejectInfo shape', () => {
  it('reject entry has line_number, reason, raw_line', () => {
    const input = `${DATE_HEADER}\n04/06/2020,abc,1,1,1,${DR},`;
    const { rejects } = parseToastDateCsv(input);
    assert.strictEqual(rejects.length, 1);
    const r = rejects[0];
    assert.ok(typeof r.line_number === 'number', 'line_number must be a number');
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0, 'reason must be non-empty string');
    assert.ok(typeof r.raw_line === 'string', 'raw_line must be a string');
    // line_number 2 = header is line 1, data row is line 2
    assert.strictEqual(r.line_number, 2);
  });

  it('line_number accounts for leading blank lines', () => {
    const input = `\n\n${DATE_HEADER}\n04/06/2020,abc,1,1,1,${DR},`;
    const { rejects } = parseToastDateCsv(input);
    // blank lines 1-2, header line 3, data line 4
    assert.strictEqual(rejects[0].line_number, 4);
  });
});
