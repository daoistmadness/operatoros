import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../pages/StudentInsights'));

export const Route = createFileRoute('/_authenticated/analytics/student-insights')({
  beforeLoad: authorizeRoute('/analytics/student-insights'),
  component: () => <Page />,
});
