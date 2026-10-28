import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider, useRouterState } from '@tanstack/react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AppLink } from '../../components/AppLink';
import { MemoryRouter, Route } from '../../test/TestRouter';
import { parseSearch, stringifySearch, useUrlSearchParams, type SearchParamsSetter } from './search';

let staleSetter: SearchParamsSetter | undefined;

function DailyPage() {
  const [, setSearchParams] = useUrlSearchParams();
  staleSetter ??= setSearchParams;
  return <AppLink to="/attendance/class-entry?class_id=1&date=2026-08-03">Continue attendance</AppLink>;
}

function ClassEntryPage() {
  const href = useRouterState({ select: (state) => state.location.href });
  return <output>{href}</output>;
}

function ReportsIndexPage() {
  const [, setSearchParams] = useUrlSearchParams();
  const href = useRouterState({ select: (state) => state.location.href });
  return <button onClick={() => setSearchParams((current) => {
    current.set('academic_year_id', '7');
    return current;
  }, { replace: true })}>{href}</button>;
}

describe('useUrlSearchParams', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    staleSetter = undefined;
  });

  it('does not let a stale page effect replace the destination query', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/attendance/daily?date=2026-08-03&academic_year_id=1']}>
          <Route path="/attendance/daily" element={<DailyPage />} />
          <Route path="/attendance/class-entry" element={<ClassEntryPage />} />
        </MemoryRouter>,
      );
    });

    await act(async () => container.querySelector('a')?.click());
    expect(container.textContent).toContain('/attendance/class-entry?class_id=1&date=2026-08-03');

    await act(async () => {
      staleSetter?.(new URLSearchParams({ date: '2026-08-03', academic_year_id: '1' }), { replace: true });
    });

    expect(container.textContent).toContain('/attendance/class-entry?class_id=1&date=2026-08-03');
  });

  it('updates search params from an index route with the canonical pathname', async () => {
    const rootRoute = createRootRoute({ component: Outlet });
    const reportsRoute = createRoute({ getParentRoute: () => rootRoute, path: 'reports', component: Outlet });
    const reportsIndexRoute = createRoute({ getParentRoute: () => reportsRoute, path: '/', component: ReportsIndexPage });
    const router = createRouter({
      routeTree: rootRoute.addChildren([reportsRoute.addChildren([reportsIndexRoute])]),
      history: createMemoryHistory({ initialEntries: ['/reports?view=term-review'] }),
      parseSearch,
      stringifySearch,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => root.render(<RouterProvider router={router} />));
    await act(async () => container.querySelector('button')?.click());

    expect(container.textContent).toContain('/reports?view=term-review&academic_year_id=7');
  });
});
