import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../pages/DataRecapitulation'));

export const Route = createFileRoute('/_authenticated/analytics/recapitulation')({
  beforeLoad: authorizeRoute('/analytics/recapitulation'),
  component: () => <Page />,
});
