import { createFileRoute, redirect } from '@tanstack/react-router';
import { authorizeRoute } from '../../../lib/router/access';


export const Route = createFileRoute('/_authenticated/reports/rekap-absensi')({
  beforeLoad: (options) => {
    const access = authorizeRoute('/reports/rekap-absensi')(options);
    if (access) return access;
    throw redirect({ to: '/analytics/attendance', search: { ...options.location.search, view: 'recap' }, hash: options.location.hash, replace: true });
  },
});
