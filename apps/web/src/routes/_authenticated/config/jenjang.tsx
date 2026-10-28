import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../features/jenjang-config'));

export const Route = createFileRoute('/_authenticated/config/jenjang')({
  beforeLoad: authorizeRoute('/config/jenjang'),
  component: () => <Page />,
});
