import { useLayoutEffect } from 'react';
import { RouterProvider } from '@tanstack/react-router';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DeploymentModeProvider } from './context/DeploymentModeContext';
import { useSetupStatusQuery } from './hooks/useSetupQueries';
import { router } from './router';

function RouterHost() {
  const auth = useAuth();
  const setup = useSetupStatusQuery();
  const setupLoading = setup.isLoading || setup.isError;
  const setupRequired = setup.data?.setup_required === true;

  useLayoutEffect(() => {
    void router.invalidate();
  }, [auth.authenticated, auth.loading, auth.user, setupLoading, setupRequired]);

  return <RouterProvider router={router} context={{ auth, setupLoading, setupRequired }} />;
}

export function App() {
  return (
    <AuthProvider>
      <DeploymentModeProvider>
        <RouterHost />
      </DeploymentModeProvider>
    </AuthProvider>
  );
}

export default App;
