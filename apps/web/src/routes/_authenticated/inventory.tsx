import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../lib/router/access';

const Page = lazy(() => import('../../pages/InventoryManagement'));

export const Route = createFileRoute('/_authenticated/inventory')({
  beforeLoad: authorizeRoute('/inventory'),
  component: () => <Page />,
});
