import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../pages/AttendanceReconciliation'));

export const Route = createFileRoute('/_authenticated/attendance/reconciliation')({
  beforeLoad: authorizeRoute('/attendance/reconciliation'),
  component: () => <Page />,
});
