import { createFileRoute, redirect } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';
import { validateSearch } from '../../../lib/router/search';

const Page = lazy(() => import('../../../pages/ReportsReviews'));

export const Route = createFileRoute('/_authenticated/reports/')({
  beforeLoad: (options) => {
    const access = authorizeRoute('/reports')(options);
    if (access) return access;
    const requested = validateSearch(options.location.search).view;
    const view = Array.isArray(requested) ? requested[0] : requested;
    if (!['monthly', 'annual', 'term-review'].includes(view ?? 'monthly') || (view === 'term-review' && !options.context.auth.can('view_student'))) {
      throw redirect({ to: '/reports', search: { view: 'monthly' }, replace: true });
    }
  },
  component: () => <Page />,
});
