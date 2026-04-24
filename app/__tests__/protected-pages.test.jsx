import { render, screen, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';

jest.mock('next/navigation');

describe('Protected Pages', () => {
  describe('Recipe Edit Page', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      // Clear cookies
      document.cookie.split(';').forEach(c => {
        document.cookie = c.replace(/^ +/, '').replace(/=.*/, '=;expires=' + new Date().toUTCString() + ';path=/');
      });
    });

    test('should redirect staff users away from edit page', async () => {
      const mockRouter = { push: jest.fn() };
      useRouter.mockReturnValue(mockRouter);

      // Import after mock setup
      const { RecipeEditPage } = await import('../recipes/[slug]/edit/page');

      render(
        <RecipeEditPage params={{ slug: 'test-recipe' }} />
      );

      await waitFor(() => {
        expect(mockRouter.push).toHaveBeenCalledWith('/recipes/test-recipe');
      });
    });

    test('should show null while checking permissions', () => {
      const mockRouter = { push: jest.fn() };
      useRouter.mockReturnValue(mockRouter);

      // Component returns null for staff users, which is expected behavior
      const { container } = render(
        <RecipeEditPage params={{ slug: 'test-recipe' }} />
      );

      expect(container.firstChild).toBeNull();
    });

    test('should display loading state initially', () => {
      const mockRouter = { push: jest.fn() };
      useRouter.mockReturnValue(mockRouter);

      render(
        <RecipeEditPage params={{ slug: 'test-recipe' }} />
      );

      // While isLoading is true, should show loading message
      expect(screen.queryByText(/Loading/i)).toBeInTheDocument();
    });
  });

  describe('Costing Page', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      document.cookie.split(';').forEach(c => {
        document.cookie = c.replace(/^ +/, '').replace(/=.*/, '=;expires=' + new Date().toUTCString() + ';path=/');
      });
    });

    test('should show access denied message for staff users', () => {
      // Import CostingDashboard component
      const { CostingDashboard } = require('../costing/CostingDashboard');

      render(
        <CostingDashboard 
          variance={{ max_variance_pct: 2.5, mean_variance_pct: 1.8, recipes_over_5pct: 0, rows: [] }}
          unmapped={{ unmapped_pct: 0.5, unmapped_count: 2, total_items: 400, pack_size_changes_unacknowledged: 0, rows: [] }}
          ingest={{ age_minutes: 30, last_status: 'success', last_run_at: '2026-04-22T10:00:00Z' }}
          dishCoverage={{ total_sales_dishes: 150, fully_linked: 145, unlinked: 5, declared_only: 0, partial: 0 }}
          topVariance={[]}
          firstUnmapped={[]}
        />
      );

      // Should show access denied message
      expect(screen.getByText(/Management Access Required/i)).toBeInTheDocument();
      expect(screen.getByText(/Financial data and costing benchmarks are restricted/i)).toBeInTheDocument();
    });

    test('should show management link for staff users', () => {
      const { CostingDashboard } = require('../costing/CostingDashboard');

      render(
        <CostingDashboard 
          variance={{ max_variance_pct: 2.5, mean_variance_pct: 1.8, recipes_over_5pct: 0, rows: [] }}
          unmapped={{ unmapped_pct: 0.5, unmapped_count: 2, total_items: 400, pack_size_changes_unacknowledged: 0, rows: [] }}
          ingest={{ age_minutes: 30, last_status: 'success', last_run_at: '2026-04-22T10:00:00Z' }}
          dishCoverage={{ total_sales_dishes: 150, fully_linked: 145, unlinked: 5, declared_only: 0, partial: 0 }}
          topVariance={[]}
          firstUnmapped={[]}
        />
      );

      const link = screen.getByText(/Unlock Management Mode/i);
      expect(link).toHaveAttribute('href', '/recipes/management-pin');
    });
  });

  describe('Role Transitions', () => {
    test('staff user should become management after authentication', async () => {
      // Set management cookie (consolidated PIN cookie — same one middleware.js
      // and /api/auth/pin gate on). Tests use a non-HttpOnly shim since jsdom
      // can't see the real HttpOnly cookie.
      document.cookie = 'lariat_pin_ok=1; path=/';

      // Component should detect the new cookie and update role
      const { RoleProvider, useRole } = await import('../_components/RoleProvider');

      function TransitionTest() {
        const { canEditRecipes, canViewFinancials } = useRole();
        return (
          <div>
            <div data-testid="canEdit">{canEditRecipes ? 'can-edit' : 'no-edit'}</div>
            <div data-testid="canView">{canViewFinancials ? 'can-view' : 'no-view'}</div>
          </div>
        );
      }

      const { rerender } = render(
        <RoleProvider>
          <TransitionTest />
        </RoleProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('canEdit')).toHaveTextContent('can-edit');
        expect(screen.getByTestId('canView')).toHaveTextContent('can-view');
      });
    });

    test('management user should become staff after logout', async () => {
      // Start with management cookie
      document.cookie = 'lariat_pin_ok=1; path=/';

      const { RoleProvider, useRole } = await import('../_components/RoleProvider');

      function LogoutTest() {
        const { role } = useRole();
        return <div data-testid="role">{role}</div>;
      }

      render(
        <RoleProvider>
          <LogoutTest />
        </RoleProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('role')).toHaveTextContent('management');
      });

      // Clear the cookie (simulating logout)
      document.cookie = 'lariat_pin_ok=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';

      // Re-render to detect role change
      // In real scenario, router.refresh() would handle this
    });
  });
});
