import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../../lib/router/access';

const Page = lazy(() => import('../../../pages/BackupManagement'));

export const Route = createFileRoute('/_authenticated/settings/backups')({
  beforeLoad: authorizeRoute('/settings/backups'),
  component: () => <Page />,
});
