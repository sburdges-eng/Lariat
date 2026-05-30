interface StaffLike {
  id?: unknown;
  first?: unknown;
  last?: unknown;
  active?: unknown;
}

const JUNK_IDS = new Set(['non_usable_employee']);
const JUNK_NAME_RE = /\b(non\s*usable|test|placeholder|total)\b/i;

function titlePart(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

export function formatStaffDisplayName(staff: StaffLike): string {
  return [titlePart(staff.first), titlePart(staff.last)].filter(Boolean).join(' ');
}

export function isDisplayableStaff(staff: StaffLike): boolean {
  if (!staff || staff.active === false) return false;
  const id = String(staff.id ?? '').trim().toLowerCase();
  if (JUNK_IDS.has(id)) return false;
  const displayName = formatStaffDisplayName(staff);
  if (!displayName) return false;
  return !JUNK_NAME_RE.test(displayName);
}

export function cleanStaffForPicker<T extends StaffLike>(rows: T[]): Array<T & { displayName: string }> {
  return rows
    .filter(isDisplayableStaff)
    .map((row) => ({ ...row, displayName: formatStaffDisplayName(row) }));
}
