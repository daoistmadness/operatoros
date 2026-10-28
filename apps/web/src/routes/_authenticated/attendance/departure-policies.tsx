import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../pages/DismissalPolicies').then((module) => ({ default: module.DismissalPolicies })));

export const Route = createFileRoute('/_authenticated/attendance/departure-policies')({
  beforeLoad: authorizeRoute('/attendance/departure-policies'),
  component: () => <Page />,
});
