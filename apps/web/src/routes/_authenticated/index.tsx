import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../lib/router/access';

const Page = lazy(() => import('../../pages/Dashboard'));

export const Route = createFileRoute('/_authenticated/')({
  beforeLoad: authorizeRoute('/'),
  component: () => <Page />,
});
