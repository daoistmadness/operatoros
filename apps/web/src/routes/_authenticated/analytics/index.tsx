import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../pages/ManagementAnalytics'));

export const Route = createFileRoute('/_authenticated/analytics/')({
  beforeLoad: authorizeRoute('/analytics'),
  component: () => <Page />,
});
