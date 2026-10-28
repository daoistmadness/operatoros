import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../pages/DataQuality'));

export const Route = createFileRoute('/_authenticated/analytics/data-quality')({
  beforeLoad: authorizeRoute('/analytics/data-quality'),
  component: () => <Page />,
});
