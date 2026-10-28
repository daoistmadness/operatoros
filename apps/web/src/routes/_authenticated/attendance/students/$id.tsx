import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../../lib/router/access';

const Page = lazy(() => import('../../../../pages/StudentProfile'));

export const Route = createFileRoute('/_authenticated/attendance/students/$id')({
  beforeLoad: authorizeRoute('/attendance/students/:id'),
  component: () => <Page />,
});
