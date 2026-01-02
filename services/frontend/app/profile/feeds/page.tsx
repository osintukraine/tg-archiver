'use client';

import { useState, useEffect, useCallback } from 'react';
import { API_URL } from '@/lib/api';
import { getAuthHeaders } from '@/lib/auth-utils';

// ============================================================================
// Types
// ============================================================================

interface FeedToken {
  id: number;
  name: string | null;
  created_at: string;
  last_used_at: string | null;
  is_active: boolean;
}

interface NewToken {
  id: number;
  token: string;
  name: string | null;
}

interface FeedSubscription {
  id: string;
  feed_type: string;
  summary: string;
  label: string | null;
  feed_params: Record<string, unknown>;
  created_at: string;
  last_accessed_at: string | null;
  access_count: number;
}

// ============================================================================
// Main Component
// ============================================================================

export default function FeedTokensPage() {
  // Token state
  const [tokens, setTokens] = useState<FeedToken[]>([]);
  const [newToken, setNewToken] = useState<NewToken | null>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);

  // Subscriptions state
  const [subscriptions, setSubscriptions] = useState<Record<number, FeedSubscription[]>>({});
  const [expandedTokens, setExpandedTokens] = useState<Set<number>>(new Set());
  const [loadingSubscriptions, setLoadingSubscriptions] = useState<Set<number>>(new Set());

  // ============================================================================
  // Token API Functions
  // ============================================================================

  const fetchTokens = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/feed-tokens`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setTokens(data.tokens);
      } else if (res.status === 401) {
        setError('Please log in to manage feed tokens.');
      }
    } catch {
      setError('Failed to load tokens.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const fetchSubscriptions = async (tokenId: number) => {
    setLoadingSubscriptions((prev) => new Set(prev).add(tokenId));
    try {
      const res = await fetch(`${API_URL}/api/feed-tokens/${tokenId}/subscriptions`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setSubscriptions((prev) => ({ ...prev, [tokenId]: data.subscriptions }));
      }
    } catch {
      console.error('Failed to load subscriptions for token', tokenId);
    } finally {
      setLoadingSubscriptions((prev) => {
        const next = new Set(prev);
        next.delete(tokenId);
        return next;
      });
    }
  };

  const toggleTokenExpanded = (tokenId: number) => {
    setExpandedTokens((prev) => {
      const next = new Set(prev);
      if (next.has(tokenId)) {
        next.delete(tokenId);
      } else {
        next.add(tokenId);
        if (!subscriptions[tokenId]) {
          fetchSubscriptions(tokenId);
        }
      }
      return next;
    });
  };

  const createToken = async () => {
    setCreating(true);
    setError(null);
    setNewToken(null);

    try {
      const res = await fetch(`${API_URL}/api/feed-tokens`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ name: name || null }),
      });

      if (res.ok) {
        const data = await res.json();
        setNewToken(data);
        setName('');
        fetchTokens();
      } else {
        const errData = await res.json();
        setError(errData.detail || 'Failed to create token.');
      }
    } catch {
      setError('Failed to create token.');
    } finally {
      setCreating(false);
    }
  };

  const revokeToken = async (tokenId: number) => {
    if (!confirm('Revoke this token? All feed URLs using it will stop working.')) {
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/feed-tokens/${tokenId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });

      if (res.ok) {
        fetchTokens();
      } else {
        const errData = await res.json();
        setError(errData.detail || 'Failed to revoke token.');
      }
    } catch {
      setError('Failed to revoke token.');
    }
  };

  const copyToken = () => {
    if (newToken) {
      navigator.clipboard.writeText(newToken.token);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    }
  };

  // ============================================================================
  // Helpers
  // ============================================================================

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatDate(dateStr);
  };

  // ============================================================================
  // Render
  // ============================================================================

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">Feed Tokens</h1>
        <p className="text-text-secondary">Loading...</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Feed Tokens</h1>
      <p className="text-text-secondary mb-6">
        Manage authentication tokens for RSS/Atom/JSON feed subscriptions.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* New Token Alert */}
      {newToken && (
        <div className="bg-green-50 border border-green-300 rounded-lg p-4 mb-6">
          <h3 className="font-bold text-green-800 mb-2">
            Token Created Successfully
          </h3>
          <p className="text-sm text-green-700 mb-3">
            <strong>Save this token now!</strong> It will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="bg-white px-3 py-2 rounded border flex-1 font-mono text-sm break-all">
              {newToken.token}
            </code>
            <button
              onClick={copyToken}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              {copiedToken ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <button
            onClick={() => setNewToken(null)}
            className="mt-3 text-sm text-green-700 underline"
          >
            I&apos;ve saved the token, dismiss this
          </button>
        </div>
      )}

      {/* Create Token Form */}
      <div className="bg-bg-secondary border border-border-default rounded-lg p-4 mb-6">
        <h2 className="font-semibold mb-3">Create New Token</h2>
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Name (optional) e.g., 'My Feedly'"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 px-3 py-2 border border-border-default rounded bg-bg-base"
            maxLength={100}
          />
          <button
            onClick={createToken}
            disabled={creating}
            className="px-4 py-2 bg-accent-primary text-white rounded hover:bg-accent-primary-hover disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create Token'}
          </button>
        </div>
      </div>

      {/* Token List */}
      <div>
        <h2 className="font-semibold mb-3">Your Tokens ({tokens.length})</h2>
        {tokens.length === 0 ? (
          <p className="text-text-secondary">No tokens yet. Create one above.</p>
        ) : (
          <div className="space-y-3">
            {tokens.map((token) => (
              <div
                key={token.id}
                className={`border border-border-default rounded-lg overflow-hidden ${
                  token.is_active ? 'bg-bg-base' : 'bg-bg-secondary opacity-60'
                }`}
              >
                <div className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <code className="font-mono text-sm bg-bg-secondary px-2 py-1 rounded">
                          Token #{token.id}
                        </code>
                        {token.name && (
                          <span className="text-text-primary font-medium">{token.name}</span>
                        )}
                        {!token.is_active && (
                          <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded">
                            Revoked
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-text-secondary mt-1">
                        Created: {formatDate(token.created_at)}
                        {token.last_used_at && (
                          <> · Last used: {formatRelativeTime(token.last_used_at)}</>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {token.is_active && (
                        <>
                          <button
                            onClick={() => toggleTokenExpanded(token.id)}
                            className="text-blue-600 hover:text-blue-800 text-sm"
                          >
                            {expandedTokens.has(token.id) ? 'Hide feeds' : 'Show feeds'}
                          </button>
                          <button
                            onClick={() => revokeToken(token.id)}
                            className="text-red-600 hover:text-red-800 text-sm"
                          >
                            Revoke
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Subscriptions List */}
                {expandedTokens.has(token.id) && (
                  <div className="border-t border-border-default bg-bg-secondary p-4">
                    {loadingSubscriptions.has(token.id) ? (
                      <p className="text-text-secondary text-sm">Loading feeds...</p>
                    ) : (subscriptions[token.id]?.length || 0) === 0 ? (
                      <p className="text-text-secondary text-sm">
                        No feeds yet. Generate an RSS feed from the main page using filters, and it will appear here.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium text-text-secondary mb-2">
                          Active Feeds ({subscriptions[token.id]?.length || 0})
                        </h4>
                        {subscriptions[token.id]?.map((sub) => (
                          <div
                            key={sub.id}
                            className="bg-bg-base border border-border-default rounded p-3"
                          >
                            <div className="flex items-start justify-between">
                              <div>
                                <div className="font-medium text-text-primary">
                                  {sub.label || sub.summary}
                                </div>
                                <div className="text-xs text-text-tertiary mt-1">
                                  Type: {sub.feed_type} · Accessed {sub.access_count}x
                                  {sub.last_accessed_at && (
                                    <> · Last: {formatRelativeTime(sub.last_accessed_at)}</>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Help Section */}
      <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h3 className="font-semibold text-blue-800 mb-2">How to use feed tokens</h3>
        <ol className="list-decimal list-inside text-sm text-blue-700 space-y-1">
          <li>Create a token above and save it securely</li>
          <li>Use the token in your feed URL as a query parameter</li>
          <li>Add the URL to your feed reader</li>
        </ol>
        <p className="text-sm text-blue-600 mt-3">
          <strong>Note:</strong> If you revoke a token, all feed URLs using it will stop working.
        </p>
      </div>
    </div>
  );
}
