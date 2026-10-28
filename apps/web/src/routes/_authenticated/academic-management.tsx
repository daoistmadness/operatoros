import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../lib/router/access';

const Page = lazy(() => import('../../pages/AcademicManagement'));

export const Route = createFileRoute('/_authenticated/academic-management')({
  beforeLoad: authorizeRoute('/academic-management'),
  component: () => <Page />,
});
