'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

/**
 * AdminAuthGuard Component
 *
 * Wraps admin page content and ensures only admin users can view it.
 * Redirects non-admins to home page and shows loading state during auth check.
 */

export function AdminAuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, isAdmin, isLoading } = useAuth();

  useEffect(() => {
    // Wait for auth check to complete
    if (isLoading) return;

    // If not authenticated, middleware should redirect, but double-check
    if (!isAuthenticated) {
      router.push('/auth/login?returnTo=/admin');
      return;
    }

    // If authenticated but not admin, redirect to home
    if (!isAdmin()) {
      router.push('/');
    }
  }, [isAuthenticated, isAdmin, isLoading, router]);

  // Show loading state while checking auth
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-text-secondary">Checking permissions...</div>
      </div>
    );
  }

  // Don't render admin content if not admin
  if (!isAuthenticated || !isAdmin()) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <div className="text-red-400 text-lg font-medium mb-2">Access Denied</div>
          <div className="text-text-secondary">You need admin privileges to access this page.</div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
