// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
// AuditLogPage jsdom test — the per-row "Show/Hide" changes toggle must
// expand only the clicked row.
//
// Pre-fix, the component read `log.audit_id` for both the React `key`
// and the expand/collapse comparison, but the real field written by
// `logAuditAction()` (lib/auditLog.mjs) and returned by
// `GET /api/audit/log` is `id` — there is no `audit_id` anywhere in the
// writer or the route response. Every entry's `log.audit_id` was
// therefore `undefined`, so clicking "Show" on ANY row set
// `expandedId` to `undefined`, which then matched EVERY row's
// (also-`undefined`) `audit_id` — expanding every row with changes at
// once instead of just the one clicked.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));

import AuditLogPage from '../management/audit-log/page.jsx';

const LOGS = [
  {
    id: 'audit_1',
    action: 'recipe_edit',
    slug: 'tacos',
    timestamp: '2026-01-01T00:00:00.000Z',
    changes: { name: 'Taco Deluxe' },
  },
  {
    id: 'audit_2',
    action: 'recipe_edit',
    slug: 'burritos',
    timestamp: '2026-01-02T00:00:00.000Z',
    changes: { name: 'Burrito Supreme' },
  },
];

function mockLogsResponse(logs) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve({ success: true, count: logs.length, logs }),
  });
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('AuditLogPage — per-row expand/collapse', () => {
  test('expanding one row does not also expand a different row', async () => {
    mockLogsResponse(LOGS);
    render(<AuditLogPage />);

    // The recipe link is unambiguous (the filter <select> also has a
    // "tacos" option, so getByRole('link', ...) rather than getByText).
    await waitFor(() => screen.getByRole('link', { name: 'tacos' }));

    const showButtons = screen.getAllByRole('button', { name: /show/i });
    expect(showButtons).toHaveLength(2);

    fireEvent.click(showButtons[0]);

    await waitFor(() => expect(screen.getByText('Taco Deluxe')).toBeInTheDocument());
    // The second row's changes must stay collapsed.
    expect(screen.queryByText('Burrito Supreme')).not.toBeInTheDocument();
  });

  test('each row toggles independently', async () => {
    mockLogsResponse(LOGS);
    render(<AuditLogPage />);

    await waitFor(() => screen.getByRole('link', { name: 'tacos' }));

    const [firstShow, secondShow] = screen.getAllByRole('button', { name: /show/i });
    fireEvent.click(firstShow);
    await waitFor(() => expect(screen.getByText('Taco Deluxe')).toBeInTheDocument());

    // Expanding the second row should now show BOTH — first row's
    // expansion should not have silently transferred to the second's
    // id, and vice versa isn't collapsed by clicking a different row.
    const secondShowNow = screen.getAllByRole('button', { name: /show|hide/i })[1];
    fireEvent.click(secondShowNow);
    await waitFor(() => expect(screen.getByText('Burrito Supreme')).toBeInTheDocument());
  });
});
