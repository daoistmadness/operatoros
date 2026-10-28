import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../pages/HebConfig'));

export const Route = createFileRoute('/_authenticated/config/heb')({
  beforeLoad: authorizeRoute('/config/heb'),
  component: () => <Page />,
});
