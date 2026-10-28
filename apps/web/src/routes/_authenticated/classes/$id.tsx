import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../pages/ClassOverview'));

export const Route = createFileRoute('/_authenticated/classes/$id')({
  beforeLoad: authorizeRoute('/classes/:id'),
  component: () => <Page />,
});
