import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { fetchDeploymentMode, type DeploymentMode } from '../features/operator-work-queue';
import { useAuth } from './AuthContext';

type DeploymentModeContextValue = {
  deploymentMode: DeploymentMode;
  isSingleUserMode: boolean;
  isLoading: boolean;
};

const DeploymentModeContext = createContext<DeploymentModeContextValue>({
  deploymentMode: 'multi_user',
  isSingleUserMode: false,
  isLoading: true,
});

export const DeploymentModeProvider = ({ children }: { children: ReactNode }) => {
  const [deploymentMode, setDeploymentMode] = useState<DeploymentMode>('multi_user');
  const [isSingleUserMode, setIsSingleUserMode] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  let auth = null;
  try {
    auth = useAuth();
  } catch {
    auth = null;
  }

  const authenticated = auth?.authenticated ?? false;

  useEffect(() => {
    let isMounted = true;

    if (!authenticated) {
      setDeploymentMode('multi_user');
      setIsSingleUserMode(false);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    fetchDeploymentMode()
      .then((data) => {
        if (isMounted) {
          const mode = data?.deployment_mode === 'single_user_offline' ? 'single_user_offline' : 'multi_user';
          setDeploymentMode(mode);
          setIsSingleUserMode(mode === 'single_user_offline');
        }
      })
      .catch(() => {
        if (isMounted) {
          setDeploymentMode('multi_user');
          setIsSingleUserMode(false);
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [authenticated]);

  return (
    <DeploymentModeContext.Provider value={{ deploymentMode, isSingleUserMode, isLoading }}>
      {children}
    </DeploymentModeContext.Provider>
  );
};

export const useDeploymentMode = () => useContext(DeploymentModeContext);
