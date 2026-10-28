import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../lib/router/access';

const Page = lazy(() => import('../../features/readiness'));

export const Route = createFileRoute('/_authenticated/setup')({
  beforeLoad: authorizeRoute('/setup'),
  component: () => <Page />,
});
