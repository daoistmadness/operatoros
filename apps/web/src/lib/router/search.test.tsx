import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider, useRouterState } from '@tanstack/react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AppLink } from '../../components/AppLink';
import { MemoryRouter, Route } from '../../test/TestRouter';
import { parseSearch, stringifySearch, useUrlSearchParams, validateSearch, type SearchParamsSetter } from './search';

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

function SearchBoundaryPage() {
  const [, setSearchParams] = useUrlSearchParams();
  const href = useRouterState({ select: (state) => state.location.href });
  return <><output>{href}</output><button onClick={() => setSearchParams(new URLSearchParams('__proto__=blocked&constructor=blocked&toString=blocked&tag=first&tag=second&unknown=retained'))}>Serialize search</button></>;
}

describe('router search values', () => {
  it('filters reserved keys and keeps repeated and unknown values in parse order', () => {
    const parsed = parseSearch('__proto__=blocked&constructor=blocked&toString=blocked&tag=first&tag=second&unknown=retained');
    expect(parsed).toEqual({ tag: ['first', 'second'], unknown: 'retained' });
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    for (const key of ['__proto__', 'constructor', 'toString']) expect(Object.hasOwn(parsed, key)).toBe(false);
  });

  it('converts supported TypeBox search values and omits reserved or invalid values', () => {
    const raw: Record<string, unknown> = {
      constructor: 'blocked',
      toString: 'blocked',
      enabled: false,
      page: 2,
      tags: ['first', 'second'],
      invalid: { nested: true },
      mixed: ['first', 2],
    };
    Object.defineProperty(raw, '__proto__', { value: 'blocked', enumerable: true });
    const validated = validateSearch(raw);
    expect(validated).toEqual({ enabled: 'false', page: '2', tags: ['first', 'second'] });
    expect(Object.getPrototypeOf(validated)).toBe(Object.prototype);
    for (const key of ['__proto__', 'constructor', 'toString']) expect(Object.hasOwn(validated, key)).toBe(false);
  });

  it('filters reserved keys during serialization and preserves repeated unknown values', () => {
    const search: Record<string, unknown> = {
      constructor: 'blocked',
      toString: 'blocked',
      tag: ['first', 'second'],
      unknown: 'retained',
    };
    Object.defineProperty(search, '__proto__', { value: 'blocked', enumerable: true });
    expect(stringifySearch(search)).toBe('?tag=first&tag=second&unknown=retained');
  });
});

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

  it('filters reserved keys from URLSearchParams updates without dropping repeats or unknown keys', async () => {
    const rootRoute = createRootRoute({ component: Outlet });
    const reportsRoute = createRoute({ getParentRoute: () => rootRoute, path: 'reports', component: Outlet });
    const reportsIndexRoute = createRoute({ getParentRoute: () => reportsRoute, path: '/', component: SearchBoundaryPage });
    const router = createRouter({
      routeTree: rootRoute.addChildren([reportsRoute.addChildren([reportsIndexRoute])]),
      history: createMemoryHistory({ initialEntries: ['/reports'] }),
      parseSearch,
      stringifySearch,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => root.render(<RouterProvider router={router} />));
    await act(async () => container.querySelector('button')?.click());

    expect(container.querySelector('output')?.textContent).toBe('/reports?tag=first&tag=second&unknown=retained');
  });
});
