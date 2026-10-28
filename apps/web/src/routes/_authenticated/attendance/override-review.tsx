import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../pages/AttendanceCorrectionReview'));

export const Route = createFileRoute('/_authenticated/attendance/override-review')({
  beforeLoad: authorizeRoute('/attendance/override-review'),
  component: () => <Page />,
});
