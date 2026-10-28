import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../pages/AttendanceFollowUpQueue'));

export const Route = createFileRoute('/_authenticated/attendance/followups')({
  beforeLoad: authorizeRoute('/attendance/followups'),
  component: () => <Page />,
});
