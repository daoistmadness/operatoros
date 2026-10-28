import { createFileRoute, redirect } from '@tanstack/react-router';
import { authorizeRoute } from '../../lib/router/access';


export const Route = createFileRoute('/_authenticated/upload-history')({
  beforeLoad: (options) => {
    const access = authorizeRoute('/upload-history')(options);
    if (access) return access;
    throw redirect({ to: '/upload', search: { section: 'history' }, replace: true });
  },
});
