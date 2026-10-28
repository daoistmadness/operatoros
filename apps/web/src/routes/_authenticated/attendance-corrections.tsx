import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../lib/router/access';

const Page = lazy(() => import('../../pages/AttendanceCorrections'));

export const Route = createFileRoute('/_authenticated/attendance-corrections')({
  beforeLoad: authorizeRoute('/attendance-corrections'),
  component: () => <Page />,
});
