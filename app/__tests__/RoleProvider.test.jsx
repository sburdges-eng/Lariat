// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { render, screen, waitFor } from '@testing-library/react';
import { RoleProvider, useRole } from '../_components/RoleProvider';
import { useEffect, useState } from 'react';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

// Test component that uses the role hook
function TestComponent() {
  const { canEditRecipes, canViewFinancials, isLoading, role } = useRole();
  
  return (
    <div>
      <div data-testid="loading">{isLoading ? 'loading' : 'ready'}</div>
      <div data-testid="role">{role}</div>
      <div data-testid="canEditRecipes">{canEditRecipes ? 'yes' : 'no'}</div>
      <div data-testid="canViewFinancials">{canViewFinancials ? 'yes' : 'no'}</div>
    </div>
  );
}

describe('RoleProvider', () => {
  beforeEach(() => {
    // Clear cookies before each test
    document.cookie.split(';').forEach(c => {
      document.cookie = c.replace(/^ +/, '').replace(/=.*/, '=;expires=' + new Date().toUTCString() + ';path=/');
    });
  });

  test('staff role by default (no management cookie)', async () => {
    render(
      <RoleProvider>
        <TestComponent />
      </RoleProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('ready');
    });

    expect(screen.getByTestId('role')).toHaveTextContent('staff');
    expect(screen.getByTestId('canEditRecipes')).toHaveTextContent('no');
    expect(screen.getByTestId('canViewFinancials')).toHaveTextContent('no');
  });

  test('management role when lariat_pin_ok cookie is set', async () => {
    // Set PIN cookie (consolidated auth — same cookie middleware.js and
    // /api/auth/pin use. Real cookie is HttpOnly in prod; jsdom tests rely
    // on the non-HttpOnly shim path inside RoleProvider.readPinCookie()).
    document.cookie = 'lariat_pin_ok=1; path=/';

    render(
      <RoleProvider>
        <TestComponent />
      </RoleProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('ready');
    });

    expect(screen.getByTestId('role')).toHaveTextContent('management');
    expect(screen.getByTestId('canEditRecipes')).toHaveTextContent('yes');
    expect(screen.getByTestId('canViewFinancials')).toHaveTextContent('yes');
  });

  test('loading state resolves', async () => {
    render(
      <RoleProvider>
        <TestComponent />
      </RoleProvider>
    );

    expect(screen.getByTestId('loading')).toHaveTextContent('loading');

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('ready');
    });
  });

  test('multiple consumers get same role context', async () => {
    document.cookie = 'lariat_pin_ok=1; path=/';

    function AnotherComponent() {
      const { role } = useRole();
      return <div data-testid="another-role">{role}</div>;
    }

    render(
      <RoleProvider>
        <TestComponent />
        <AnotherComponent />
      </RoleProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('ready');
    });

    expect(screen.getByTestId('role')).toHaveTextContent('management');
    expect(screen.getByTestId('another-role')).toHaveTextContent('management');
  });
});
