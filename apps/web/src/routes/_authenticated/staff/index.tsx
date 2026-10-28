import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../pages/StaffManagement'));

export const Route = createFileRoute('/_authenticated/staff/')({
  beforeLoad: authorizeRoute('/staff'),
  component: () => <Page />,
});
