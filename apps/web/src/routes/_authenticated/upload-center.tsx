import { createFileRoute, redirect } from '@tanstack/react-router';
import { authorizeRoute } from '../../lib/router/access';


export const Route = createFileRoute('/_authenticated/upload-center')({
  beforeLoad: (options) => {
    const access = authorizeRoute('/upload-center')(options);
    if (access) return access;
    throw redirect({ to: '/upload', search: { section: 'attendance' }, replace: true });
  },
});
