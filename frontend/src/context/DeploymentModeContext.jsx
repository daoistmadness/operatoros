import React, { createContext, useContext, useEffect, useState } from 'react';
import { fetchDeploymentMode } from '../lib/api/operator';
import { useAuth } from './AuthContext';

const DeploymentModeContext = createContext({
  deploymentMode: 'multi_user',
  isSingleUserMode: false,
  isLoading: true,
});

export const DeploymentModeProvider = ({ children }) => {
  const [deploymentMode, setDeploymentMode] = useState('multi_user');
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
