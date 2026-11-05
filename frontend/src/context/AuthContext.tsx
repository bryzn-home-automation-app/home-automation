import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import type { LoginResponse } from '../api/auth';
import { fetchMe, heartbeat as sendHeartbeat } from '../api/auth';
import api, { setUnauthorizedHandler } from '../api/client';
import { queryClient } from '../queryClient';

interface AuthContextValue {
  user: LoginResponse | null;
  token: string | null;
  isLoading: boolean;
  isAdmin: boolean;
  isUser: boolean;
  isGuest: boolean;
  login: (token: string, user: LoginResponse) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  isLoading: true,
  isAdmin: false,
  isUser: false,
  isGuest: false,
  login: () => {},
  logout: () => {},
  refreshUser: async () => {},
});

const TOKEN_KEY = 'auth_token';
/**
 * Set by Sign out, cleared by the next sign-in. While set, the login page waits for a tap instead
 * of starting home SSO by itself, which would sign straight back in through the live SSO session.
 */
export const SIGNED_OUT_KEY = 'signed_out';

function readStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<LoginResponse | null>(null);
  const [token, setToken] = useState<string | null>(readStoredToken);
  const [isLoading, setIsLoading] = useState(!!readStoredToken());
  const loggedInViaForm = useRef(false);

  // Set up axios interceptor for the token — always keep it current
  useEffect(() => {
    const id = api.interceptors.request.use((config) => {
      // Read latest token from localStorage to avoid stale closures
      const currentToken = localStorage.getItem(TOKEN_KEY);
      if (currentToken) {
        config.headers.Authorization = `Bearer ${currentToken}`;
      }
      return config;
    });
    return () => {
      api.interceptors.request.eject(id);
    };
  }, []); // run once — reads token from localStorage on every request

  // A 401 from a data endpoint means the session ended. Drop it so ProtectedRoute redirects to
  // /login (remembering where the user was). Not on /login or /guest*, and only while a token
  // exists, so a burst of 401s acts once and can't loop. Sign-out's flag is not set, so home SSO
  // can still sign back in on its own.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      const path = window.location.pathname;
      if (path === '/login' || path.startsWith('/guest')) return;
      if (!readStoredToken()) return;
      try { localStorage.removeItem(TOKEN_KEY); } catch { /* */ }
      queryClient.clear();
      loggedInViaForm.current = false;
      setToken(null);
      setUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // On mount: validate stored token
  useEffect(() => {
    const stored = readStoredToken();
    if (!stored) {
      setIsLoading(false);
      return;
    }

    // Set token in state from storage
    setToken(stored);

    fetchMe()
      .then((u) => {
        setUser(u);
      })
      .catch((err) => {
        // Only a rejected token ends the session; a 502 mid-deploy or flaky network must not.
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status !== 401 && status !== 403) {
          setUser(null);
          return;
        }
        try { localStorage.removeItem(TOKEN_KEY); } catch { /* */ }
        setToken(null);
        setUser(null);
      })
      .finally(() => setIsLoading(false));
  }, []); // only on mount

  // Heartbeat every 60 seconds when logged in
  useEffect(() => {
    if (!token) return;
    const interval = setInterval(() => {
      sendHeartbeat().catch(() => {});
    }, 60_000);
    return () => clearInterval(interval);
  }, [token]);

  const login = useCallback((newToken: string, newUser: LoginResponse) => {
    loggedInViaForm.current = true;
    queryClient.clear(); // never show the previous person's cached data
    // Set localStorage FIRST so the interceptor picks it up
    try {
      localStorage.setItem(TOKEN_KEY, newToken);
      localStorage.removeItem(SIGNED_OUT_KEY);
    } catch { /* quota exceeded */ }
    // Then set state — ProtectedRoute will see these immediately
    setToken(newToken);
    setUser(newUser);
    setIsLoading(false);
  }, []);

  const logout = useCallback(() => {
    loggedInViaForm.current = false;
    queryClient.clear();
    setToken(null);
    setUser(null);
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.setItem(SIGNED_OUT_KEY, '1');
    } catch { /* */ }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const u = await fetchMe();
      setUser(u);
    } catch {
      // session invalid — clear
    }
  }, []);

  // Stable context value — a fresh object every render would re-render every
  // consumer. login/logout/refreshUser are already useCallback'd.
  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isLoading,
      isAdmin: user?.role === 'ADMIN',
      isUser: user?.role === 'USER',
      isGuest: user?.role === 'GUEST',
      login,
      logout,
      refreshUser,
    }),
    [user, token, isLoading, login, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
