import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../pages/AcademicAssessmentOperations'));

export const Route = createFileRoute('/_authenticated/grades/operations')({
  beforeLoad: authorizeRoute('/grades/operations'),
  component: () => <Page />,
});
