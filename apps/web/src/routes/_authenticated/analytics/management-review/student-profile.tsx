import { createFileRoute, redirect } from '@tanstack/react-router';
import { authorizeRoute } from '../../../../lib/router/access';


export const Route = createFileRoute('/_authenticated/analytics/management-review/student-profile')({
  beforeLoad: (options) => {
    const access = authorizeRoute('/analytics/management-review/student-profile')(options);
    if (access) return access;
    throw redirect({ to: '/reports', search: { ...options.location.search, view: 'term-review' }, hash: options.location.hash, replace: true });
  },
});
