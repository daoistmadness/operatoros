import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../pages/OperationsAudit'));

export const Route = createFileRoute('/_authenticated/students/operations')({
  beforeLoad: authorizeRoute('/students/operations'),
  component: () => <Page />,
});
