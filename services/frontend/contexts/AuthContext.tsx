'use client';

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { Configuration, FrontendApi, Session, Identity } from '@ory/client';
import { useRouter } from 'next/navigation';

// Initialize Ory Kratos client
// When behind Caddy proxy, use /kratos path (same origin)
// For direct access, use the full Kratos URL
const kratosPublicUrl = process.env.NEXT_PUBLIC_ORY_URL ||
  (typeof window !== 'undefined' ? `${window.location.origin}/kratos` : 'http://localhost:4433');

const ory = new FrontendApi(
  new Configuration({
    basePath: kratosPublicUrl,
    baseOptions: {
      withCredentials: true,
    },
  })
);

export interface User {
  id: string;
  email: string;
  name?: string;
  roles: string[];
  verified: boolean;
}

export interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  isLoading: boolean;
  error: string | null;
  login: (returnTo?: string) => void;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  hasRole: (role: string) => boolean;
  isAdmin: () => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function mapSessionToUser(session: Session): User {
  const identity: Identity = session.identity!;
  const traits = identity.traits as { email?: string; name?: { first?: string; last?: string } };
  const metadata = identity.metadata_public as { role?: string; roles?: string[] } | null;

  // Handle both formats: "role" (string) from Kratos admin or "roles" (array)
  let roles: string[] = ['viewer'];
  if (metadata?.roles && Array.isArray(metadata.roles)) {
    roles = metadata.roles;
  } else if (metadata?.role && typeof metadata.role === 'string') {
    roles = [metadata.role];
  }

  return {
    id: identity.id,
    email: traits?.email || 'unknown@example.com',
    name: traits?.name?.first
      ? `${traits.name.first} ${traits.name.last || ''}`.trim()
      : undefined,
    roles,
    verified: (identity.verifiable_addresses?.length || 0) > 0,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const refreshSession = useCallback(async () => {
    try {
      setError(null);
      const { data: session } = await ory.toSession();

      if (session?.active) {
        const mappedUser = mapSessionToUser(session);
        setUser(mappedUser);
        return;
      }
    } catch (err: unknown) {
      // 401/403 is expected for unauthenticated users
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status !== 401 && status !== 403) {
        console.error('[Auth] Session refresh failed:', err);
        setError('Failed to refresh session');
      }
    }
    setUser(null);
  }, []);

  useEffect(() => {
    const initSession = async () => {
      setIsLoading(true);
      await refreshSession();
      setIsLoading(false);
    };
    initSession();
  }, [refreshSession]);

  const login = useCallback((returnTo?: string) => {
    const loginUrl = new URL('/auth/login', window.location.origin);
    if (returnTo) {
      loginUrl.searchParams.set('returnTo', returnTo);
    }
    router.push(loginUrl.toString());
  }, [router]);

  const logout = useCallback(async () => {
    try {
      setError(null);
      const { data: flow } = await ory.createBrowserLogoutFlow();

      // Perform logout
      await ory.updateLogoutFlow({ token: flow.logout_token });

      setUser(null);
      router.push('/');
    } catch (err) {
      console.error('[Auth] Logout failed:', err);
      setError('Logout failed');
      // Force clear user state anyway
      setUser(null);
    }
  }, [router]);

  const hasRole = useCallback((role: string) => {
    return user?.roles?.includes(role) ?? false;
  }, [user]);

  const isAdmin = useCallback(() => {
    return hasRole('admin');
  }, [hasRole]);

  const value: AuthContextType = {
    isAuthenticated: !!user,
    user,
    isLoading,
    error,
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
