import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import type { LoginResponse } from '../api/auth';
import { fetchMe, heartbeat as sendHeartbeat } from '../api/auth';
import api from '../api/client';

interface AuthContextValue {
  user: LoginResponse | null;
  token: string | null;
  isLoading: boolean;
  isAdmin: boolean;
  isUser: boolean;
  isGuest: boolean;
  login: (token: string, user: LoginResponse) => void;
  logout: () => void;
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
});

const TOKEN_KEY = 'auth_token';

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
      .catch(() => {
        // Token invalid — clear storage
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
    // Set localStorage FIRST so the interceptor picks it up
    try {
      localStorage.setItem(TOKEN_KEY, newToken);
    } catch { /* quota exceeded */ }
    // Then set state — ProtectedRoute will see these immediately
    setToken(newToken);
    setUser(newUser);
    setIsLoading(false);
  }, []);

  const logout = useCallback(() => {
    loggedInViaForm.current = false;
    setToken(null);
    setUser(null);
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch { /* */ }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAdmin: user?.role === 'ADMIN',
        isUser: user?.role === 'USER',
        isGuest: user?.role === 'GUEST',
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
