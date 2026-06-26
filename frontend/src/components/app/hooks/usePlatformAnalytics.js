import { useEffect } from 'react';
import { readFrontendEnv } from '../frontendEnv';

const PLATFORM_API_URL = readFrontendEnv('VITE_PLATFORM_API_URL', '');
const ANALYTICS_SCRIPT_ID = 'collectz-platform-analytics-script';

function removeAnalyticsScript() {
  const existing = document.getElementById(ANALYTICS_SCRIPT_ID);
  if (existing) existing.remove();
}

function applyAnalyticsScript(config) {
  const analytics = config?.analytics || null;
  removeAnalyticsScript();
  if (!analytics?.enabled || !analytics?.script_src || !analytics?.site_id) return;

  const script = document.createElement('script');
  script.id = ANALYTICS_SCRIPT_ID;
  script.async = true;
  script.src = analytics.script_src;
  script.setAttribute('data-site-id', analytics.site_id);
  const attributes = analytics.attributes && typeof analytics.attributes === 'object'
    ? analytics.attributes
    : {};
  Object.entries(attributes).forEach(([key, value]) => {
    if (!/^data-[a-z0-9-]{1,64}$/.test(String(key)) || key === 'data-site-id') return;
    script.setAttribute(key, String(value));
  });
  document.head.appendChild(script);
}

export default function usePlatformAnalytics(apiCall) {
  useEffect(() => {
    if (!PLATFORM_API_URL || typeof document === 'undefined') return undefined;
    let cancelled = false;
    apiCall('get', '/platform/analytics')
      .then((payload) => {
        if (!cancelled) applyAnalyticsScript(payload);
      })
      .catch(() => {
        if (!cancelled) removeAnalyticsScript();
      });
    const handleAnalyticsUpdated = (event) => {
      if (!cancelled) applyAnalyticsScript(event.detail);
    };
    window.addEventListener('collectz:platform-analytics-updated', handleAnalyticsUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener('collectz:platform-analytics-updated', handleAnalyticsUpdated);
    };
  }, [apiCall]);
}
