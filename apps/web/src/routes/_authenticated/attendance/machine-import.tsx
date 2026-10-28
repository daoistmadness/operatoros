import { createFileRoute, redirect } from '@tanstack/react-router';
import { authorizeRoute } from '../../../lib/router/access';


export const Route = createFileRoute('/_authenticated/attendance/machine-import')({
  beforeLoad: (options) => {
    const access = authorizeRoute('/attendance/machine-import')(options);
    if (access) return access;
    throw redirect({ to: '/upload', replace: true });
  },
});
