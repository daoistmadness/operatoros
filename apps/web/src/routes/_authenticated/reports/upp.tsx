import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../pages/UppReports'));

export const Route = createFileRoute('/_authenticated/reports/upp')({
  beforeLoad: authorizeRoute('/reports/upp'),
  component: () => <Page />,
});
