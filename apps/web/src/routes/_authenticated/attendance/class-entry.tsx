import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../pages/ClassAttendanceEntry'));

export const Route = createFileRoute('/_authenticated/attendance/class-entry')({
  beforeLoad: authorizeRoute('/attendance/class-entry'),
  component: () => <Page />,
});
