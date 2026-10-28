import { createFileRoute, redirect } from '@tanstack/react-router';
import { authorizeRoute } from '../../../lib/router/access';


export const Route = createFileRoute('/_authenticated/analytics/trends')({
  beforeLoad: (options) => {
    const access = authorizeRoute('/analytics/trends')(options);
    if (access) return access;
    throw redirect({ to: '/analytics/student-insights', search: { ...options.location.search, view: 'trends' }, hash: options.location.hash, replace: true });
  },
});
