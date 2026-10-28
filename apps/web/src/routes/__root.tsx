import { AppLink as Link } from '../components/AppLink';
import { createRootRouteWithContext, Outlet, useLocation } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { SetupBoundary } from '../components/auth/SetupBoundary';
import type { RouterContext } from '../lib/router/access';

const TanStackRouterDevtools = import.meta.env.DEV
  ? lazy(() => import('@tanstack/react-router-devtools').then((module) => ({ default: module.TanStackRouterDevtools })))
  : () => null;

function RouterError({ reset }: { reset: () => void }) {
  const { pathname } = useLocation();
  const destination = pathname === '/login' ? '/login' : '/';
  return (
    <div role="alert" className="mx-auto mt-16 max-w-xl rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-sm">
      <h1 className="text-2xl font-black text-slate-900">This page could not be loaded</h1>
      <p className="mt-2 text-sm font-semibold text-slate-600">The page encountered a temporary problem. Retry it, or return to a safe workspace.</p>
      <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
        <button type="button" onClick={reset} className="min-h-11 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2">Retry</button>
        <Link to={destination} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2">
          {destination === '/login' ? 'Return to sign in' : 'Return to dashboard'}
        </Link>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <>
      <SetupBoundary><Outlet /></SetupBoundary>
      <Suspense fallback={null}><TanStackRouterDevtools position="bottom-right" /></Suspense>
    </>
  ),
  errorComponent: RouterError,
});
