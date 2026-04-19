// scripts/lib/toast_csv.mjs
// Pure-JS parser for Toast POS CSV exports (date / day / time variants).
// No I/O, no DB, no external deps. ES module.
//
// Naive CSV split: fields are split on bare commas. This is intentional.
// Toast exports targeting this module never quote fields. The date_range
// column uses "|" as its inner separator, so commas are unambiguous.
// If a future Toast export starts quoting fields that contain commas,
// this module will silently produce garbage and must be upgraded to a
// real CSV parser.

// ── Small helpers ──────────────────────────────────────────────────

const VALID_DAYS = new Set(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

/**
 * Parse "MM/DD/YYYY" into "YYYY-MM-DD" with calendar validation.
 * Returns null on any error. No Date objects, no timezone math.
 */
function parseMmDdYyyy(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const mo = Number(m[1]);
  const dy = Number(m[2]);
  const yr = Number(m[3]);
  if (mo < 1 || mo > 12) return null;
  const daysInMonth = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  // Leap-year adjustment for Feb
  const isLeap = (yr % 4 === 0 && yr % 100 !== 0) || yr % 400 === 0;
  if (isLeap) daysInMonth[2] = 29;
  if (dy < 1 || dy > daysInMonth[mo]) return null;
  return `${m[3]}-${m[1]}-${m[2]}`;
}

/**
 * Parse "H:MM AM" / "H:MM PM" into 24-hour integer (0-23).
 * Returns null on parse failure.
 * 12:xx AM → 0, 1..11 AM → 1..11, 12:xx PM → 12, 1..11 PM → 13..23.
 */
function parseAmPmHour(s) {
  const m = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const mn = Number(m[2]);
  const period = m[3];
  if (h < 1 || h > 12) return null;
  if (mn < 0 || mn > 59) return null;
  if (period === 'AM') return h === 12 ? 0 : h;
  // PM
  return h === 12 ? 12 : h + 12;
}

/**
 * Parse a float string; return the number only if:
 *   - it is finite
 *   - it is >= 0 (net_sales must not be negative in Toast exports)
 * Returns null on failure.
 */
function toNetSales(s) {
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return n;
}

/**
 * Parse an integer-only count field (orders / guests).
 * Rejects decimal-point strings, signs, NaN, Infinity.
 * Returns null on failure.
 */
function toCount(s) {
  // Must not contain a decimal point or sign
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

/**
 * Split a CSV line into exactly 6 trimmed fields.
 * The real files have a trailing comma (7 parts after split); we drop
 * everything beyond index 5. Fewer than 6 fields returns null.
 */
function splitRow(line) {
  const parts = line.split(',').map((f) => f.trim());
  if (parts.length < 6) return null;
  return parts.slice(0, 6);
}

// ── Core parse engine ──────────────────────────────────────────────

/**
 * Shared loop: iterate lines, find header, collect rows/rejects.
 *
 * @param {string} text            - Raw file content
 * @param {string} expectedHeader  - Exact header string for this variant
 * @param {Function} parseRow      - (fields: string[], lineNumber: number) =>
 *                                   { ok: true, row: object }
 *                                 | { ok: false, reason: string }
 * @returns {{ rows: object[], rejects: RejectInfo[] }}
 */
function parseVariant(text, expectedHeader, parseRow) {
  const lines = text.replace(/^\uFEFF/, '').split('\n');
  let headerFound = false;
  const rows = [];
  const rejects = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1; // 1-indexed
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!headerFound) {
      if (trimmed === '') continue; // skip leading blank lines
      if (trimmed !== expectedHeader) {
        throw new Error(
          `Toast CSV header mismatch.\n  Expected: ${expectedHeader}\n  Received: ${trimmed}`,
        );
      }
      headerFound = true;
      continue;
    }

    // Past header
    if (trimmed === '') continue; // blank lines are silently skipped

    const fields = splitRow(trimmed);
    if (!fields) {
      rejects.push({ line_number: lineNumber, reason: 'too few fields', raw_line: raw });
      continue;
    }

    const result = parseRow(fields, lineNumber, raw);
    if (result.ok) {
      rows.push(result.row);
    } else {
      rejects.push({ line_number: lineNumber, reason: result.reason, raw_line: raw });
    }
  }

  if (!headerFound) {
    throw new Error(
      `Toast CSV header mismatch.\n  Expected: ${expectedHeader}\n  Received: (empty or header not found)`,
    );
  }

  return { rows, rejects };
}

