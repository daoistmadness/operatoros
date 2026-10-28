import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../pages/CanonicalStudentProfile'));

export const Route = createFileRoute('/_authenticated/students/$id')({
  beforeLoad: authorizeRoute('/students/:id'),
  component: () => <Page />,
});
