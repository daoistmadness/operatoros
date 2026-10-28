import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { RouteLoadingFallback } from './RouteLoadingFallback';

const Page = lazy(() => import('../pages/Login'));

export const Route = createFileRoute('/login')({
  component: () => <Suspense fallback={<RouteLoadingFallback />}><Page /></Suspense>,
});
