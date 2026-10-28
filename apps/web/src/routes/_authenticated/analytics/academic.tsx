import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../pages/AcademicAnalytics'));

export const Route = createFileRoute('/_authenticated/analytics/academic')({
  beforeLoad: authorizeRoute('/analytics/academic'),
  component: () => <Page />,
});
