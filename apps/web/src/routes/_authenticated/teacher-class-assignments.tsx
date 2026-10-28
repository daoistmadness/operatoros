import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../lib/router/access';

const Page = lazy(() => import('../../pages/TeacherClassAssignments'));

export const Route = createFileRoute('/_authenticated/teacher-class-assignments')({
  beforeLoad: authorizeRoute('/teacher-class-assignments'),
  component: () => <Page />,
});
