import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../pages/StaffForm'));

export const Route = createFileRoute('/_authenticated/staff/new')({
  beforeLoad: authorizeRoute('/staff/new'),
  component: () => <Page />,
});
