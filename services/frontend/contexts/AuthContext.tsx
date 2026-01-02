'use client';

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

export interface User {
  id: number;
  username: string;
  email: string;
  is_active: boolean;
  is_admin: boolean;
  // Computed for backwards compatibility
  name?: string;
  roles: string[];
  verified: boolean;
}

export interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  isLoading: boolean;
  error: string | null;
  token: string | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  refreshSession: () => Promise<void>;
  hasRole: (role: string) => boolean;
  isAdmin: () => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Token storage helpers
const TOKEN_KEY = 'tg_archiver_token';

function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

function setStoredToken(token: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(TOKEN_KEY, token);
  }
}

function removeStoredToken(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Fetch current user from /auth/users/me
  const fetchCurrentUser = useCallback(async (authToken: string): Promise<User | null> => {
    try {
      const response = await fetch(`${API_URL}/api/auth/users/me`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (response.ok) {
        const userData = await response.json();
        // Add computed fields for backwards compatibility
        return {
          ...userData,
          name: userData.username,
          roles: userData.is_admin ? ['admin'] : ['viewer'],
          verified: userData.is_active,
        };
      } else if (response.status === 401) {
        // Token invalid or expired
        removeStoredToken();
        return null;
      }
    } catch (err) {
      console.error('[Auth] Failed to fetch user:', err);
    }
    return null;
  }, []);

  // Initialize auth state from stored token
  const refreshSession = useCallback(async () => {
    const storedToken = getStoredToken();

    if (!storedToken) {
      setUser(null);
      setToken(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const userData = await fetchCurrentUser(storedToken);

    if (userData) {
      setUser(userData);
      setToken(storedToken);
    } else {
      setUser(null);
      setToken(null);
      removeStoredToken();
    }

    setIsLoading(false);
  }, [fetchCurrentUser]);

  // Initialize on mount
  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  // Login with username/password
  const login = useCallback(async (username: string, password: string): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      if (response.ok) {
        const data = await response.json();
        const newToken = data.access_token;

        // Store token
        setStoredToken(newToken);
        setToken(newToken);

        // Fetch user details
        const userData = await fetchCurrentUser(newToken);
        if (userData) {
          setUser(userData);
          setIsLoading(false);
          return true;
        }
      } else {
        const errorData = await response.json();
        setError(errorData.detail || 'Login failed');
      }
    } catch (err) {
      console.error('[Auth] Login error:', err);
      setError('Network error. Please try again.');
    }

    setIsLoading(false);
    return false;
  }, [fetchCurrentUser]);

  // Logout
  const logout = useCallback(() => {
    removeStoredToken();
    setUser(null);
    setToken(null);
    setError(null);
    router.push('/');
  }, [router]);

  // Role helpers
  const hasRole = useCallback((role: string) => {
    if (!user) return false;
    if (role === 'admin') return user.is_admin;
    return true; // All authenticated users have viewer role
  }, [user]);

  const isAdmin = useCallback(() => {
    return user?.is_admin ?? false;
  }, [user]);

  const value: AuthContextType = {
    isAuthenticated: !!user && !!token,
    user,
    isLoading,
    error,
    token,
    login,
    logout,
    refreshSession,
    hasRole,
    isAdmin,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

export { AuthContext };