// ── Shared field validators ────────────────────────────────────────

function validateNumericFields(netSalesStr, ordersStr, guestsStr, groupStr) {
  const net_sales = toNetSales(netSalesStr);
  if (net_sales === null) return { ok: false, reason: `net_sales is not a valid non-negative number: "${netSalesStr}"` };

  const orders = toCount(ordersStr);
  if (orders === null) return { ok: false, reason: `orders is not a non-negative integer: "${ordersStr}"` };

  const guests = toCount(guestsStr);
  if (guests === null) return { ok: false, reason: `guests is not a non-negative integer: "${guestsStr}"` };

  const groupNum = Number(groupStr);
  if (groupNum !== 1 && groupNum !== 2) {
    return { ok: false, reason: `comparison_group must be 1 or 2, got: "${groupStr}"` };
  }

  return { ok: true, net_sales, orders, guests, comparison_group: groupNum };
}

// ── Public API ─────────────────────────────────────────────────────

const DATE_HEADER = 'Date,Net Sales,Orders,Guests,Group,Date Range';
const DAY_HEADER  = 'Day,Net Sales,Orders,Guests,Group,Date Range';
const TIME_HEADER = 'Time,Net Sales,Orders,Guests,Group,Date Range';

/**
 * Parse a Toast "sales by date" CSV.
 * @param {string} text
 * @returns {{ rows: object[], rejects: object[] }}
 */
export function parseToastDateCsv(text) {
  return parseVariant(text, DATE_HEADER, (fields, _lineNumber, _raw) => {
    const [dateStr, netSalesStr, ordersStr, guestsStr, groupStr, date_range] = fields;

    const shift_date = parseMmDdYyyy(dateStr);
    if (shift_date === null) {
      return { ok: false, reason: `shift_date is not a valid MM/DD/YYYY date: "${dateStr}"` };
    }

    const num = validateNumericFields(netSalesStr, ordersStr, guestsStr, groupStr);
    if (!num.ok) return num;

    return {
      ok: true,
      row: {
        shift_date,
        net_sales: num.net_sales,
        orders: num.orders,
        guests: num.guests,
        comparison_group: num.comparison_group,
        date_range,
      },
    };
  });
}

/**
 * Parse a Toast "sales by day" CSV.
 * @param {string} text
 * @returns {{ rows: object[], rejects: object[] }}
 */
export function parseToastDayCsv(text) {
  return parseVariant(text, DAY_HEADER, (fields, _lineNumber, _raw) => {
    const [dayStr, netSalesStr, ordersStr, guestsStr, groupStr, date_range] = fields;

    if (!VALID_DAYS.has(dayStr)) {
      return { ok: false, reason: `day_of_week must be Sun-Sat, got: "${dayStr}"` };
    }

    const num = validateNumericFields(netSalesStr, ordersStr, guestsStr, groupStr);
    if (!num.ok) return num;

    return {
      ok: true,
      row: {
        day_of_week: dayStr,
        net_sales: num.net_sales,
        orders: num.orders,
        guests: num.guests,
        comparison_group: num.comparison_group,
        date_range,
      },
    };
  });
}

/**
 * Parse a Toast "sales by time" CSV.
 * @param {string} text
 * @returns {{ rows: object[], rejects: object[] }}
 */
export function parseToastTimeCsv(text) {
  return parseVariant(text, TIME_HEADER, (fields, _lineNumber, _raw) => {
    const [timeStr, netSalesStr, ordersStr, guestsStr, groupStr, date_range] = fields;

    const hour_24 = parseAmPmHour(timeStr);
    if (hour_24 === null) {
      return { ok: false, reason: `label is not a valid H:MM AM/PM hour: "${timeStr}"` };
    }

    const num = validateNumericFields(netSalesStr, ordersStr, guestsStr, groupStr);
    if (!num.ok) return num;

    return {
      ok: true,
      row: {
        hour_24,
        label: timeStr,
        net_sales: num.net_sales,
        orders: num.orders,
        guests: num.guests,
        comparison_group: num.comparison_group,
        date_range,
      },
    };
  });
}
