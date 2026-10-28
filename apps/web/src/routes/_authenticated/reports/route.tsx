import { createFileRoute, Outlet } from '@tanstack/react-router';
import { validateSearch } from '../../../lib/router/search';

export const Route = createFileRoute('/_authenticated/reports')({
  validateSearch,
  component: Outlet,
});
