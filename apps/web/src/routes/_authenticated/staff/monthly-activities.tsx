import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../pages/StaffMonthlyActivities'));

export const Route = createFileRoute('/_authenticated/staff/monthly-activities')({
  beforeLoad: authorizeRoute('/staff/monthly-activities'),
  component: () => <Page />,
});
