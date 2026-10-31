import { AppLink as Link } from '../components/AppLink';
import { ClientOnly, createRootRouteWithContext, HeadContent, Outlet, Scripts, useLocation, useRouter } from '@tanstack/react-router';
import { lazy, Suspense, useLayoutEffect, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../lib/query/queryClient';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { DeploymentModeProvider } from '../context/DeploymentModeContext';
import { useSetupStatusQuery } from '../hooks/useSetupQueries';
import { SetupBoundary } from '../components/auth/SetupBoundary';
import type { RouterContext } from '../lib/router/access';
import { RouteLoadingFallback } from './RouteLoadingFallback';
import '../index.css';

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

function RouterContextBridge({ children }: { children: ReactNode }) {
  const router = useRouter();
  const auth = useAuth();
  const setup = useSetupStatusQuery();
  const setupLoading = setup.isLoading || setup.isError;
  const setupRequired = setup.data?.setup_required === true;

  useLayoutEffect(() => {
    router.update({ context: { auth, setupLoading, setupRequired } });
    void router.invalidate();
  }, [router, auth, setupLoading, setupRequired]);

  return children;
}

function RootComponent() {
  return (
    <ClientOnly fallback={<RouteLoadingFallback />}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <DeploymentModeProvider>
            <RouterContextBridge>
              <SetupBoundary><Outlet /></SetupBoundary>
            </RouterContextBridge>
            <Suspense fallback={null}><TanStackRouterDevtools position="bottom-right" /></Suspense>
          </DeploymentModeProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ClientOnly>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>
        <noscript>You need to enable JavaScript to run OperatorOS.</noscript>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', content: '#000000' },
      { name: 'description', content: 'OperatorOS - School Attendance & Grade Analytics' },
      { title: 'OperatorOS' },
    ],
  }),
  component: RootComponent,
  shellComponent: RootDocument,
  errorComponent: RouterError,
});
