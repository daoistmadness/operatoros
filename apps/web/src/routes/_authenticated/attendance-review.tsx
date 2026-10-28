import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../lib/router/access';

const Page = lazy(() => import('../../pages/AttendanceReview'));

export const Route = createFileRoute('/_authenticated/attendance-review')({
  beforeLoad: authorizeRoute('/attendance-review'),
  component: () => <Page />,
});
