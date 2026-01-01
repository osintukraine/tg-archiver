'use client';

import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';

/**
 * Profile Account Page
 *
 * Displays user account information and provides navigation
 * to other profile sections.
 */

export default function ProfilePage() {
  const { user, isLoading, isAuthenticated, logout } = useAuth();

  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-bg-secondary rounded w-1/3 mb-4"></div>
        <div className="h-4 bg-bg-secondary rounded w-1/2 mb-8"></div>
        <div className="space-y-4">
          <div className="h-24 bg-bg-secondary rounded"></div>
          <div className="h-24 bg-bg-secondary rounded"></div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="text-center py-12">
        <svg
          className="w-16 h-16 mx-auto text-text-tertiary mb-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
          />
        </svg>
        <h2 className="text-xl font-semibold text-text-primary mb-2">
          Sign in to access your profile
        </h2>
        <p className="text-text-secondary mb-6">
          Manage your account settings, API keys, and usage.
        </p>
        <Link
          href="/auth/login"
          className="inline-flex items-center px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
        >
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary mb-2">Account</h1>
      <p className="text-text-secondary mb-8">
        Manage your account information and settings.
      </p>

      {/* User Info Card */}
      <div className="bg-bg-elevated border border-border-subtle rounded-lg p-6 mb-6">
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div className="w-16 h-16 rounded-full bg-emerald-600 flex items-center justify-center text-white text-2xl font-semibold">
            {user.email.charAt(0).toUpperCase()}
          </div>

          <div className="flex-1">
            <h2 className="text-lg font-semibold text-text-primary">
              {user.name || 'User'}
            </h2>
            <p className="text-text-secondary">{user.email}</p>

            <div className="flex flex-wrap gap-2 mt-3">
              {user.roles.map((role) => (
                <span
                  key={role}
                  className={`
                    px-2 py-1 text-xs rounded-full font-medium
                    ${role === 'admin'
                      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    }
                  `}
                >
                  {role}
                </span>
              ))}
              {user.verified && (
                <span className="px-2 py-1 text-xs rounded-full font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  Verified
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <Link
          href="/profile/api-keys"
          className="bg-bg-elevated border border-border-subtle rounded-lg p-4 hover:border-emerald-500/50 transition-colors group"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-600/10 text-emerald-600 group-hover:bg-emerald-600/20 transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </div>
            <div>
              <h3 className="font-medium text-text-primary">API Keys</h3>
              <p className="text-sm text-text-tertiary">
                Create keys for programmatic access
              </p>
            </div>
          </div>
        </Link>

        <Link
          href="/profile/usage"
          className="bg-bg-elevated border border-border-subtle rounded-lg p-4 hover:border-emerald-500/50 transition-colors group"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-600/10 text-blue-600 group-hover:bg-blue-600/20 transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div>
              <h3 className="font-medium text-text-primary">Usage & Limits</h3>
              <p className="text-sm text-text-tertiary">
                View your rate limits and usage
              </p>
            </div>
          </div>
        </Link>
      </div>

      {/* Account Details */}
      <div className="bg-bg-elevated border border-border-subtle rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-border-subtle">
          <h3 className="font-semibold text-text-primary">Account Details</h3>
        </div>

        <div className="divide-y divide-border-subtle">
          <div className="px-6 py-4 flex justify-between">
            <span className="text-text-secondary">User ID</span>
            <span className="text-text-primary font-mono text-sm">{user.id}</span>
          </div>
          <div className="px-6 py-4 flex justify-between">
            <span className="text-text-secondary">Email</span>
            <span className="text-text-primary">{user.email}</span>
          </div>
          <div className="px-6 py-4 flex justify-between">
            <span className="text-text-secondary">Email Status</span>
            <span className={user.verified ? 'text-green-600' : 'text-amber-600'}>
              {user.verified ? 'Verified' : 'Not Verified'}
            </span>
          </div>
          <div className="px-6 py-4 flex justify-between">
            <span className="text-text-secondary">Roles</span>
            <span className="text-text-primary">{user.roles.join(', ')}</span>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="mt-8 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-lg p-6">
        <h3 className="font-semibold text-red-700 dark:text-red-400 mb-2">
          Sign Out
        </h3>
        <p className="text-red-600 dark:text-red-400/80 text-sm mb-4">
          This will end your current session. You&apos;ll need to sign in again to access protected features.
        </p>
        <button
          onClick={logout}
          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
