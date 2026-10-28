import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../pages/AttendanceCalendar'));

export const Route = createFileRoute('/_authenticated/attendance/calendar')({
  beforeLoad: authorizeRoute('/attendance/calendar'),
  component: () => <Page />,
});
