import { createFileRoute, redirect } from '@tanstack/react-router';
import { authorizeRoute } from '../../../lib/router/access';


export const Route = createFileRoute('/_authenticated/reports/attendance')({
  beforeLoad: (options) => {
    const access = authorizeRoute('/reports/attendance')(options);
    if (access) return access;
    throw redirect({ to: '/analytics/attendance', search: { ...options.location.search, view: 'report' }, hash: options.location.hash, replace: true });
  },
});
