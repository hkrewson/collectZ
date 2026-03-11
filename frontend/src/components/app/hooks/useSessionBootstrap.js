import { useEffect, useState } from 'react';

export default function useSessionBootstrap({ route, apiCall, setRoute }) {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    if (route !== 'dashboard') {
      setAuthChecked(true);
      return;
    }

    let active = true;
    (async () => {
      try {
        const me = await apiCall('get', '/auth/me');
        if (!active) return;
        setUser(me);
      } catch (_) {
        if (!active) return;
        setUser(null);
        window.history.replaceState({}, '', '/login');
        setRoute('login');
      } finally {
        if (active) setAuthChecked(true);
      }
    })();

    return () => {
      active = false;
    };
  }, [route, apiCall, setRoute]);

  return {
    user,
    setUser,
    authChecked,
    setAuthChecked
  };
}
