import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../lib/router/access';

const Page = lazy(() => import('../../pages/Enrollment'));

export const Route = createFileRoute('/_authenticated/enrollment')({
  beforeLoad: authorizeRoute('/enrollment'),
  component: () => <Page />,
});
