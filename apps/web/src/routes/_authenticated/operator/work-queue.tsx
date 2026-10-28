import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../features/operator-work-queue'));

export const Route = createFileRoute('/_authenticated/operator/work-queue')({
  beforeLoad: authorizeRoute('/operator/work-queue'),
  component: () => <Page />,
});
