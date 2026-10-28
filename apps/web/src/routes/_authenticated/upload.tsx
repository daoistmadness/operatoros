import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authorizeRoute } from '../../lib/router/access';

const Page = lazy(() => import('../../pages/UploadCenter'));

export const Route = createFileRoute('/_authenticated/upload')({
  beforeLoad: authorizeRoute('/upload'),
  component: () => <Page />,
});
