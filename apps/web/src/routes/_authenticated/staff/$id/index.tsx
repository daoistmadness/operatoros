import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../../lib/router/access';

const Page = lazy(() => import('../../../../pages/StaffDetail'));

export const Route = createFileRoute('/_authenticated/staff/$id/')({
  beforeLoad: authorizeRoute('/staff/:id'),
  component: () => <Page />,
});
