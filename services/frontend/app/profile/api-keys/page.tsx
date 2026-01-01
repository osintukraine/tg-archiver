'use client';

import { useState, useEffect, useCallback } from 'react';
import { API_URL } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';

/**
 * API Keys Management Page
 *
 * Allows users to create, view, and revoke API keys for programmatic access.
 * Pattern follows feed-tokens page with key shown once on creation.
 */

interface ApiKey {
  id: string;
  prefix: string;
  name: string;
  description: string | null;
  scopes: string[];
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  use_count: number;
  rate_limit_tier: string | null;
  is_active: boolean;
  is_expired: boolean;
}

interface NewApiKeyResponse {
  api_key: {
    id: string;
    prefix: string;
    name: string;
    scopes: string[];
  };
  plaintext_key: string;
  warning: string;
}

const AVAILABLE_SCOPES = [
  { value: 'read', label: 'Read', description: 'Read messages, channels, events' },
  { value: 'write', label: 'Write', description: 'Create and update content' },
  { value: 'media', label: 'Media', description: 'Access media files' },
  { value: 'export', label: 'Export', description: 'Export data and feeds' },
];

export default function ApiKeysPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKey, setNewKey] = useState<NewApiKeyResponse | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scopes, setScopes] = useState<string[]>(['read']);
  const [expiresInDays, setExpiresInDays] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/api-keys`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys);
      } else if (res.status === 401) {
        setError('Please log in to manage API keys.');
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.detail || 'Failed to load API keys.');
      }
    } catch (err) {
      setError('Failed to load API keys.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchKeys();
    } else if (!authLoading) {
      setLoading(false);
    }
  }, [fetchKeys, isAuthenticated, authLoading]);

  const createKey = async () => {
    if (!name.trim()) {
      setError('Please enter a name for your API key.');
      return;
    }

    setCreating(true);
    setError(null);
    setNewKey(null);

    try {
      const body: any = {
        name: name.trim(),
        scopes,
      };
      if (description.trim()) {
        body.description = description.trim();
      }
      if (expiresInDays && expiresInDays > 0) {
        body.expires_in_days = expiresInDays;
      }

      const res = await fetch(`${API_URL}/api/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        setNewKey(data);
        setName('');
        setDescription('');
        setScopes(['read']);
        setExpiresInDays(null);
        setShowCreateForm(false);
        fetchKeys();
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.detail || 'Failed to create API key.');
      }
    } catch (err) {
      setError('Failed to create API key.');
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (keyId: string, keyName: string) => {
    if (!confirm(`Revoke API key "${keyName}"? All requests using this key will fail.`)) {
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/api-keys/${keyId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (res.ok) {
        fetchKeys();
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.detail || 'Failed to revoke API key.');
      }
    } catch (err) {
      setError('Failed to revoke API key.');
    }
  };

  const copyKey = () => {
    if (newKey) {
      navigator.clipboard.writeText(newKey.plaintext_key);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  const toggleScope = (scope: string) => {
    setScopes((prev) =>
      prev.includes(scope)
        ? prev.filter((s) => s !== scope)
        : [...prev, scope]
    );
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading || authLoading) {
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
            d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
          />
        </svg>
        <h2 className="text-xl font-semibold text-text-primary mb-2">
          Sign in to manage API keys
        </h2>
        <p className="text-text-secondary mb-6">
          Create API keys for programmatic access to the platform.
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
      <h1 className="text-2xl font-bold text-text-primary mb-2">API Keys</h1>
      <p className="text-text-secondary mb-6">
        Create API keys for programmatic access to the platform. Keys can be used with
        <code className="mx-1 px-1.5 py-0.5 bg-bg-secondary rounded text-sm">Authorization: Bearer ak_xxx</code>
        header or <code className="mx-1 px-1.5 py-0.5 bg-bg-secondary rounded text-sm">?api_key=ak_xxx</code> query parameter.
      </p>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg mb-6">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 text-red-500 hover:text-red-700"
          >
            ×
          </button>
        </div>
      )}

      {/* New Key Alert */}
      {newKey && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-900/50 rounded-lg p-4 mb-6">
          <h3 className="font-bold text-green-800 dark:text-green-300 mb-2">
            ✅ API Key Created Successfully
          </h3>
          <p className="text-sm text-green-700 dark:text-green-400 mb-3">
            <strong>Save this key now!</strong> It will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="bg-white dark:bg-bg-base px-3 py-2 rounded border border-green-300 dark:border-green-900 flex-1 font-mono text-sm break-all text-text-primary">
              {newKey.plaintext_key}
            </code>
            <button
              onClick={copyKey}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors whitespace-nowrap"
            >
              {copiedKey ? '✓ Copied!' : 'Copy'}
            </button>
          </div>
          <button
            onClick={() => setNewKey(null)}
            className="mt-3 text-sm text-green-700 dark:text-green-400 underline"
          >
            I&apos;ve saved the key, dismiss this
          </button>
        </div>
      )}

      {/* Create Key Form */}
      <div className="bg-bg-elevated border border-border-subtle rounded-lg mb-6">
        {!showCreateForm ? (
          <button
            onClick={() => setShowCreateForm(true)}
            className="w-full p-4 flex items-center justify-center gap-2 text-emerald-600 hover:bg-emerald-600/5 transition-colors rounded-lg"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create New API Key
          </button>
        ) : (
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-text-primary">Create New API Key</h2>
              <button
                onClick={() => setShowCreateForm(false)}
                className="text-text-tertiary hover:text-text-secondary"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g., Production API, My Script"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-base border border-border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  maxLength={100}
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Description (optional)
                </label>
                <input
                  type="text"
                  placeholder="What is this key for?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-base border border-border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  maxLength={500}
                />
              </div>

              {/* Scopes */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Permissions
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {AVAILABLE_SCOPES.map((scope) => (
                    <label
                      key={scope.value}
                      className={`
                        flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors
                        ${scopes.includes(scope.value)
                          ? 'border-emerald-500 bg-emerald-600/10'
                          : 'border-border-subtle hover:border-border-default'
                        }
                      `}
                    >
                      <input
                        type="checkbox"
                        checked={scopes.includes(scope.value)}
                        onChange={() => toggleScope(scope.value)}
                        className="mt-0.5"
                      />
                      <div>
                        <span className="font-medium text-text-primary block">{scope.label}</span>
                        <span className="text-xs text-text-tertiary">{scope.description}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Expiration */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Expiration (optional)
                </label>
                <select
                  value={expiresInDays || ''}
                  onChange={(e) => setExpiresInDays(e.target.value ? parseInt(e.target.value) : null)}
                  className="w-full px-3 py-2 bg-bg-base border border-border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                >
                  <option value="">Never expires</option>
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="365">1 year</option>
                </select>
              </div>

              <button
                onClick={createKey}
                disabled={creating || !name.trim()}
                className="w-full px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {creating ? 'Creating...' : 'Create API Key'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Keys List */}
      <div>
        <h2 className="font-semibold text-text-primary mb-3">
          Your API Keys ({keys.filter((k) => k.is_active).length} active)
        </h2>

        {keys.length === 0 ? (
          <p className="text-text-tertiary">No API keys yet. Create one above.</p>
        ) : (
          <div className="space-y-3">
            {keys.map((key) => (
              <div
                key={key.id}
                className={`
                  border rounded-lg p-4 transition-colors
                  ${key.is_active
                    ? 'bg-bg-elevated border-border-subtle'
                    : 'bg-bg-secondary/50 border-border-subtle opacity-60'
                  }
                `}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="font-mono text-sm bg-bg-secondary px-2 py-1 rounded">
                        {key.prefix}...
                      </code>
                      <span className="font-medium text-text-primary">{key.name}</span>

                      {/* Status badges */}
                      {!key.is_active && (
                        <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 px-2 py-0.5 rounded">
                          Revoked
                        </span>
                      )}
                      {key.is_expired && key.is_active && (
                        <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded">
                          Expired
                        </span>
                      )}
                    </div>

                    {key.description && (
                      <p className="text-sm text-text-tertiary mt-1">{key.description}</p>
                    )}

                    {/* Scopes */}
                    <div className="flex flex-wrap gap-1 mt-2">
                      {key.scopes.map((scope) => (
                        <span
                          key={scope}
                          className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded"
                        >
                          {scope}
                        </span>
                      ))}
                    </div>

                    {/* Metadata */}
                    <div className="text-sm text-text-tertiary mt-2 space-x-3">
                      <span>Created: {formatDate(key.created_at)}</span>
                      {key.last_used_at && (
                        <span>• Last used: {formatDate(key.last_used_at)}</span>
                      )}
                      <span>• {key.use_count.toLocaleString()} requests</span>
                      {key.expires_at && (
                        <span>• Expires: {formatDate(key.expires_at)}</span>
                      )}
                    </div>
                  </div>

                  {key.is_active && (
                    <button
                      onClick={() => revokeKey(key.id, key.name)}
                      className="text-red-600 hover:text-red-800 text-sm whitespace-nowrap"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Help Section */}
      <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-900/30 rounded-lg">
        <h3 className="font-semibold text-blue-800 dark:text-blue-300 mb-2">How to use API keys</h3>
        <ol className="list-decimal list-inside text-sm text-blue-700 dark:text-blue-400 space-y-1">
          <li>Create an API key above and save it securely</li>
          <li>Add the key to your requests using one of these methods:</li>
        </ol>
        <div className="mt-3 space-y-2">
          <code className="block text-xs bg-white dark:bg-bg-base p-2 rounded border border-blue-200 dark:border-blue-900 text-text-primary">
            Authorization: Bearer ak_xxxx_xxxxxxxxxxxxx
          </code>
          <code className="block text-xs bg-white dark:bg-bg-base p-2 rounded border border-blue-200 dark:border-blue-900 text-text-primary">
            GET /api/messages?api_key=ak_xxxx_xxxxxxxxxxxxx
          </code>
        </div>
        <p className="text-sm text-blue-600 dark:text-blue-400 mt-3">
          <strong>Note:</strong> If you revoke an API key, all requests using it will fail immediately.
        </p>
      </div>
    </div>
  );
}
