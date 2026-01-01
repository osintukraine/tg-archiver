'use client';

import { useState, useEffect, useCallback } from 'react';
import { API_URL } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';

/**
 * Usage & Rate Limits Page
 *
 * Shows the user their current rate limit tier and usage statistics
 * across all their API keys.
 */

interface UsageSummary {
  total_keys: number;
  active_keys: number;
  total_requests: number;
  requests_today: number;
  requests_this_week: number;
  requests_this_month: number;
  rate_limit_tier: string;
  tier_limits: {
    default: number;
    media: number;
    export: number;
    map: number;
  };
  keys: Array<{
    id: string;
    name: string;
    prefix: string;
    use_count: number;
    last_used_at: string | null;
  }>;
}

// Rate limit tier descriptions
const TIER_INFO: Record<string, { label: string; color: string; description: string }> = {
  anonymous: {
    label: 'Anonymous',
    color: 'text-gray-600',
    description: 'Basic access without authentication',
  },
  authenticated: {
    label: 'Authenticated',
    color: 'text-blue-600',
    description: 'Standard authenticated user limits',
  },
  premium: {
    label: 'Premium',
    color: 'text-purple-600',
    description: 'Higher limits for verified users',
  },
  admin: {
    label: 'Admin',
    color: 'text-red-600',
    description: 'Elevated limits for administrators',
  },
};

