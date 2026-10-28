import { createFileRoute, redirect } from '@tanstack/react-router';
import { authorizeRoute } from '../../../lib/router/access';


export const Route = createFileRoute('/_authenticated/config/absence-reasons')({
  beforeLoad: (options) => {
    const access = authorizeRoute('/config/absence-reasons')(options);
    if (access) return access;
    throw redirect({ to: '/attendance/monthly-recap', replace: true });
  },
});
