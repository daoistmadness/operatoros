import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../pages/Settings'));

export const Route = createFileRoute('/_authenticated/settings/')({
  beforeLoad: authorizeRoute('/settings'),
  component: () => <Page />,
});
