import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../pages/StaffAnalytics'));

export const Route = createFileRoute('/_authenticated/staff/analytics')({
  beforeLoad: authorizeRoute('/staff/analytics'),
  component: () => <Page />,
});
