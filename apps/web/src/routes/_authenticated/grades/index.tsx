import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../pages/GradeLedger'));

export const Route = createFileRoute('/_authenticated/grades/')({
  beforeLoad: authorizeRoute('/grades'),
  component: () => <Page />,
});
