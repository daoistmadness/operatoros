import { createFileRoute, redirect } from '@tanstack/react-router';
import { authorizeRoute } from '../../../../lib/router/access';


export const Route = createFileRoute('/_authenticated/reports/management/monthly')({
  beforeLoad: (options) => {
    const access = authorizeRoute('/reports/management/monthly')(options);
    if (access) return access;
    throw redirect({ to: '/reports', search: { ...options.location.search, view: 'monthly' }, hash: options.location.hash, replace: true });
  },
});
