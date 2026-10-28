import { createFileRoute, redirect } from '@tanstack/react-router';
import { authorizeRoute } from '../../lib/router/access';


export const Route = createFileRoute('/_authenticated/data-portability')({
  beforeLoad: (options) => {
    const access = authorizeRoute('/data-portability')(options);
    if (access) return access;
    throw redirect({ to: '/upload', search: { section: 'export' }, replace: true });
  },
});
