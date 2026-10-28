import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../pages/ClassEarlyDeparture').then((module) => ({ default: module.ClassEarlyDeparture })));

export const Route = createFileRoute('/_authenticated/attendance/class-departures')({
  beforeLoad: authorizeRoute('/attendance/class-departures'),
  component: () => <Page />,
});
