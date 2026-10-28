import { createFileRoute } from '@tanstack/react-router';
import { AppShell } from '../components/AppShell';
import { AuthLoading } from '../components/auth/RouteGuards';
import { useAuth } from '../context/AuthContext';
import { authorizeRoute } from '../lib/router/access';
import { validateSearch } from '../lib/router/search';

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: authorizeRoute('/'),
  validateSearch,
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { authenticated, loading } = useAuth();
  return loading || !authenticated ? <AuthLoading /> : <AppShell />;
}
