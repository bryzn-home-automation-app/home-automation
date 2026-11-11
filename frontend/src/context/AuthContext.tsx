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

/**
 * Whether the start-up session check got an answer. 'unreachable': a token is stored but the
 * server didn't answer /auth/me (network down, a 502 mid-deploy, a timeout). The person is still
 * signed in; ProtectedRoute shows "Can't reach the home server" and the check retries (B-014).
 */
export type SessionCheck = 'ok' | 'unreachable';

interface AuthContextValue {
  user: LoginResponse | null;
  token: string | null;
  isLoading: boolean;
  sessionCheck: SessionCheck;
  /** A retry of the session check is in flight (for the Try again key). */
  retryingSession: boolean;
  /** Ask the server again now (Try again). */
  retrySession: () => void;
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
  sessionCheck: 'ok',
  retryingSession: false,
  retrySession: () => {},
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

/** The pause (ms) before the next automatic retry while the server can't be reached: 2 s, 4, 8, 16, then every 30 s. */
export function sessionRetryDelay(failures: number): number {
  return Math.min(30_000, 2_000 * 2 ** Math.max(0, failures - 1));
}

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
  const [sessionCheck, setSessionCheck] = useState<SessionCheck>('ok');
  const [failures, setFailures] = useState(0);
  const [retryingSession, setRetryingSession] = useState(false);
  const loggedInViaForm = useRef(false);
  const checking = useRef(false);

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
      setSessionCheck('ok');
      setFailures(0);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  /**
   * Ask the server who the stored token belongs to. Only a rejected token (401/403) ends the
   * session. Anything else (no network, a 502 while the backend restarts, a timeout) keeps the
   * token and marks the check 'unreachable', so a signed-in person is never sent to the sign-in
   * page (or on to SSO and nginx's bare 502) by a hiccup (B-014).
   */
  const checkSession = useCallback(async () => {
    const stored = readStoredToken();
    if (!stored) {
      setSessionCheck('ok');
      setFailures(0);
      setIsLoading(false);
      setRetryingSession(false);
      return;
    }
    if (checking.current) return;
    checking.current = true;
    try {
      const u = await fetchMe();
      // A sign-out or a new sign-in while the request was out wins.
      if (readStoredToken() !== stored) return;
      setUser(u);
      setSessionCheck('ok');
      setFailures(0);
    } catch (err) {
      if (readStoredToken() !== stored) return;
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 403) {
        try { localStorage.removeItem(TOKEN_KEY); } catch { /* */ }
        setToken(null);
        setUser(null);
        setSessionCheck('ok');
        setFailures(0);
        return;
      }
      setSessionCheck('unreachable');
      setFailures((n) => n + 1);
    } finally {
      checking.current = false;
      setIsLoading(false);
      setRetryingSession(false);
    }
  }, []);

  // On mount: validate the stored token.
  useEffect(() => {
    const stored = readStoredToken();
    if (!stored) {
      setIsLoading(false);
      return;
    }
    setToken(stored);
    void checkSession();
  }, [checkSession]); // only on mount (checkSession is stable)

  // While the server can't be reached: retry with a growing pause, and at once when the device
  // comes back online or the app comes back to the front.
  useEffect(() => {
    if (sessionCheck !== 'unreachable' || !token) return;
    const timer = window.setTimeout(() => void checkSession(), sessionRetryDelay(failures));
    const again = () => {
      if (document.visibilityState === 'visible') void checkSession();
    };
    window.addEventListener('online', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('online', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, [sessionCheck, token, failures, checkSession]);

  const retrySession = useCallback(() => {
    setRetryingSession(true);
    void checkSession();
  }, [checkSession]);

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
    setSessionCheck('ok');
    setFailures(0);
  }, []);

  const logout = useCallback(() => {
    loggedInViaForm.current = false;
    queryClient.clear();
    setToken(null);
    setUser(null);
    setSessionCheck('ok');
    setFailures(0);
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
      sessionCheck,
      retryingSession,
      retrySession,
      isAdmin: user?.role === 'ADMIN',
      isUser: user?.role === 'USER',
      isGuest: user?.role === 'GUEST',
      login,
      logout,
      refreshUser,
    }),
    [user, token, isLoading, sessionCheck, retryingSession, retrySession, login, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
