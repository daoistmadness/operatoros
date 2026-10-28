import { createFileRoute, redirect } from '@tanstack/react-router';
import { authorizeRoute } from '../../lib/router/access';


export const Route = createFileRoute('/_authenticated/mapping')({
  beforeLoad: (options) => {
    const access = authorizeRoute('/mapping')(options);
    if (access) return access;
    throw redirect({ to: '/enrollment', replace: true });
  },
});