export default function UsagePage() {
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsage = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/api-keys/usage/summary`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setUsage(data);
      } else if (res.status === 401) {
        setError('Please log in to view usage.');
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.detail || 'Failed to load usage data.');
      }
    } catch (err) {
      setError('Failed to load usage data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchUsage();
    } else if (!authLoading) {
      setLoading(false);
    }
  }, [fetchUsage, isAuthenticated, authLoading]);

  if (loading || authLoading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-bg-secondary rounded w-1/3 mb-4"></div>
        <div className="h-4 bg-bg-secondary rounded w-1/2 mb-8"></div>
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="h-24 bg-bg-secondary rounded"></div>
          <div className="h-24 bg-bg-secondary rounded"></div>
          <div className="h-24 bg-bg-secondary rounded"></div>
          <div className="h-24 bg-bg-secondary rounded"></div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
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
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
        <h2 className="text-xl font-semibold text-text-primary mb-2">
          Sign in to view usage
        </h2>
        <p className="text-text-secondary mb-6">
          View your rate limits and API usage statistics.
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

  const tier = usage?.rate_limit_tier || 'authenticated';
  const tierInfo = TIER_INFO[tier] || TIER_INFO.authenticated;

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary mb-2">Usage & Limits</h1>
      <p className="text-text-secondary mb-8">
        Monitor your API usage and understand your rate limits.
      </p>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {/* Rate Limit Tier */}
      <div className="bg-bg-elevated border border-border-subtle rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4">Your Rate Limit Tier</h2>

        <div className="flex items-center gap-4 mb-4">
          <div className={`text-2xl font-bold ${tierInfo.color}`}>
            {tierInfo.label}
          </div>
          {user?.roles.includes('admin') && (
            <span className="px-2 py-1 text-xs rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
              Admin
            </span>
          )}
        </div>

        <p className="text-text-secondary mb-4">{tierInfo.description}</p>

        {/* Limits Grid */}
        {usage?.tier_limits && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-bg-secondary rounded-lg p-4">
              <div className="text-2xl font-bold text-text-primary">
                {usage.tier_limits.default}
              </div>
              <div className="text-sm text-text-tertiary">Default / min</div>
            </div>
            <div className="bg-bg-secondary rounded-lg p-4">
              <div className="text-2xl font-bold text-text-primary">
                {usage.tier_limits.media}
              </div>
              <div className="text-sm text-text-tertiary">Media / min</div>
            </div>
            <div className="bg-bg-secondary rounded-lg p-4">
              <div className="text-2xl font-bold text-text-primary">
                {usage.tier_limits.export}
              </div>
              <div className="text-sm text-text-tertiary">Export / min</div>
            </div>
            <div className="bg-bg-secondary rounded-lg p-4">
              <div className="text-2xl font-bold text-text-primary">
                {usage.tier_limits.map}
              </div>
              <div className="text-sm text-text-tertiary">Map / min</div>
            </div>
          </div>
        )}
      </div>

      {/* Usage Stats */}
      {usage && (
        <>
          <h2 className="text-lg font-semibold text-text-primary mb-4">API Usage</h2>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-bg-elevated border border-border-subtle rounded-lg p-4">
              <div className="text-3xl font-bold text-emerald-600">
                {usage.total_requests.toLocaleString()}
              </div>
              <div className="text-sm text-text-tertiary">Total Requests</div>
            </div>
            <div className="bg-bg-elevated border border-border-subtle rounded-lg p-4">
              <div className="text-3xl font-bold text-blue-600">
                {usage.requests_today.toLocaleString()}
              </div>
              <div className="text-sm text-text-tertiary">Today</div>
            </div>
            <div className="bg-bg-elevated border border-border-subtle rounded-lg p-4">
              <div className="text-3xl font-bold text-purple-600">
                {usage.requests_this_week.toLocaleString()}
              </div>
              <div className="text-sm text-text-tertiary">This Week</div>
            </div>
            <div className="bg-bg-elevated border border-border-subtle rounded-lg p-4">
              <div className="text-3xl font-bold text-amber-600">
                {usage.requests_this_month.toLocaleString()}
              </div>
              <div className="text-sm text-text-tertiary">This Month</div>
            </div>
          </div>

          {/* API Keys Summary */}
          <div className="bg-bg-elevated border border-border-subtle rounded-lg overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-border-subtle flex items-center justify-between">
              <h3 className="font-semibold text-text-primary">API Keys</h3>
              <span className="text-sm text-text-tertiary">
                {usage.active_keys} of {usage.total_keys} active
              </span>
            </div>

            {usage.keys.length === 0 ? (
              <div className="p-6 text-center text-text-tertiary">
                No API keys yet.{' '}
                <Link href="/profile/api-keys" className="text-emerald-600 hover:underline">
                  Create one
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-border-subtle">
                {usage.keys.slice(0, 5).map((key) => (
                  <div key={key.id} className="px-6 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <code className="text-sm font-mono bg-bg-secondary px-2 py-0.5 rounded">
                        {key.prefix}...
                      </code>
                      <span className="text-text-primary">{key.name}</span>
                    </div>
                    <div className="text-sm text-text-tertiary">
                      {key.use_count.toLocaleString()} requests
                    </div>
                  </div>
                ))}
                {usage.keys.length > 5 && (
                  <div className="px-6 py-3 text-center">
                    <Link
                      href="/profile/api-keys"
                      className="text-sm text-emerald-600 hover:underline"
                    >
                      View all {usage.keys.length} keys
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* Rate Limit Tiers Reference */}
      <div className="bg-bg-elevated border border-border-subtle rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-border-subtle">
          <h3 className="font-semibold text-text-primary">All Rate Limit Tiers</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg-secondary">
              <tr>
                <th className="px-6 py-3 text-left text-text-secondary font-medium">Tier</th>
                <th className="px-6 py-3 text-right text-text-secondary font-medium">Default</th>
                <th className="px-6 py-3 text-right text-text-secondary font-medium">Media</th>
                <th className="px-6 py-3 text-right text-text-secondary font-medium">Export</th>
                <th className="px-6 py-3 text-right text-text-secondary font-medium">Map</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              <tr className={tier === 'anonymous' ? 'bg-emerald-50 dark:bg-emerald-900/10' : ''}>
                <td className="px-6 py-3 text-text-primary">Anonymous</td>
                <td className="px-6 py-3 text-right text-text-secondary">60/min</td>
                <td className="px-6 py-3 text-right text-text-secondary">30/min</td>
                <td className="px-6 py-3 text-right text-text-secondary">10/min</td>
                <td className="px-6 py-3 text-right text-text-secondary">120/min</td>
              </tr>
              <tr className={tier === 'authenticated' ? 'bg-emerald-50 dark:bg-emerald-900/10' : ''}>
                <td className="px-6 py-3 text-text-primary">Authenticated</td>
                <td className="px-6 py-3 text-right text-text-secondary">120/min</td>
                <td className="px-6 py-3 text-right text-text-secondary">60/min</td>
                <td className="px-6 py-3 text-right text-text-secondary">30/min</td>
                <td className="px-6 py-3 text-right text-text-secondary">240/min</td>
              </tr>
              <tr className={tier === 'premium' ? 'bg-emerald-50 dark:bg-emerald-900/10' : ''}>
                <td className="px-6 py-3 text-text-primary">Premium</td>
                <td className="px-6 py-3 text-right text-text-secondary">300/min</td>
                <td className="px-6 py-3 text-right text-text-secondary">150/min</td>
                <td className="px-6 py-3 text-right text-text-secondary">100/min</td>
                <td className="px-6 py-3 text-right text-text-secondary">600/min</td>
              </tr>
              <tr className={tier === 'admin' ? 'bg-emerald-50 dark:bg-emerald-900/10' : ''}>
                <td className="px-6 py-3 text-text-primary">Admin</td>
                <td className="px-6 py-3 text-right text-text-secondary">1000/min</td>
                <td className="px-6 py-3 text-right text-text-secondary">500/min</td>
                <td className="px-6 py-3 text-right text-text-secondary">500/min</td>
                <td className="px-6 py-3 text-right text-text-secondary">1000/min</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Help Text */}
      <p className="mt-6 text-sm text-text-tertiary">
        Rate limits are applied per user or API key. Authenticated users get higher limits than anonymous access.
        If you need higher limits, please contact an administrator.
      </p>
    </div>
  );
}
