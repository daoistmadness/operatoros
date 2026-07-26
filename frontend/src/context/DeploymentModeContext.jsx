import React, { createContext, useContext, useEffect, useState } from 'react';
import { fetchDeploymentMode } from '../lib/api/operator';

const DeploymentModeContext = createContext({
  deploymentMode: 'single_user_offline',
  isSingleUserMode: true,
  isLoading: true,
});

export const DeploymentModeProvider = ({ children }) => {
  const [deploymentMode, setDeploymentMode] = useState('single_user_offline');
  const [isSingleUserMode, setIsSingleUserMode] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    fetchDeploymentMode()
      .then((data) => {
        if (isMounted) {
          const mode = data.deployment_mode || 'single_user_offline';
          setDeploymentMode(mode);
          setIsSingleUserMode(mode === 'single_user_offline');
        }
      })
      .catch(() => {
        if (isMounted) {
          setDeploymentMode('single_user_offline');
          setIsSingleUserMode(true);
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <DeploymentModeContext.Provider value={{ deploymentMode, isSingleUserMode, isLoading }}>
      {children}
    </DeploymentModeContext.Provider>
  );
};

export const useDeploymentMode = () => useContext(DeploymentModeContext);
