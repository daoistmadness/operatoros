import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../pages/AbsenceReasons'));

export const Route = createFileRoute('/_authenticated/attendance/monthly-recap')({
  beforeLoad: authorizeRoute('/attendance/monthly-recap'),
  component: () => <Page />,
});
