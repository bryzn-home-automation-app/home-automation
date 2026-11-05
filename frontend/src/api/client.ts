import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

// AuthProvider registers this; it clears the session so the route guard sends the user to /login.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

// Auth endpoints (login, me, OIDC/SSO) report their own 401s; everything else means the session ended.
function isAuthEndpoint(url?: string): boolean {
  return /^\/?(api\/)?auth\//.test(url ?? '');
}

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !isAuthEndpoint(error.config?.url)) {
      onUnauthorized?.();
    }
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export default api;
