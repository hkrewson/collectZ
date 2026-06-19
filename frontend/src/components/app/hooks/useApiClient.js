import { useCallback, useRef } from 'react';
import axios from 'axios';
import { readCookie } from '../AppPrimitives';
import { readFrontendEnv } from '../frontendEnv';

const API_URL = readFrontendEnv('VITE_API_URL', '/api');
const PLATFORM_API_URL = readFrontendEnv('VITE_PLATFORM_API_URL', '');
const CSRF_COOKIE_NAME = readFrontendEnv('VITE_CSRF_COOKIE_NAME', 'csrf_token');

function isPlatformOwnedPath(path) {
  const normalizedPath = String(path || '');
  if (
    normalizedPath.startsWith('/support/')
    && normalizedPath !== '/support/releases'
    && !normalizedPath.startsWith('/support/releases?')
  ) {
    return true;
  }

  if (normalizedPath === '/core-instances' || normalizedPath.startsWith('/core-instances/')) return true;
  if (normalizedPath === '/admin/spaces' || normalizedPath.startsWith('/admin/spaces/')) return true;
  if (normalizedPath === '/admin/users' || normalizedPath.startsWith('/admin/users/')) return true;
  if (normalizedPath === '/admin/activity' || normalizedPath.startsWith('/admin/activity?')) return true;
  if (normalizedPath === '/admin/loan-reminder-operations' || normalizedPath.startsWith('/admin/loan-reminder-operations?')) return true;
  if (normalizedPath === '/admin/settings/email-delivery' || normalizedPath.startsWith('/admin/settings/email-delivery/')) return true;

  return [
    '/admin/settings/integrations/test-pricecharting',
    '/admin/settings/integrations/test-ebay',
    '/admin/settings/integrations/test-logs'
  ].includes(normalizedPath);
}

function resolveApiBase(path) {
  if (PLATFORM_API_URL && isPlatformOwnedPath(path)) return PLATFORM_API_URL;
  return API_URL;
}

export default function useApiClient() {
  const inFlightGetRequestsRef = useRef(new Map());

  const apiCall = useCallback(async (method, path, data, config = {}) => {
    const methodUpper = String(method || 'GET').toUpperCase();
    const needsCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(methodUpper);
    const { rawResponse = false, ...axiosConfig } = config;
    const headers = { ...(axiosConfig.headers || {}) };
    const playwrightBypassToken = readCookie('playwright_e2e_bypass');
    const apiBase = resolveApiBase(path);

    if (playwrightBypassToken && !headers['x-playwright-e2e-bypass']) {
      headers['x-playwright-e2e-bypass'] = playwrightBypassToken;
    }

    if (needsCsrf && !headers['x-csrf-token']) {
      let csrfToken = readCookie(CSRF_COOKIE_NAME);
      if (!csrfToken) {
        try {
          const csrfResp = await axios.get(`${API_URL}/auth/csrf-token`, { withCredentials: true });
          csrfToken = csrfResp.data?.csrfToken || readCookie(CSRF_COOKIE_NAME);
        } catch (_) {
          csrfToken = readCookie(CSRF_COOKIE_NAME);
        }
      }
      if (csrfToken) headers['x-csrf-token'] = csrfToken;
    }

    const requestConfig = {
      method,
      url: `${apiBase}${path}`,
      data,
      ...axiosConfig,
      headers,
      withCredentials: true
    };

    if (methodUpper === 'GET') {
      const requestKey = JSON.stringify({
        method: methodUpper,
        apiBase,
        path,
        params: requestConfig.params || null
      });
      const existing = inFlightGetRequestsRef.current.get(requestKey);
      if (existing) return existing;
      const requestPromise = axios(requestConfig)
        .then((response) => (rawResponse ? response : response.data))
        .finally(() => {
          inFlightGetRequestsRef.current.delete(requestKey);
        });
      inFlightGetRequestsRef.current.set(requestKey, requestPromise);
      return requestPromise;
    }

    const response = await axios(requestConfig);
    return rawResponse ? response : response.data;
  }, []);

  return { apiCall, apiUrl: API_URL };
}
