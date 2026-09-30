import { useCallback, useRef } from 'react';
import axios from 'axios';
import { readCookie } from '../AppPrimitives';
import { readFrontendEnv } from '../frontendEnv';

const API_URL = readFrontendEnv('VITE_API_URL', '/api');
const CSRF_COOKIE_NAME = readFrontendEnv('VITE_CSRF_COOKIE_NAME', 'csrf_token');

export default function useApiClient() {
  const inFlightGetRequestsRef = useRef(new Map());

  const apiCall = useCallback(async (method, path, data, config = {}) => {
    const methodUpper = String(method || 'GET').toUpperCase();
    const needsCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(methodUpper);
    const {
      rawResponse = false,
      requireRecentReauthentication = false,
      reauthenticationReason = 'Confirm your password to continue with this sensitive operation.',
      ...axiosConfig
    } = config;
    const headers = { ...(axiosConfig.headers || {}) };
    const playwrightBypassToken = readCookie('playwright_e2e_bypass');
    const apiBase = API_URL;

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

    try {
      const response = await axios(requestConfig);
      return rawResponse ? response : response.data;
    } catch (error) {
      const shouldPrompt = requireRecentReauthentication
        && error?.response?.status === 403
        && error?.response?.data?.code === 'recent_reauthentication_required';
      if (!shouldPrompt) throw error;

      const password = window.prompt(reauthenticationReason);
      if (!password) throw error;
      await axios({
        method: 'post',
        url: `${apiBase}/auth/reauthenticate`,
        data: { password },
        headers,
        withCredentials: true
      });
      const response = await axios(requestConfig);
      return rawResponse ? response : response.data;
    }
  }, []);

  return { apiCall, apiUrl: API_URL };
}
