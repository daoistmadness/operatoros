import { createFileRoute, redirect } from '@tanstack/react-router';
import { authorizeRoute } from '../../../lib/router/access';


export const Route = createFileRoute('/_authenticated/reports/annual')({
  beforeLoad: (options) => {
    const access = authorizeRoute('/reports/annual')(options);
    if (access) return access;
    throw redirect({ to: '/reports', search: { ...options.location.search, view: 'annual' }, hash: options.location.hash, replace: true });
  },
});
